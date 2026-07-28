import type { CapturePayload, CaptureResponse, EvaluationResponse } from "../shared/types";

const REQUEST_TIMEOUT_MS = 30_000;

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
 * VIN decode, NHTSA recalls/complaints, and the known-issues LLM call, none of
 * which are free on a cold cache -- and the endpoint never checks for client
 * disconnection, so a request the client gave up on keeps running server-side
 * and finishes populating those caches anyway. A vehicle combination this
 * backend hasn't priced before can take long enough to trip
 * `REQUEST_TIMEOUT_MS`, which used to surface as the capture succeeding with
 * no evaluation and no overlay at all. One retry, after a pause to let the
 * first attempt actually finish server-side, turns that into an evaluation
 * that appears a couple of seconds late instead of not appearing.
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
