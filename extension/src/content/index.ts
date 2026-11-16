/**
 * Content script entry point.
 *
 * Registered against `/marketplace/*` rather than `/marketplace/item/*`, and
 * this is worth being explicit about because it looks like over-matching.
 * Facebook is a single-page app: a user who lands on the Marketplace home page
 * and clicks through to a listing never triggers a fresh injection, so a
 * narrower pattern would leave the script absent on exactly the pages it is for.
 * The scope stays inside Marketplace either way, and the button is mounted only
 * on item pages.
 *
 * Route changes are watched with a MutationObserver rather than a timer. This
 * is not data collection — nothing is read from the page until the user clicks
 * — it only decides whether the button should be on screen.
 */

import { extractCompCards } from "../extract/comp-card";
import { extractTargetListing } from "../extract/listing";
import type {
  BackgroundToContent,
  EnsureSessionResult,
  HarvestResult,
  HarvestTargetResult,
} from "../shared/messages";
import { sendToBackground } from "../shared/messages";
import { loadSettings } from "../shared/settings";
import type { SignInCopy } from "./overlay/signin-panel";
import { runCapture } from "./run-capture";
import { findSendButtonAnchor } from "./send-anchor";
import { downloadPageSnapshot } from "./snapshot";
import { mountTriggerButton, type TriggerButton } from "./trigger-button";

const ROUTE_DEBOUNCE_MS = 300;

let button: TriggerButton | null = null;
let lastUrl = location.href;
let running = false;

function isItemPage(): boolean {
  return /\/marketplace\/item\/\d+/.test(location.pathname);
}

function isSearchPage(): boolean {
  return /\/marketplace\/(search|category)/.test(location.pathname);
}

/**
 * Sign-in copy for the two reasons a click can need an email. Kept here,
 * beside the click that triggers them, so the wording matches the moment.
 */
function guestUsedCopy(bonus: number | undefined): SignInCopy {
  const n = bonus && bonus > 0 ? bonus : null;
  const more = n ? `${n} more free check${n === 1 ? "" : "s"}` : "more free checks";
  return {
    title: `Get ${more}`,
    blurb:
      "You've used your free check. Add your email to keep going, and this car's check " +
      "runs right after.",
    cta: n ? `Get my ${n} free check${n === 1 ? "" : "s"}` : "Get my free checks",
  };
}

function signInCopy(reason?: string): SignInCopy {
  return {
    title: "Check this car for free",
    blurb:
      (reason ? `${reason} ` : "") +
      "Enter your email to get your free checks. This one runs right after.",
    cta: "Get my free checks",
  };
}

/**
 * Makes sure a check can run before any extraction work starts.
 *
 * A first-time user has no session: the background worker fetches a guest
 * pass here, so their first check runs with no sign-up at all. Sign-in is
 * shown up front only when that pass is spent or unavailable, rather than
 * after running the whole extraction/comp-search pipeline into a 402.
 *
 * Fails OPEN on its own failure (a broken message channel, say): the backend
 * is the authority, and `outcome.signedOut` below catches that case too.
 */
async function ensureSession(): Promise<EnsureSessionResult> {
  return sendToBackground<EnsureSessionResult>({ type: "ENSURE_SESSION" }).catch(
    (): EnsureSessionResult => ({ ok: true, ready: true }),
  );
}

async function handleClick(): Promise<void> {
  if (running || !button) return;

  const prepared = await ensureSession();
  if (prepared.ok && !prepared.ready) {
    button.showSignIn(
      () => void handleClick(),
      prepared.reason === "guest-used"
        ? guestUsedCopy(prepared.signupBonus)
        : signInCopy(prepared.message),
    );
    return;
  }

  running = true;
  button.setBusy(true);

  try {
    const outcome = await runCapture((message, stage) => button?.setProgress(message, stage));
    if (outcome.signedOut) {
      button?.showSignIn(
        () => void handleClick(),
        outcome.guestUsed ? guestUsedCopy(outcome.signupBonus) : signInCopy(),
      );
    } else {
      button?.setStatus(outcome.message, outcome.ok ? "info" : "error");
    }
  } catch (error) {
    button?.setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    running = false;
    button?.setBusy(false);
  }
}

async function syncButton(): Promise<void> {
  const settings = await loadSettings();

  if (!settings.enabled || !isItemPage()) {
    button?.remove();
    button = null;
    return;
  }

  if (button) {
    // The dock itself survives a listing-to-listing navigation (it lives on
    // `document.body`, not inside the page's own layout), but the Send button
    // it was floating above belonged to the PREVIOUS listing's composer.
    // Re-locate it rather than leaving the dock pinned to a stale position.
    button.updateAnchor(findSendButtonAnchor());
    return;
  }

  button = mountTriggerButton(() => void handleClick(), findSendButtonAnchor());
  // Two gates, not one. `devMode` is a setting a user could flip; `__DEV__` is
  // the build, and it is what keeps the fixture-capture control out of a
  // packaged extension entirely rather than one checkbox away from appearing.
  if (button && __DEV__ && settings.devMode) {
    button.addExtraAction("Save fixture", downloadPageSnapshot);
  }
}

function watchRoute(): void {
  let timer: number | undefined;

  const check = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    void syncButton();
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(check, ROUTE_DEBOUNCE_MS);
  };

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  window.addEventListener("popstate", check);
}

/**
 * Respond to a harvest request from the service worker: comps on a search
 * page, or a stale target listing on an item page. Only reachable on a tab
 * opened by one of the two background-tab fallbacks below, which themselves
 * only ever run inside a capture the user started.
 */
chrome.runtime.onMessage.addListener((message: BackgroundToContent, _sender, sendResponse) => {
  if (message?.type === "HARVEST_COMPS") {
    extractCompCards(document, location.href)
      .then((result) =>
        sendResponse({
          ok: true,
          observations: result.observations,
          issues: result.issues,
        } satisfies HarvestResult),
      )
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        } satisfies HarvestResult),
      );
    return true;
  }

  if (message?.type === "HARVEST_TARGET") {
    // The tab this runs in came from a real navigation (`chrome.tabs.create`),
    // not a same-origin `fetch`, so `document` here is what a manual refresh
    // would have produced: the fix for a stale click-through payload that
    // `run-capture.ts`'s own re-fetch could not always reach on its own.
    extractTargetListing(document, location.href)
      .then((result) =>
        sendResponse({
          ok: true,
          observation: result.observation,
          issues: result.issues,
          pageSignature: result.pageSignature,
          usable: result.usable,
          locationId: result.locationId,
          searchRadiusKm: result.searchRadiusKm,
          payloadMatched: result.payloadMatched,
        } satisfies HarvestTargetResult),
      )
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        } satisfies HarvestTargetResult),
      );
    return true;
  }

  return false;
});

if (isSearchPage() || isItemPage()) {
  // Tells the worker this tab is ready to be harvested. Ignored when the tab
  // was opened by the user rather than by the fallback.
  void chrome.runtime.sendMessage({ type: "CONTENT_READY", url: location.href }).catch(
    () => undefined,
  );
}

void syncButton();
watchRoute();
