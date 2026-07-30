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
import type { BackgroundToContent, HarvestResult, HarvestTargetResult } from "../shared/messages";
import { loadSettings } from "../shared/settings";
import { runCapture } from "./run-capture";
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

async function handleClick(): Promise<void> {
  if (running || !button) return;
  running = true;
  button.setBusy(true);

  try {
    const outcome = await runCapture((message, stage) => button?.setProgress(message, stage));
    button.setStatus(outcome.message, outcome.ok ? "info" : "error");
  } catch (error) {
    button.setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    running = false;
    button.setBusy(false);
  }
}

async function syncButton(): Promise<void> {
  const settings = await loadSettings();

  if (!settings.enabled || !isItemPage()) {
    button?.remove();
    button = null;
    return;
  }

  if (button) return;

  button = mountTriggerButton(() => void handleClick());
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
