/**
 * Service worker.
 *
 * Post captures to the backend, fetch the resulting evaluation, drive the
 * background-tab fallback for the comp search and for a stale target listing,
 * and carry sign-in and save/unsave for the bookmark button.
 *
 * It holds no timers, registers no alarms, and does nothing at all unless a
 * content script asks it to — the user-initiated constraint in spec 8.1 is a
 * property of this file's structure, and the saved-evaluations work does not
 * change that. Nothing here polls a saved listing or refreshes a stored
 * evaluation in the background; a saved card is a snapshot, and refreshing one
 * is a click the user makes.
 *
 * It is also the only place the session token exists in this extension. The
 * content script runs on facebook.com and asks for outcomes, never for the
 * token — see `shared/session.ts`.
 */

import type {
  AuthActionResult,
  AuthStateResult,
  AuthVerifyResult,
  BackgroundToContent,
  ContentToBackground,
  EvaluationResult,
  HarvestResult,
  HarvestTargetResult,
  KnownIssuesFetchResult,
  SavedStateResult,
  SubmitCaptureResult,
} from "../shared/messages";
import {
  clearSession,
  loadSession,
  markWebAdoptAttempted,
  saveSession,
  shouldAttemptWebAdopt,
} from "../shared/session";
import { loadSettings } from "../shared/settings";
import {
  adoptWebSession,
  fetchEvaluationWithRetry,
  fetchKnownIssues,
  fetchSavedState,
  postCapture,
  requestSignInCode,
  saveEvaluation,
  signOut,
  UnauthorizedError,
  unsaveEvaluation,
  verifySignInCode,
} from "./api-client";

const TAB_LOAD_TIMEOUT_MS = 30_000;

/** Tabs opened for a comp harvest, awaiting their content script's ready signal. */
const pendingHarvests = new Map<number, (tabId: number) => void>();

async function handleEvaluation(captureId: number): Promise<EvaluationResult> {
  const settings = await loadSettings();
  const evaluation = await fetchEvaluationWithRetry(settings.apiBaseUrl, captureId);
  return { ok: true, evaluation };
}

async function handleKnownIssues(captureId: number): Promise<KnownIssuesFetchResult> {
  const settings = await loadSettings();
  const result = await fetchKnownIssues(settings.apiBaseUrl, captureId);
  return { ok: true, result };
}

