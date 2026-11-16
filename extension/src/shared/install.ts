/**
 * The install id: a random UUID minted once, on first install, for acquisition
 * attribution (which ad drove this install, and did it go on to run checks or
 * buy). `backend/app/attribution.py` has the other half.
 *
 * It is random -- not derived from the device, the browser, the Facebook
 * account or anything else -- and lives in `chrome.storage.local` (this
 * install only, never synced). It travels in exactly three places, all of
 * them the user's own actions or the one-time welcome tab: the welcome page
 * URL, each capture the user clicks Evaluate for, and sign-in.
 *
 * Installs from before this existed have no id and send none; they are simply
 * unattributed, which is the honest answer for them.
 */

const INSTALL_ID_KEY = "installId";

export async function createInstallId(): Promise<string> {
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [INSTALL_ID_KEY]: id });
  return id;
}

export async function loadInstallId(): Promise<string | null> {
  const stored = await chrome.storage.local.get(INSTALL_ID_KEY);
  const id = stored[INSTALL_ID_KEY];
  return typeof id === "string" && id ? id : null;
}
