/**
 * Running the comp search.
 *
 * Primary path: a same-origin `fetch` from the content script. The script is
 * already running on facebook.com, so the request carries the user's own
 * session exactly as a navigation would, and the response contains the
 * server-rendered payloads the extractor reads. One request, on the click, no
 * new tab, no additional permission.
 *
 * Fallback: a background tab, driven by the service worker. Used only when the
 * fetch returns a JavaScript shell with no rendered results. It still requires
 * no `tabs` permission — `chrome.tabs.create` and `chrome.tabs.remove` do not,
 * and the content script in the new tab reports back through messaging rather
 * than the worker reading the tab's URL.
 */

import { extractCompCards } from "../extract/comp-card";
import type { ExtractionIssue, ObservationPayload } from "../shared/types";
import type { HarvestResult } from "../shared/messages";
import { sendToBackground } from "../shared/messages";

export type CompSource = "same_origin_fetch" | "background_tab" | "none";

export interface CompSearchResult {
  observations: ObservationPayload[];
  issues: ExtractionIssue[];
  source: CompSource;
}

const FETCH_TIMEOUT_MS = 20_000;

/**
 * Whether a parsed response actually carries results.
 *
 * Facebook sometimes serves a route as an empty shell that populates client
 * side. Treating that as "zero comps" would be wrong and, worse, indistinguishable
 * from a genuinely empty market — the thing step 0 exists to measure.
 */
function looksLikeShell(doc: Document): boolean {
  const hasPayloads = doc.querySelectorAll('script[type="application/json"]').length > 0;
  const hasCards = doc.querySelectorAll('a[href*="/marketplace/item/"]').length > 0;
  return !hasPayloads && !hasCards;
}

async function fetchDocument(url: string): Promise<Document | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      credentials: "include",
      signal: controller.signal,
      headers: { Accept: "text/html" },
    });
    if (!response.ok) return null;

    const html = await response.text();
    return new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function runCompSearch(
  searchUrl: string,
  now: Date = new Date(),
): Promise<CompSearchResult> {
  const doc = await fetchDocument(searchUrl);

  if (doc && !looksLikeShell(doc)) {
    const result = await extractCompCards(doc, searchUrl, now);
    if (result.observations.length > 0) {
      return { ...result, source: "same_origin_fetch" };
    }
  }

  const viaTab = await sendToBackground<HarvestResult>({
    type: "HARVEST_COMPS_VIA_TAB",
    url: searchUrl,
  });

  if (viaTab?.ok) {
    return {
      observations: viaTab.observations,
      issues: viaTab.issues,
      source: "background_tab",
    };
  }

  return { observations: [], issues: [], source: "none" };
}
