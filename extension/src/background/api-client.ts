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
