/**
 * The stored session token.
 *
 * `chrome.storage.local`, NOT `chrome.storage.sync` where `settings.ts` keeps
 * everything else. Sync replicates to every Chrome profile the user is signed
 * into, which is the right behaviour for a theme preference and the wrong
 * behaviour for a credential: it would copy one machine's session onto every
 * other machine silently, and revoking it on one would not revoke it on the
 * rest. A session belongs to the install that signed in.
 *
 * Only the service worker touches this. The content script runs on
 * facebook.com and never sees the token -- it asks the worker to save or unsave
 * and gets back a result, which is the same boundary `messages.ts` already
 * draws for the API base URL and every other outbound call.
 */

const TOKEN_KEY = "sessionToken";
const EMAIL_KEY = "sessionEmail";
const ADOPTED_AT_KEY = "sessionWebAdoptedAt";

export interface StoredSession {
  token: string;
  /** Shown in the signed-in state so the user can tell which account this is. */
  email: string;
}

export async function loadSession(): Promise<StoredSession | null> {
  const stored = await chrome.storage.local.get([TOKEN_KEY, EMAIL_KEY]);
  const token = stored[TOKEN_KEY] as string | undefined;
  const email = stored[EMAIL_KEY] as string | undefined;
  if (!token) return null;
  return { token, email: email ?? "" };
}

export async function saveSession(session: StoredSession): Promise<void> {
  await chrome.storage.local.set({
    [TOKEN_KEY]: session.token,
    [EMAIL_KEY]: session.email,
  });
}

export async function clearSession(): Promise<void> {
  // The adopt marker travels with the session it describes: a later sign-in
  // (possibly a different address) must not inherit an old timestamp and be
  // wrongly throttled out of adopting its own, new session.
  await chrome.storage.local.remove([TOKEN_KEY, EMAIL_KEY, ADOPTED_AT_KEY]);
}

//: Once a day. `SAVED_STATE` fires on every overlay render
//: (`background/index.ts`'s `handleSavedState`), and re-hitting
//: `POST /v1/auth/adopt` on every one of those would turn an opportunistic
//: sync into exactly the per-render network chatter this file's token
//: handling is designed to avoid. A day is generous next to the cookie's
//: actual lifetime (`session_ttl_days`, currently 90) -- this throttle exists
//: to catch someone who was signed in before the adopt endpoint existed, or
//: who updated the extension without ever re-verifying, not to keep the
//: cookie fresh.
const ADOPT_THROTTLE_MS = 24 * 60 * 60 * 1000;

/** Whether an opportunistic `/v1/auth/adopt` attempt is due. */
export async function shouldAttemptWebAdopt(now: number = Date.now()): Promise<boolean> {
  const stored = await chrome.storage.local.get([ADOPTED_AT_KEY]);
  const last = stored[ADOPTED_AT_KEY] as number | undefined;
  return last === undefined || now - last > ADOPT_THROTTLE_MS;
}

/**
 * Records an attempt, not a success. A failed adopt (network hiccup, server
 * hiccup) should not be retried on literally the next render either -- it
 * gets the same day-long throttle as a successful one, and the next real
 * opportunity is the one after that.
 */
export async function markWebAdoptAttempted(now: number = Date.now()): Promise<void> {
  await chrome.storage.local.set({ [ADOPTED_AT_KEY]: now });
}
