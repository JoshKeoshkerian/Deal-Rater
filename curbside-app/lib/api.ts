/**
 * Every call this site makes to the API.
 *
 * `credentials: "include"` ON EVERY REQUEST, without exception. The session is
 * an httpOnly cookie scoped to `.curbsidescore.com`, which the browser will
 * only attach to a cross-origin request when asked to — and every request from
 * `app.curbsidescore.com` to `api.curbsidescore.com` is cross-origin. Omitting
 * it produces a 401 on a request that looked, from here, exactly like a signed-
 * in one.
 *
 * The cookie is same-SITE (both hosts share the registrable domain), which is
 * why it survives `SameSite=Lax`. It is not same-ORIGIN, which is why CORS has
 * to allow this origin with credentials.
 *
 * Nothing here reads the token, because nothing here can: httpOnly means the
 * page cannot see it even in its own document.cookie. Sign-in state is
 * therefore a question only the server can answer — hence `fetchMe`.
 */

import type { SavedEvaluation, User } from "./types";

const API_BASE =
  process.env["NEXT_PUBLIC_API_BASE_URL"]?.replace(/\/$/, "") ?? "https://api.curbsidescore.com";

/** A 401. The one failure the UI treats as "sign in" rather than "went wrong". */
export class NotAuthenticatedError extends Error {}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T | null> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    credentials: "include",
    headers: options.body === undefined ? {} : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 401) throw new NotAuthenticatedError("Not signed in.");

  const text = await response.text();

  if (!response.ok) {
    // FastAPI puts a human-readable reason in `detail`, and these endpoints
    // write it to be read by a person ("That code is not right.").
    let detail = `Something went wrong (${response.status}).`;
    try {
      const parsed = JSON.parse(text) as { detail?: unknown };
      if (typeof parsed.detail === "string") detail = parsed.detail;
    } catch {
      /* not JSON; keep the generic message rather than showing raw HTML */
    }
    throw new Error(detail);
  }

  return text ? (JSON.parse(text) as T) : null;
}

export function fetchMe(): Promise<User | null> {
  return request<User>("/v1/users/me");
}

export function requestSignInCode(email: string): Promise<unknown> {
  return request("/v1/auth/sign-in", { method: "POST", body: { email } });
}

export function verifySignInCode(email: string, code: string): Promise<{ user: User } | null> {
  // `client: "web"` is what makes the server set the cookie instead of
  // returning a token. See `backend/app/api/auth.py`.
  return request<{ user: User }>("/v1/auth/verify", {
    method: "POST",
    body: { email, code, client: "web" },
  });
}

export function signOut(): Promise<unknown> {
  return request("/v1/auth/sign-out", { method: "POST" });
}

export async function fetchSaved(): Promise<SavedEvaluation[]> {
  const result = await request<{ items: SavedEvaluation[] }>("/v1/users/me/saved");
  return result?.items ?? [];
}

export function unsave(captureId: number): Promise<unknown> {
  return request(`/v1/evaluations/${captureId}/save`, { method: "DELETE" });
}
