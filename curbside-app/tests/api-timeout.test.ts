import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, fetchMe } from "@/lib/api";

/**
 * Regression coverage: `request()` used to have no `AbortSignal`/timeout at
 * all, so a hung request would wait forever. It now aborts after a bounded
 * timeout and throws a distinguishable `ApiError` instead of hanging.
 */
describe("lib/api request timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("rejects with an ApiError once the request has been pending too long", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        // A fetch that never resolves on its own — only the AbortController
        // set up by `request()` can end it, exactly like a stalled connection.
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new DOMException("The operation was aborted.", "AbortError");
            reject(error);
          });
        });
      }),
    );

    const pending = fetchMe();
    const assertion = expect(pending).rejects.toBeInstanceOf(ApiError);

    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });
});
