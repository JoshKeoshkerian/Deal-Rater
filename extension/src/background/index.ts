/**
 * Service worker.
 *
 * Four jobs, and no others: post captures to the backend, fetch the resulting
 * evaluation, and drive the background-tab fallback for the comp search and for
 * a stale target listing. It holds no timers, registers no alarms, and does
 * nothing at all unless a content script asks it to — the user-initiated
 * constraint in spec 8.1 is a property of this file's structure.
 */

import type {
  BackgroundToContent,
  ContentToBackground,
  EvaluationResult,
  HarvestResult,
  HarvestTargetResult,
  SubmitCaptureResult,
} from "../shared/messages";
import { loadSettings } from "../shared/settings";
import { fetchEvaluationWithRetry, postCapture } from "./api-client";

const TAB_LOAD_TIMEOUT_MS = 30_000;

/** Tabs opened for a comp harvest, awaiting their content script's ready signal. */
const pendingHarvests = new Map<number, (tabId: number) => void>();

async function handleEvaluation(captureId: number): Promise<EvaluationResult> {
  const settings = await loadSettings();
  const evaluation = await fetchEvaluationWithRetry(settings.apiBaseUrl, captureId);
  return { ok: true, evaluation };
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
