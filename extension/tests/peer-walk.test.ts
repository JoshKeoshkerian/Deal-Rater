/**
 * How peer-metro searches are paced.
 *
 * The subject is latency, so these assert on OVERLAP and on what was allowed to
 * start -- not on comps, which `walkPeers` knows nothing about. Every search
 * here is a fake that records when it began and resolves on a controlled
 * schedule, so "these ran at the same time" is a fact the test can check rather
 * than a stopwatch reading.
 */

import { describe, expect, it } from "vitest";

import { walkPeers } from "../src/comps/peer-walk";

const QUEUE = ["a", "b", "c", "d", "e", "f", "g", "h"];

/**
 * A search that takes `ms` of fake time, recording the clock at start and end.
 *
 * Time is a counter this harness advances itself: `tick` moves it forward as
 * each promise resolves, so a batch of three that starts together and takes
 * 10ms each finishes at 10, not 30, without the test sleeping at all.
 */
function harness({ perSearch = 10 } = {}) {
  let clock = 0;
  const started: { slug: string; at: number }[] = [];
  const accepted: string[] = [];

  return {
    now: () => clock,
    started,
    accepted,
    get slugs() {
      return started.map((s) => s.slug);
    },
    /** Slugs grouped by the clock reading they started at. */
    get rounds(): string[][] {
      const byTime = new Map<number, string[]>();
      for (const { slug, at } of started) byTime.set(at, [...(byTime.get(at) ?? []), slug]);
      return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([, slugs]) => slugs);
    },
    search: (slug: string) => {
      started.push({ slug, at: clock });
      const finishesAt = clock + perSearch;
      return Promise.resolve().then(() => {
        // The batch's searches all advance the same clock to the same instant,
        // which is what makes them concurrent rather than cumulative.
        clock = Math.max(clock, finishesAt);
        return { slug };
      });
    },
    accept: (slug: string) => {
      accepted.push(slug);
    },
  };
}

describe("walking the peer list", () => {
  it("runs a batch concurrently rather than one at a time", async () => {
    const h = harness();

    await walkPeers({
      queue: QUEUE,
      search: h.search,
      accept: h.accept,
      shouldContinue: () => true,
      batchSize: 3,
      budgetMs: 10_000,
      startedAt: 0,
      now: h.now,
    });

    // The thing this file exists for. Eight peers used to be eight round trips;
    // they are now three rounds of at most three.
    expect(h.rounds).toEqual([
      ["a", "b", "c"],
      ["d", "e", "f"],
      ["g", "h"],
    ]);
  });

  it("still stops as soon as the comp target is met", async () => {
    const h = harness();
    let batches = 0;

    const stop = await walkPeers({
      queue: QUEUE,
      search: h.search,
      accept: h.accept,
      // Satisfied after the first batch, exactly as `shouldWiden` would be once
      // enough comps have come back.
      shouldContinue: () => batches++ < 1,
      batchSize: 3,
      budgetMs: 10_000,
      startedAt: 0,
      now: h.now,
    });

    expect(stop).toBe("target_met");
    expect(h.slugs).toEqual(["a", "b", "c"]);
  });

  it("overshoots by at most the batch it had already started", async () => {
    // The cost of batching, stated as a bound rather than left implicit: a
    // stopping rule that would have fired after peer 4 in series lets peers 5
    // and 6 run, and they cost nothing because they were already in flight.
    const h = harness();

    await walkPeers({
      queue: QUEUE,
      search: h.search,
      accept: h.accept,
      shouldContinue: () => h.accepted.length < 4,
      batchSize: 3,
      budgetMs: 10_000,
      startedAt: 0,
      now: h.now,
    });

    expect(h.slugs).toHaveLength(6);
  });

  it("stops starting new work once the time budget is spent", async () => {
    const h = harness({ perSearch: 40 });

    const stop = await walkPeers({
      queue: QUEUE,
      search: h.search,
      accept: h.accept,
      shouldContinue: () => true,
      batchSize: 3,
      budgetMs: 50,
      startedAt: 0,
      now: h.now,
    });

    // Two rounds fit inside 50ms of fake time; the third is not started. A
    // click cannot be extended without limit by a slow market.
    expect(stop).toBe("time_budget");
    expect(h.slugs).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("keeps every result from a batch that was already in flight", async () => {
    // The budget bounds what STARTS. Cancelling work that is nearly done saves
    // no time and loses comps.
    const h = harness({ perSearch: 100 });

    await walkPeers({
      queue: QUEUE,
      search: h.search,
      accept: h.accept,
      shouldContinue: () => true,
      batchSize: 3,
      budgetMs: 1,
      startedAt: 0,
      now: h.now,
    });

    expect(h.accepted).toEqual(["a", "b", "c"]);
  });

  it("folds in the work started alongside the first batch, before its results", async () => {
    // The trim query, which runs concurrently with the first peers. Its own
    // contribution has to be counted before a peer's results are merged or the
    // figures recorded for it stop meaning what they say.
    const h = harness();
    const order: string[] = [];

    await walkPeers({
      queue: QUEUE,
      search: h.search,
      accept: (slug) => {
        order.push(slug);
      },
      onFirstBatchSettled: () => {
        order.push("trim");
      },
      shouldContinue: () => order.length < 2,
      batchSize: 3,
      budgetMs: 10_000,
      startedAt: 0,
      now: h.now,
    });

    expect(order[0]).toBe("trim");
  });

  it("folds it in even when no peer search ever runs", async () => {
    const h = harness();
    let settled = false;

    const stop = await walkPeers({
      queue: [],
      search: h.search,
      accept: h.accept,
      onFirstBatchSettled: () => {
        settled = true;
      },
      shouldContinue: () => true,
      batchSize: 3,
      budgetMs: 10_000,
      startedAt: 0,
      now: h.now,
    });

    expect(settled).toBe(true);
    expect(stop).toBe("peers_exhausted");
    expect(h.slugs).toEqual([]);
  });

  it("steps over a declined slug without spending a batch slot on it", async () => {
    // The listing's own metro is in the queue and is searched separately. It
    // must not shrink the batch around it.
    const h = harness();

    await walkPeers({
      queue: QUEUE,
      search: (slug) => (slug === "b" ? null : h.search(slug)),
      accept: h.accept,
      shouldContinue: () => true,
      batchSize: 3,
      budgetMs: 10_000,
      startedAt: 0,
      now: h.now,
    });

    expect(h.rounds[0]).toEqual(["a", "c", "d"]);
  });

  it("accepts results in queue order, not in the order they answered", async () => {
    const h = harness();

    await walkPeers({
      queue: ["a", "b", "c"],
      search: h.search,
      accept: h.accept,
      shouldContinue: () => true,
      batchSize: 3,
      budgetMs: 10_000,
      startedAt: 0,
      now: h.now,
    });

    expect(h.accepted).toEqual(["a", "b", "c"]);
  });
});
