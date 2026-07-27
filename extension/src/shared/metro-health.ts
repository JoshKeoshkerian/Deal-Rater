/**
 * Remembering which metro slugs do not resolve.
 *
 * The slugs in `comps/metros.ts` are inferred from the two confirmed examples,
 * so some will be wrong. Facebook answers an unrecognised location by silently
 * returning the account's own metro, which looks exactly like a market with
 * nothing in it -- a failure that has already cost one capture.
 *
 * Rather than retry a bad slug on every future capture, one is recorded the
 * first time its results come back from the wrong state and skipped thereafter.
 * Stored in `local` rather than `sync`: this is an observation about what
 * Facebook accepts, not a user preference worth carrying between machines.
 */

const KEY = "badMetroSlugs";

export async function loadBadMetroSlugs(): Promise<string[]> {
  const stored = await chrome.storage.local.get({ [KEY]: [] as string[] });
  const value = (stored as Record<string, unknown>)[KEY];
  return Array.isArray(value) ? (value as string[]) : [];
}

export async function rememberBadMetroSlug(slug: string): Promise<void> {
  const current = await loadBadMetroSlugs();
  if (current.includes(slug)) return;
  await chrome.storage.local.set({ [KEY]: [...current, slug] });
}

/** Clears the record, so a corrected slug list gets a fresh chance. */
export async function clearBadMetroSlugs(): Promise<void> {
  await chrome.storage.local.set({ [KEY]: [] });
}
