import type {
  CapturePayload,
  CaptureResponse,
  EvaluationResponse,
  KnownIssuesFetchResponse,
} from "../shared/types";

const REQUEST_TIMEOUT_MS = 30_000;

//: Comfortably above the backend's own `REQUEST_TIMEOUT_SECONDS` (30s,
//: `known_issues/client.py`) plus its one possible corrective retry, so a
//: hung connection here never aborts before the backend's own ceiling would
//: have. Its own constant rather than reusing `REQUEST_TIMEOUT_MS`: that one
//: times a request that is usually instant (a cache hit) or already bounded by
//: NHTSA's own timeouts, and shortening THIS call to match it would abort a
//: genuine cold generation early.
const KNOWN_ISSUES_REQUEST_TIMEOUT_MS = 40_000;

export async function postCapture(
  apiBaseUrl: string,
  payload: CapturePayload,
): Promise<CaptureResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/v1/captures`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      // The body carries Pydantic's field-level detail, which is what tells you
      // whether the extension and the API contract have drifted apart.
      throw new Error(`API ${response.status}: ${text.slice(0, 500)}`);
    }

    return JSON.parse(text) as CaptureResponse;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the evaluation for an already-ingested capture (spec 7).
 *
 * Separate from `postCapture` on purpose. Ingestion is the durable act -- spec
 * 4.4's append-only observations -- and evaluation is a derived read. Keeping
 * them apart means a scoring failure shows an error in the overlay instead of
 * losing a capture the user would have to click again to recreate.
 */
export async function fetchEvaluation(
  apiBaseUrl: string,
  captureId: number,
): Promise<EvaluationResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${apiBaseUrl.replace(/\/$/, "")}/v1/evaluations/${captureId}`,
      { signal: controller.signal },
    );
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${text.slice(0, 500)}`);
    }
    return JSON.parse(text) as EvaluationResponse;
  } finally {
    clearTimeout(timer);
  }
}

const EVALUATION_RETRY_DELAY_MS = 1_500;

/**
 * `fetchEvaluation`, retried once after a short delay.
 *
 * `GET /v1/evaluations/{id}` recomputes the whole assessment on every call --
 * VIN decode and NHTSA recalls/complaints, neither of which is free on a cold
 * cache -- and the endpoint never checks for client disconnection, so a
 * request the client gave up on keeps running server-side and finishes
 * populating those caches anyway. (Spec 6.6's known-issues call is NOT among
 * these any more: `evaluate_capture` always defers it, so this endpoint never
 * blocks on it -- see `fetchKnownIssues` below for the one place that does.)
 * A vehicle combination this backend hasn't priced before can still take long
 * enough to trip `REQUEST_TIMEOUT_MS`, which used to surface as the capture
 * succeeding with no evaluation and no overlay at all. One retry, after a
 * pause to let the first attempt actually finish server-side, turns that into
 * an evaluation that appears a couple of seconds late instead of not
 * appearing.
 */
export async function fetchEvaluationWithRetry(
  apiBaseUrl: string,
  captureId: number,
): Promise<EvaluationResponse> {
  try {
    return await fetchEvaluation(apiBaseUrl, captureId);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, EVALUATION_RETRY_DELAY_MS));
    return fetchEvaluation(apiBaseUrl, captureId);
  }
}

/**
 * The AI Insights click (spec 6.6, 10): `POST /v1/evaluations/{id}/known-issues`.
 *
 * Only called once the overlay already knows (from the eager evaluation's own
 * `known_issues_pending`) that the gate allows a call and nothing is cached
 * yet -- so, unlike `fetchEvaluationWithRetry`, this is deliberately NOT
 * retried. A click that times out on a genuine cold generation should surface
 * as a retry affordance the user chooses to press again, not a second paid
 * call fired automatically behind their back.
 */
export async function fetchKnownIssues(
  apiBaseUrl: string,
  captureId: number,
): Promise<KnownIssuesFetchResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), KNOWN_ISSUES_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${apiBaseUrl.replace(/\/$/, "")}/v1/evaluations/${captureId}/known-issues`,
      { method: "POST", signal: controller.signal },
    );
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${text.slice(0, 500)}`);
    }
    return JSON.parse(text) as KnownIssuesFetchResponse;
  } finally {
    clearTimeout(timer);
  }
}

// --- accounts and saved evaluations -----------------------------------------

/**
 * Raised when the backend says 401.
 *
 * Distinguished from every other failure because it is the one the UI can act
 * on: a stored token that no longer resolves means the session expired or was
 * revoked, and the right response is to clear it and offer sign-in again rather
 * than to show "API 401" to somebody who thought they were signed in.
 */
export class UnauthorizedError extends Error {}

/**
 * One JSON request against the API, with the session token if there is one.
 *
 * `Authorization: Bearer` rather than a cookie, because a chrome-extension://
 * origin cannot usefully carry one. The website will send the same session as
 * an httpOnly cookie; the backend resolves both through one dependency
 * (`app/auth/dependencies.py`), so the two surfaces cannot drift apart on what
 * counts as a valid session.
 */
async function apiRequest<T>(
  apiBaseUrl: string,
  path: string,
  options: { method?: string; token?: string | null; body?: unknown } = {},
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.token) headers["Authorization"] = `Bearer ${options.token}`;

    const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });

    if (response.status === 401) throw new UnauthorizedError("Not signed in.");

    const text = await response.text();

    if (!response.ok) {
      // FastAPI puts the human-readable reason in `detail`, and for this set of
      // endpoints it is written to be read by a user ("That code is not
      // right."). Falling back to the raw body keeps unexpected shapes
      // debuggable rather than collapsing them to "request failed".
      let detail = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { detail?: unknown };
        if (typeof parsed.detail === "string") detail = parsed.detail;
      } catch {
        /* not JSON; the raw body is the best available message */
      }
      throw new Error(detail || `API ${response.status}`);
    }

    return text ? (JSON.parse(text) as T) : null;
  } finally {
    clearTimeout(timer);
  }
}

export function requestSignInCode(apiBaseUrl: string, email: string): Promise<unknown> {
  return apiRequest(apiBaseUrl, "/v1/auth/sign-in", { method: "POST", body: { email } });
}

export function verifySignInCode(
  apiBaseUrl: string,
  email: string,
  code: string,
): Promise<{ token: string; user: { email: string } } | null> {
  return apiRequest(apiBaseUrl, "/v1/auth/verify", {
    method: "POST",
    body: { email, code, client: "extension" },
  });
}

export function signOut(apiBaseUrl: string, token: string): Promise<unknown> {
  return apiRequest(apiBaseUrl, "/v1/auth/sign-out", { method: "POST", token });
}

export function fetchSavedState(
  apiBaseUrl: string,
  token: string,
  captureId: number,
): Promise<{ saved: boolean } | null> {
  return apiRequest(apiBaseUrl, `/v1/evaluations/${captureId}/save`, { token });
}

export function saveEvaluation(
  apiBaseUrl: string,
  token: string,
  captureId: number,
): Promise<unknown> {
  return apiRequest(apiBaseUrl, `/v1/evaluations/${captureId}/save`, {
    method: "POST",
    token,
  });
}

export function unsaveEvaluation(
  apiBaseUrl: string,
  token: string,
  captureId: number,
): Promise<unknown> {
  return apiRequest(apiBaseUrl, `/v1/evaluations/${captureId}/save`, {
    method: "DELETE",
    token,
  });
}
