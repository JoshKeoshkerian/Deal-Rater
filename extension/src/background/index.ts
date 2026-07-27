/**
 * Service worker.
 *
 * Three jobs, and no others: post captures to the backend, fetch the resulting
 * evaluation, and drive the background-tab fallback for the comp search. It holds no timers, registers no
 * alarms, and does nothing at all unless a content script asks it to — the
 * user-initiated constraint in spec 8.1 is a property of this file's structure.
 */

import type {
  ContentToBackground,
  EvaluationResult,
  HarvestResult,
  SubmitCaptureResult,
} from "../shared/messages";
import { loadSettings } from "../shared/settings";
import { fetchEvaluation, postCapture } from "./api-client";

const TAB_LOAD_TIMEOUT_MS = 30_000;

/** Tabs opened for a comp harvest, awaiting their content script's ready signal. */
const pendingHarvests = new Map<number, (tabId: number) => void>();

async function handleEvaluation(captureId: number): Promise<EvaluationResult> {
  const settings = await loadSettings();
  const evaluation = await fetchEvaluation(settings.apiBaseUrl, captureId);
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
 * Open the search in a background tab, ask its content script for the cards,
 * and close it.
 *
 * The tab is created inactive so it never takes focus, and it is removed in a
 * `finally` so a failure part-way through does not leave a stray tab behind.
 * No `tabs` permission is required: nothing here reads the tab's URL or title.
 */
async function handleHarvest(url: string): Promise<HarvestResult> {
  let tabId: number | undefined;

  try {
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
    if (tabId === undefined) return { ok: false, error: "could not open a tab" };

    await waitForContentScript(tabId);

    const result = (await chrome.tabs.sendMessage(tabId, {
      type: "HARVEST_COMPS",
    })) as HarvestResult | undefined;

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
