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
  await chrome.storage.local.remove([TOKEN_KEY, EMAIL_KEY]);
}