chrome.runtime.onMessage.addListener((message: ContentToBackground, sender, sendResponse) => {
  if (message?.type === "SUBMIT_CAPTURE") {
    handleSubmit(message.payload)
      .then(sendResponse)
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: describe(error) } satisfies SubmitCaptureResult),
      );
    return true;
  }

  if (message?.type === "FETCH_EVALUATION") {
    handleEvaluation(message.captureId)
      .then(sendResponse)
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: describe(error) } satisfies EvaluationResult),
      );
    return true;
  }

  if (message?.type === "FETCH_KNOWN_ISSUES") {
    handleKnownIssues(message.captureId)
      .then(sendResponse)
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: describe(error) } satisfies KnownIssuesFetchResult),
      );
    return true;
  }

  if (message?.type === "HARVEST_COMPS_VIA_TAB") {
    handleHarvest(message.url)
      .then(sendResponse)
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: describe(error) } satisfies HarvestResult),
      );
    return true;
  }

  if (message?.type === "HARVEST_TARGET_VIA_TAB") {
    handleTargetHarvest(message.url)
      .then(sendResponse)
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: describe(error) } satisfies HarvestTargetResult),
      );
    return true;
  }

  if (message?.type === "AUTH_STATE") {
    handleAuthState().then(sendResponse).catch(failed(sendResponse));
    return true;
  }

  if (message?.type === "AUTH_REQUEST_CODE") {
    handleRequestCode(message.email).then(sendResponse).catch(failed(sendResponse));
    return true;
  }

  if (message?.type === "AUTH_VERIFY_CODE") {
    handleVerifyCode(message.email, message.code).then(sendResponse).catch(failed(sendResponse));
    return true;
  }

  if (message?.type === "AUTH_SIGN_OUT") {
    handleSignOut().then(sendResponse).catch(failed(sendResponse));
    return true;
  }

  if (message?.type === "SAVED_STATE") {
    handleSavedState(message.captureId).then(sendResponse).catch(failed(sendResponse));
    return true;
  }

  if (message?.type === "SAVE_EVALUATION" || message?.type === "UNSAVE_EVALUATION") {
    handleSaveToggle(message.captureId, message.type === "SAVE_EVALUATION")
      .then(sendResponse)
      .catch(failed(sendResponse));
    return true;
  }

  if (message?.type === "CONTENT_READY") {
    const tabId = sender.tab?.id;
    if (tabId !== undefined) {
      pendingHarvests.get(tabId)?.(tabId);
    }
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

async function handleSubmit(payload: unknown): Promise<SubmitCaptureResult> {
  const settings = await loadSettings();
  try {
    const response = await postCapture(settings.apiBaseUrl, payload as never);
    return { ok: true, response };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

/**
 * Open a page in a background tab, ask its content script for the data, and
 * close it.
 *
 * The tab is created inactive so it never takes focus, and it is removed in a
 * `finally` so a failure part-way through does not leave a stray tab behind.
 * No `tabs` permission is required: nothing here reads the tab's URL or title.
 *
 * Shared by the comp-search harvest and the target-listing one below: both are
 * the same operation -- a real navigation, standing in for the one a fetch
 * cannot do -- aimed at different content-script listeners.
 */
async function harvestViaTab<T extends { ok: boolean }>(
  url: string,
  request: BackgroundToContent,
): Promise<T | { ok: false; error: string }> {
  let tabId: number | undefined;

  try {
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
    if (tabId === undefined) return { ok: false, error: "could not open a tab" };

    await waitForContentScript(tabId);

    const result = (await chrome.tabs.sendMessage(tabId, request)) as T | undefined;

    return result ?? { ok: false, error: "no response from the harvest tab" };
  } catch (error) {
    return { ok: false, error: describe(error) };
  } finally {
    if (tabId !== undefined) {
      pendingHarvests.delete(tabId);
      await chrome.tabs.remove(tabId).catch(() => undefined);
    }
  }
}

async function handleHarvest(url: string): Promise<HarvestResult> {
  return harvestViaTab<HarvestResult>(url, { type: "HARVEST_COMPS" });
}

/**
 * The same background-tab technique as `handleHarvest`, aimed at a stale
 * TARGET listing instead of a search page.
 *
 * `run-capture.ts`'s same-origin `fetch` re-fetch already catches the common
 * case of a click-through payload describing the previous listing. But a plain
 * `fetch` is not a real navigation, and `comps/fetch-search.ts`'s
 * `looksLikeShell` exists precisely because Facebook sometimes answers one with
 * a stripped shell rather than the full rendered page. When that happens here,
 * the re-fetch silently keeps the incomplete extraction, and the only thing
 * that ever fixed it was the user manually refreshing the tab -- which is a
 * real navigation. This is that same real navigation, done by the extension.
 */
async function handleTargetHarvest(url: string): Promise<HarvestTargetResult> {
  return harvestViaTab<HarvestTargetResult>(url, { type: "HARVEST_TARGET" });
}

function waitForContentScript(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingHarvests.delete(tabId);
      reject(new Error("timed out waiting for the search page to load"));
    }, TAB_LOAD_TIMEOUT_MS);

    pendingHarvests.set(tabId, () => {
      clearTimeout(timer);
      pendingHarvests.delete(tabId);
      resolve();
    });
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Shared rejection handler for the message listeners above. */
function failed(sendResponse: (result: { ok: false; error: string }) => void) {
  return (error: unknown) => sendResponse({ ok: false, error: describe(error) });
}

// --- accounts and saved evaluations ------------------------------------------

/**
 * Hand this session to the website's cookie transport, unconditionally.
 * Always called right after a fresh verify (`handleVerifyCode`): a sign-in
 * that just happened is the clearest possible signal to sync, so it bypasses
 * `shouldAttemptWebAdopt`'s throttle rather than checking it and then
 * immediately satisfying it.
 */
async function syncWebSession(apiBaseUrl: string, token: string): Promise<void> {
  await markWebAdoptAttempted();
  await adoptWebSession(apiBaseUrl, token).catch(() => undefined);
}

/**
 * The other way to reach `syncWebSession`: opportunistically, for a session
 * that was already signed in before this call. Covers what `handleVerifyCode`
 * cannot -- someone who verified before `/v1/auth/adopt` existed, or who
 * updated the extension without ever signing in again -- by piggybacking on
 * `SAVED_STATE`, which the overlay already sends on every render of an
 * evaluated listing. That keeps this inside spec 8.1's user-initiated
 * constraint (a side effect on an existing user-triggered message, not a new
 * timer) while `shouldAttemptWebAdopt`'s throttle keeps a long overlay session
 * across many listings from turning into an adopt call per render.
 */
async function maybeAdoptWebSession(apiBaseUrl: string, token: string): Promise<void> {
  if (await shouldAttemptWebAdopt()) await syncWebSession(apiBaseUrl, token);
}

async function handleAuthState(): Promise<AuthStateResult> {
  const session = await loadSession();
  return session ? { ok: true, signedIn: true, email: session.email } : { ok: true, signedIn: false };
}

async function handleRequestCode(email: string): Promise<AuthActionResult> {
  const settings = await loadSettings();
  try {
    await requestSignInCode(settings.apiBaseUrl, email);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

async function handleVerifyCode(email: string, code: string): Promise<AuthVerifyResult> {
  const settings = await loadSettings();
  try {
    const result = await verifySignInCode(settings.apiBaseUrl, email, code);
    if (!result?.token) return { ok: false, error: "The server did not return a session." };
    await saveSession({ token: result.token, email: result.user?.email ?? email });
    // Best-effort: syncs this session to the website's cookie so
    // app.curbsidescore.com does not ask for a second code. The sign-in above
    // already succeeded and must be reported as such either way.
    await syncWebSession(settings.apiBaseUrl, result.token);
    return { ok: true, email: result.user?.email ?? email };
  } catch (error) {
    // A 401 here means the CODE was wrong, not that a session expired -- there
    // is no session yet. `UnauthorizedError` carries no detail for that reason,
    // so the message is written here where the context is known.
    if (error instanceof UnauthorizedError) {
      return { ok: false, error: "That code is not right, or it has expired." };
    }
    return { ok: false, error: describe(error) };
  }
}

async function handleSignOut(): Promise<AuthActionResult> {
  const settings = await loadSettings();
  const session = await loadSession();
  // Cleared locally FIRST and regardless of what the server says. A sign-out
  // that leaves the token on the machine because the network was down is the
  // one failure mode this must not have.
  await clearSession();
  if (session) {
    await signOut(settings.apiBaseUrl, session.token).catch(() => undefined);
  }
  return { ok: true };
}

async function handleSavedState(captureId: number): Promise<SavedStateResult> {
  const session = await loadSession();
  if (!session) return { ok: true, signedIn: false };

  const settings = await loadSettings();
  // Started alongside the real request rather than awaited before it, so an
  // overdue sync never adds its own latency to the bookmark button's render.
  // Awaited in `finally` so the worker stays alive to finish it either way --
  // see `maybeAdoptWebSession`'s docstring for why this call exists at all.
  const adopt = maybeAdoptWebSession(settings.apiBaseUrl, session.token);
  try {
    const state = await fetchSavedState(settings.apiBaseUrl, session.token, captureId);
    return { ok: true, signedIn: true, saved: state?.saved ?? false };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      // The stored token no longer resolves: expired, or revoked elsewhere.
      // Drop it and report the honest state rather than an error the user
      // cannot act on.
      await clearSession();
      return { ok: true, signedIn: false };
    }
    return { ok: false, error: describe(error) };
  } finally {
    await adopt;
  }
}

async function handleSaveToggle(captureId: number, save: boolean): Promise<SavedStateResult> {
  const session = await loadSession();
  if (!session) return { ok: true, signedIn: false };

  const settings = await loadSettings();
  try {
    if (save) await saveEvaluation(settings.apiBaseUrl, session.token, captureId);
    else await unsaveEvaluation(settings.apiBaseUrl, session.token, captureId);
    return { ok: true, signedIn: true, saved: save };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      await clearSession();
      return { ok: true, signedIn: false };
    }
    return { ok: false, error: describe(error) };
  }
}
