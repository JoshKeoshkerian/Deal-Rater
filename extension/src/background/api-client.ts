import type { CapturePayload, CaptureResponse } from "../shared/types";

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
