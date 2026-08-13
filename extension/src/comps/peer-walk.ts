/**
 * How the peer-metro searches are paced: batch size, stopping rule, time budget.
 *
 * WHY THIS IS ITS OWN FILE
 * -------------------------
 * It was six lines inline in `run-capture.ts` -- a `for` loop with an `await`
 * in it -- and that shape was the single biggest contributor to how long a
 * capture took. Eight peers, one at a time, each a full page fetch, on a
 * stopping rule (`USABLE_COMP_TARGET`, 30 comps) that most vehicles do not
 * satisfy until late in the list. A capture that felt like it had hung was
 * usually this loop on peer six.
 *
 * Making it concurrent is a small change to the code and a large one to the
 * behaviour, and `run-capture.ts` cannot be driven from a test without a browser
 * and a Facebook session. So the pacing lives here, where a test can hand it a
 * fake search function and assert what actually matters: that the requests
 * overlap, that the stopping rule is still consulted, and that a slow market
 * cannot extend a click without limit.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * -----------------------------------
 * It does not know what a comp is, does not merge results, and does not decide
 * whether a search reached the metro it named. Those are the caller's, through
 * `accept`. This file's whole subject is WHEN a request is allowed to start.
 */

/** Why the walk ended. Recorded on the capture; see `run-capture.ts`. */
export type WidenStop = "target_met" | "peers_exhausted" | "time_budget";

export interface PeerWalkOptions<TResult> {
  /** Metro slugs to try, in priority order. */
  queue: string[];
  /**
   * Run one metro's search. Returning null skips the slug without spending a
   * batch slot on it -- the caller uses that for a slug it cannot build a URL
   * for, and for the listing's own metro, which is searched separately.
   */
  search: (slug: string) => Promise<TResult> | null;
  /**
   * Whether more comps are still wanted, given how many peers are left. Checked
   * once before each batch rather than once per peer: the batch is the unit of
   * work, and re-checking inside one would mean discarding a result that has
   * already been paid for.
   */
  shouldContinue: (remaining: number) => boolean;
  /** Take one peer's results. Runs in queue order within a batch. */
  accept: (slug: string, result: TResult) => Promise<void> | void;
  /**
   * Run once, after the first batch's requests resolve and before any of their
   * results are accepted. The caller folds in work it started alongside the
   * batch -- the trim query -- so that work's own numbers are not diluted by a
   * peer that happened to answer in the same round trip.
   */
  onFirstBatchSettled?: () => Promise<void> | void;
  batchSize: number;
  /**
   * Wall-clock ceiling on STARTING new batches, measured from `startedAt`.
   * Requests already in flight are always awaited and used: cancelling work
   * that is nearly done saves nothing and loses comps.
   */
  budgetMs: number;
  startedAt: number;
  /** Injectable so a test does not have to sleep to reach the budget. */
  now?: () => number;
}

export async function walkPeers<TResult>({
  queue,
  search,
  shouldContinue,
  accept,
  onFirstBatchSettled,
  batchSize,
  budgetMs,
  startedAt,
  now = Date.now,
}: PeerWalkOptions<TResult>): Promise<WidenStop> {
  let next = 0;
  let settled = false;
  let stop: WidenStop = "peers_exhausted";

  while (next < queue.length) {
    if (!shouldContinue(queue.length - next)) {
      stop = "target_met";
      break;
    }
    if (now() - startedAt > budgetMs) {
      stop = "time_budget";
      break;
    }

    // Slugs the caller declines are stepped over here rather than counted
    // against the batch, so a queue holding the target's own metro still fires
    // a full batch of real searches.
    const batch: { slug: string; pending: Promise<TResult> }[] = [];
    while (next < queue.length && batch.length < batchSize) {
      const slug = queue[next++]!;
      const pending = search(slug);
      if (pending) batch.push({ slug, pending });
    }
    if (batch.length === 0) continue;

    const results = await Promise.all(batch.map((peer) => peer.pending));

    if (!settled) {
      settled = true;
      await onFirstBatchSettled?.();
    }

    for (const [index, result] of results.entries()) {
      await accept(batch[index]!.slug, result);
    }
  }

  if (!settled) await onFirstBatchSettled?.();
  return stop;
}
