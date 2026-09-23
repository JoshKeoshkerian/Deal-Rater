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

import type { BillingState } from "./billing";
import type { PlanId } from "./plans";
import type { SavedEvaluation, User } from "./types";

const API_BASE =
  process.env["NEXT_PUBLIC_API_BASE_URL"]?.replace(/\/$/, "") ?? "https://api.curbsidescore.com";

/** No response in this long — the request is abandoned, not retried. */
const TIMEOUT_MS = 10_000;

/** A 401. The one failure the UI treats as "sign in" rather than "went wrong". */
export class NotAuthenticatedError extends Error {}

/**
 * Everything else that isn't a 401: a 4xx/5xx with `status` attached so a
 * caller can react to a specific code (429, say) instead of only the message
 * string, plus the timeout case (`status: 0`, nothing ever answered).
 */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      credentials: "include",
      headers: options.body === undefined ? {} : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") {
      throw new ApiError("That took too long. Check your connection and try again.", 0);
    }
    throw new ApiError("Could not reach Curbside. Check your connection and try again.", 0);
  } finally {
    clearTimeout(timeout);
  }

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
    throw new ApiError(detail, response.status);
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

// --- billing ------------------------------------------------------------

export function fetchBillingState(): Promise<BillingState | null> {
  return request<BillingState>("/v1/billing/me");
}

/**
 * Starts a Stripe Checkout Session for the given plan and returns the URL to
 * redirect to. There is no Stripe.js on this site at all -- the backend
 * creates the session server-side with the secret key and hands back a plain
 * URL, so the browser only ever needs `window.location.href = url`.
 */
export async function createCheckoutSession(planId: PlanId): Promise<string> {
  const result = await request<{ url: string }>("/v1/billing/checkout", {
    method: "POST",
    body: { plan_id: planId },
  });
  if (!result) throw new ApiError("The server did not return a checkout URL.", 0);
  return result.url;
}

/** Same shape as `createCheckoutSession`: a URL, this time to Stripe's
 * Billing Portal, for changing or cancelling an existing subscription. */
export async function openBillingPortal(): Promise<string> {
  const result = await request<{ url: string }>("/v1/billing/portal", { method: "POST" });
  if (!result) throw new ApiError("The server did not return a billing portal URL.", 0);
  return result.url;
}
