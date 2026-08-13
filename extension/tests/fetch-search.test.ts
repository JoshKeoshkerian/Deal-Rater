/**
 * When a comp search is allowed to fall back to a background tab.
 *
 * The fallback is a real navigation -- open a tab, wait for Facebook to load,
 * message it, close it -- and it used to fire on any search that produced no
 * comps. Since one capture runs the home metro, a trim query and up to eight
 * peers, a scarce car in a thin market paid that navigation nine times in
 * series for nine correct answers of "nothing here". That was the bulk of a
 * 30-45 second capture, so what the escalation rule does is worth pinning.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { runCompSearch } from "../src/comps/fetch-search";

const URL = "https://www.facebook.com/marketplace/tulsa/search?query=2014%20Toyota%20Camry";

/** A results page carrying `n` listing cards, in the shape the extractor reads. */
function resultsPage(n: number): string {
  const cards = Array.from(
    { length: n },
    (_, i) => `
      <a href="/marketplace/item/10000000000000${i}/">
        <span>$12,900</span><span>2014 Toyota Camry SE</span><span>Tulsa, OK</span>
      </a>`,
  ).join("");
  // A payload script is what tells `looksLikeShell` the page really rendered.
  return `<html><body><script type="application/json">{"data":{}}</script>${cards}</body></html>`;
}

/** What Facebook answers a `fetch` with when it wants the client to render. */
const SHELL = "<html><body><div id=\"mount\"></div></body></html>";

let tabHarvests: number;

beforeEach(() => {
  tabHarvests = 0;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: async () => {
        tabHarvests += 1;
        return { ok: true, observations: [], issues: [] };
      },
    },
  };
});

function answerWith(body: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status: 200 })),
  );
}

describe("escalating a comp search to a background tab", () => {
  it("does not escalate when the fetch returned cars", async () => {
    answerWith(resultsPage(3));

    const result = await runCompSearch(URL);

    expect(result.source).toBe("same_origin_fetch");
    expect(result.observations.length).toBeGreaterThan(0);
    expect(tabHarvests).toBe(0);
  });

  it("escalates on an empty market by default", async () => {
    // The first search of a run: a false zero would empty the whole comp set,
    // and a broken extractor has to be caught somewhere.
    answerWith(resultsPage(0));

    const result = await runCompSearch(URL);

    expect(tabHarvests).toBe(1);
    expect(result.source).toBe("background_tab");
  });

  it("believes an empty market once the fetch path has proven itself", async () => {
    // What every peer and trim search passes after the home search came back
    // through `fetch` with real cards. This is the change that removed most of
    // the wait: a thin market now costs one request, not one request plus a tab.
    answerWith(resultsPage(0));

    const result = await runCompSearch(URL, new Date(), { escalateOnEmpty: false });

    expect(tabHarvests).toBe(0);
    expect(result.observations).toEqual([]);
    expect(result.source).toBe("same_origin_fetch");
  });

  it("still escalates on a shell, whatever the caller said", async () => {
    // A shell is not an answer about the market -- it is Facebook declining to
    // render for a `fetch`. Believing its zero would be inventing a fact.
    answerWith(SHELL);

    const result = await runCompSearch(URL, new Date(), { escalateOnEmpty: false });

    expect(tabHarvests).toBe(1);
    expect(result.source).toBe("background_tab");
  });

  it("still escalates when the fetch itself failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );

    await runCompSearch(URL, new Date(), { escalateOnEmpty: false });

    expect(tabHarvests).toBe(1);
  });
});
