/**
 * AI Insights: the merged spec 6.6 section, and its one lazy fetch.
 *
 * Drives `buildAiInsights` directly rather than through `renderEvaluation`,
 * same reasoning as `overlay-bookmark.test.ts`: what is under test is a state
 * machine over responses from the service worker (for the "pending" case) and
 * a set of static renders (for the other two), not the whole panel.
 *
 * The worker is a stub that records what was asked and answers with whatever
 * the test sets, exactly like `overlay-bookmark.test.ts`'s. Nothing here
 * touches the network.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { buildAiInsights } from "../src/content/overlay/ai-insights";
import type { EvaluationResponse, KnownIssuesReport } from "../src/shared/types";

type Sent = { type: string; [key: string]: unknown };

let sent: Sent[] = [];
let reply: (message: Sent) => unknown;

/** Let every queued promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function stubWorker() {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: async (message: Sent) => {
        sent.push(message);
        return reply(message);
      },
    },
  };
}

function report(overrides: Partial<KnownIssuesReport> = {}): KnownIssuesReport {
  return {
    summary: "This generation is generally durable, with one known weak point.",
    failure_modes: ["The dual-clutch transmission shudders at low speed."],
    inspect: ["Drive it from a stop in traffic and feel for shudder."],
    ask: ["Ask whether the clutch pack has been replaced."],
    ownership_notes: ["Transmission work on this car is dealer-only in most areas."],
    model: "claude-haiku-4-5",
    mileage_band: "75-100k",
    generated_at: "2026-08-01T00:00:00Z",
    cached: false,
    ...overrides,
  };
}

function data(overrides: Partial<EvaluationResponse> = {}): EvaluationResponse {
  return {
    capture_id: 42,
    known_issues: null,
    known_issues_unavailable_reason: null,
    known_issues_unavailable_code: null,
    known_issues_pending: false,
    ...overrides,
  } as EvaluationResponse;
}

beforeEach(() => {
  sent = [];
  reply = () => ({ ok: false, error: "no reply configured" });
  stubWorker();
});

describe("already answered, for free", () => {
  it("renders the merged report immediately and asks the worker nothing", async () => {
    const node = buildAiInsights(data({ known_issues: report() }))!;
    expect(node).not.toBeNull();
    expect(node.textContent).toContain("dual-clutch transmission");
    expect(node.textContent).toContain("Ask whether the clutch pack has been replaced.");

    (node as HTMLDetailsElement).open = true;
    await settle();
    expect(sent).toEqual([]);
  });

  it("shows the standard-checklist note when there are no vehicle-specific questions", () => {
    const node = buildAiInsights(data({ known_issues: report({ ask: [] }) }))!;
    expect(node.textContent).toContain("standard checklist");
  });
});

describe("declined by the gate", () => {
  it("shows the verdict and asks the worker nothing", async () => {
    const node = buildAiInsights(
      data({ known_issues_unavailable_reason: "Salvage title.", known_issues_unavailable_code: "title_disqualifier" }),
    )!;
    expect(node).not.toBeNull();
    expect(node.textContent).toContain("Salvage title.");

    (node as HTMLDetailsElement).open = true;
    await settle();
    expect(sent).toEqual([]);
  });

  it("is hidden entirely for a deployment reason, not shown as a verdict", () => {
    const node = buildAiInsights(
      data({
        known_issues_unavailable_reason: "Not available: no Claude API key is configured.",
        known_issues_unavailable_code: "deployment_not_configured",
      }),
    );
    expect(node).toBeNull();
  });

  it("is hidden entirely when there is nothing to show and nothing to fetch", () => {
    expect(buildAiInsights(data())).toBeNull();
  });
});

describe("not yet generated", () => {
  it("renders a clickable section without asking the worker anything up front", () => {
    const node = buildAiInsights(data({ known_issues_pending: true }))!;
    expect(node).not.toBeNull();
    expect(sent).toEqual([]);
  });

  it("asks the worker only once the section is opened", async () => {
    const node = buildAiInsights(data({ known_issues_pending: true, capture_id: 7 }))! as HTMLDetailsElement;
    expect(sent).toEqual([]);

    reply = () => ({ ok: true, result: { known_issues: report(), known_issues_unavailable_reason: null, known_issues_unavailable_code: null } });
    node.open = true;
    await settle();

    expect(sent).toEqual([{ type: "FETCH_KNOWN_ISSUES", captureId: 7 }]);
  });

  it("shows a busy state between the click and the reply", async () => {
    const node = buildAiInsights(data({ known_issues_pending: true }))! as HTMLDetailsElement;
    let resolveReply: (value: unknown) => void = () => undefined;
    reply = () => new Promise((resolve) => (resolveReply = resolve));

    node.open = true;
    expect(node.textContent).toContain("Generating");

    resolveReply({
      ok: true,
      result: { known_issues: report(), known_issues_unavailable_reason: null, known_issues_unavailable_code: null },
    });
    await settle();
    expect(node.textContent).toContain("dual-clutch transmission");
  });

  it("renders the report once the fetch resolves", async () => {
    const node = buildAiInsights(data({ known_issues_pending: true }))! as HTMLDetailsElement;
    reply = () => ({
      ok: true,
      result: { known_issues: report(), known_issues_unavailable_reason: null, known_issues_unavailable_code: null },
    });

    node.open = true;
    await settle();

    expect(node.textContent).toContain("dual-clutch transmission");
    expect(node.textContent).toContain("Ask whether the clutch pack has been replaced.");
  });

  it("renders the gate's verdict when the click itself lands on a decline", async () => {
    const node = buildAiInsights(data({ known_issues_pending: true }))! as HTMLDetailsElement;
    reply = () => ({
      ok: true,
      result: {
        known_issues: null,
        known_issues_unavailable_reason: "The description says \"for parts\".",
        known_issues_unavailable_code: "hard_disqualifier",
      },
    });

    node.open = true;
    await settle();

    expect(node.textContent).toContain("for parts");
  });

  it("shows an error and a retry affordance on failure", async () => {
    const node = buildAiInsights(data({ known_issues_pending: true }))! as HTMLDetailsElement;
    reply = () => ({ ok: false, error: "the server said no" });

    node.open = true;
    await settle();

    expect(node.textContent).toContain("the server said no");
    const retry = node.querySelector<HTMLButtonElement>(".ai-insights-retry");
    expect(retry).not.toBeNull();
  });

  it("retries on request, and succeeds the second time", async () => {
    const node = buildAiInsights(data({ known_issues_pending: true }))! as HTMLDetailsElement;
    reply = () => ({ ok: false, error: "the server said no" });

    node.open = true;
    await settle();

    reply = () => ({
      ok: true,
      result: { known_issues: report(), known_issues_unavailable_reason: null, known_issues_unavailable_code: null },
    });
    node.querySelector<HTMLButtonElement>(".ai-insights-retry")!.click();
    await settle();

    expect(sent.filter((m) => m.type === "FETCH_KNOWN_ISSUES")).toHaveLength(2);
    expect(node.textContent).toContain("dual-clutch transmission");
  });

  it("ignores a close-then-reopen while the first request is still in flight", async () => {
    const node = buildAiInsights(data({ known_issues_pending: true }))! as HTMLDetailsElement;
    reply = () => new Promise(() => undefined); // never resolves within this test

    node.open = true;
    node.open = false;
    node.open = true;
    await settle();

    expect(sent.filter((m) => m.type === "FETCH_KNOWN_ISSUES")).toHaveLength(1);
  });

  it("survives the messaging channel being gone", async () => {
    // What Chrome does after the extension is reloaded under a live page: a
    // synchronous throw, which a bare .then().catch() would never see.
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        sendMessage: () => {
          throw new Error("Extension context invalidated.");
        },
      },
    };

    const node = buildAiInsights(data({ known_issues_pending: true }))! as HTMLDetailsElement;
    node.open = true;
    await settle();

    expect(node.textContent).toContain("Could not reach the server.");
  });
});
