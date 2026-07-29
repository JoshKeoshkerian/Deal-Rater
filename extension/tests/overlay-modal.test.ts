/**
 * The overlay as a modal, and the things it never used to do.
 *
 * Before this, the only ways out were the close button and a backdrop click.
 * Both need a mouse, and the panel covers the page the user would otherwise
 * click -- so a keyboard user who opened an evaluation had no way to dismiss
 * it. Escape is the fix, and it is a behaviour rather than a style, so it gets
 * a test rather than a screenshot.
 *
 * These render the real `renderEvaluation` against happy-dom. Layout-dependent
 * behaviour (the Tab trap filters by `offsetParent`, which needs a layout
 * engine) is deliberately not asserted here -- it is checked by hand in a
 * browser, per the panel's verification steps.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderEvaluation } from "../src/content/overlay";
import type { EvaluationResponse } from "../src/shared/types";

const HOST_ID = "deal-rater-overlay";

function evaluation(over: Partial<EvaluationResponse> = {}): EvaluationResponse {
  return {
    capture_id: 1,
    headline: "A fair deal.",
    vehicle: "2016 Mazda CX-5",
    // Pricing, recalls, complaints and the seller questions all render INSIDE
    // the four breakdown bars, so a fixture with no components has none of
    // them -- the panel correctly says "no dimension could be assessed".
    deal_score: {
      score: 74,
      components: [
        { name: "price_residual", weight: 56, value: 64, unavailable_reason: null },
        { name: "vehicle_risk", weight: 25, value: 82, unavailable_reason: null },
        { name: "seller_and_scam_risk", weight: 10, value: 100, unavailable_reason: null },
        { name: "information_completeness", weight: 9, value: 88, unavailable_reason: null },
      ],
      coverage: 1,
      suppressed_reason: null,
      beta: true,
    },
    pricing: {
      ask_cents: 1_490_000,
      expected_asking_cents: 1_405_000,
      asking_interval_low_cents: 1_380_000,
      asking_interval_high_cents: 1_430_000,
      interval_coverage: 0.8,
      strong_offer_cents: 1_320_000,
      walk_away_above_cents: 1_460_000,
      residual_fraction: 0.06,
      rating: 64,
      rating_band: "plateau",
      rating_calibrated: false,
      estimator: "mileage_regression",
      comps_included: 31,
      comps_with_mileage: 29,
      year_window: 1,
      year_window_widened: false,
      confidence: "high",
      confidence_reasons: [],
      confidence_limiters: [],
      fallback_reasons: [],
    },
    completeness: { present: ["price"], missing: ["VIN"] },
    vehicle_details: {
      year: 2016,
      make: "Mazda",
      model: "CX-5",
      mileage: 92_000,
      title_status: "clean",
      seller_type: "private_party",
      owner_count: "one",
    },
    vehicle_risk: {
      title_risk: "clean",
      title_message: "Seller states a clean title.",
      decoded_spec: null,
      recall_count: 3,
      complaint_count: 412,
      top_complaint_components: [["ELECTRICAL SYSTEM", 96]],
      recall_messages: ["3 recall campaigns.", "Ask for service records."],
      complaint_messages: ["Not adjusted for how many were sold."],
    },
    seller_risk: null,
    negotiation: {
      leverage: "strong",
      strength: 78,
      days_listed: 38,
      time_on_market_score: 80,
      leverage_points: ["Listed 38 days."],
      suggested_offer_cents: 1_285_000,
      motivated_phrases: ["moving"],
      rigid_phrases: [],
    },
    alternatives: {
      message: "2 comparable listings are better priced.",
      target_is_best: false,
      items: [
        {
          description: "2016 Mazda CX-5 - $13,200, 71,400 mi, Kirkwood, MO",
          url: "https://www.facebook.com/marketplace/item/1",
          price_cents: 1_320_000,
          mileage: 71_400,
          location_text: "Kirkwood, MO",
          advantage: 0.12,
          mileage_tradeoff: false,
        },
      ],
      withheld: [],
    },
    known_issues: null,
    known_issues_unavailable_reason: null,
    known_issues_unavailable_code: null,
    notices: ["Marketplace shows asking prices, not sale prices."],
    ...over,
  };
}

/** The panel animates out, so removal lands on a timer rather than at once. */
function press(key: string): void {
  window.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
}

beforeEach(() => {
  document.getElementById(HOST_ID)?.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
  // The theme control reads and writes the appearance setting. It renders at
  // its default and corrects itself when storage answers, so a stub that
  // simply echoes the defaults is enough for everything under test here.
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      sync: {
        get: async (defaults: unknown) => defaults,
        set: async () => undefined,
      },
    },
  };
});

describe("the overlay as a modal", () => {
  it("mounts a shadow root with the evaluation in it", () => {
    renderEvaluation(evaluation());
    const host = document.getElementById(HOST_ID)!;
    expect(host).not.toBeNull();
    expect(host.shadowRoot!.querySelector(".sheet")).not.toBeNull();
    expect(host.shadowRoot!.textContent).toContain("2016 Mazda CX-5");
  });

  it("announces itself as a dialog", () => {
    renderEvaluation(evaluation());
    const sheet = document.getElementById(HOST_ID)!.shadowRoot!.querySelector(".sheet")!;
    expect(sheet.getAttribute("role")).toBe("dialog");
    expect(sheet.getAttribute("aria-modal")).toBe("true");
  });

  it("closes on Escape", async () => {
    vi.useFakeTimers();
    renderEvaluation(evaluation());
    expect(document.getElementById(HOST_ID)).not.toBeNull();

    press("Escape");
    // The exit transition is given a frame to run; the timer is what removes
    // the host when there is no transition to end (reduced motion, or here).
    await vi.advanceTimersByTimeAsync(500);
    expect(document.getElementById(HOST_ID)).toBeNull();
  });

  it("stops listening for Escape once it is closed", async () => {
    vi.useFakeTimers();
    renderEvaluation(evaluation());
    press("Escape");
    await vi.advanceTimersByTimeAsync(500);

    // A listener left on the window would swallow Escape for the page
    // underneath -- Facebook's own dialogs use it.
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    press("Escape");
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", seen);
  });

  it("ignores keys that are not Escape or Tab", async () => {
    vi.useFakeTimers();
    renderEvaluation(evaluation());
    press("a");
    await vi.advanceTimersByTimeAsync(500);
    expect(document.getElementById(HOST_ID)).not.toBeNull();
  });

  it("replaces a panel that is already open rather than stacking one on it", () => {
    renderEvaluation(evaluation());
    renderEvaluation(evaluation({ vehicle: "2013 Ford Focus" }));
    expect(document.querySelectorAll(`#${HOST_ID}`)).toHaveLength(1);
    expect(document.getElementById(HOST_ID)!.shadowRoot!.textContent).toContain("Ford Focus");
  });
});

describe("expand all / collapse all", () => {
  function shadow() {
    return document.getElementById(HOST_ID)!.shadowRoot!;
  }

  function toggleAllButton(): HTMLButtonElement {
    return shadow().querySelector<HTMLButtonElement>(".toggle-all")!;
  }

  it("starts reading Expand all, since nothing opens by default", () => {
    renderEvaluation(evaluation());
    expect(toggleAllButton().textContent).toBe("Expand all");
  });

  it("opens every disclosure on click and switches to Collapse all", () => {
    renderEvaluation(evaluation());
    toggleAllButton().click();
    const rows = shadow().querySelectorAll("details");
    expect(rows.length).toBeGreaterThan(0);
    expect(Array.from(rows).every((row) => (row as HTMLDetailsElement).open)).toBe(true);
    expect(toggleAllButton().textContent).toBe("Collapse all");
  });

  it("closes everything again on a second click", () => {
    renderEvaluation(evaluation());
    toggleAllButton().click();
    toggleAllButton().click();
    const rows = shadow().querySelectorAll("details");
    expect(Array.from(rows).some((row) => (row as HTMLDetailsElement).open)).toBe(false);
    expect(toggleAllButton().textContent).toBe("Expand all");
  });

  it("switches to Collapse all the moment a single row is opened by hand", () => {
    // This is the behaviour that was missing: opening one disclosure directly
    // (clicking its own summary, not this button) used to leave the button
    // reading "Expand all" with something already expanded.
    renderEvaluation(evaluation());
    const first = shadow().querySelector<HTMLDetailsElement>("details")!;
    expect(toggleAllButton().textContent).toBe("Expand all");

    first.open = true;
    expect(toggleAllButton().textContent).toBe("Collapse all");

    first.open = false;
    expect(toggleAllButton().textContent).toBe("Expand all");
  });
});

describe("what the panel is not allowed to drop", () => {
  const text = () => {
    renderEvaluation(evaluation());
    return document.getElementById(HOST_ID)!.shadowRoot!.textContent ?? "";
  };

  it("keeps the beta label (spec 9)", () => {
    expect(text()).toContain("BETA");
  });

  it("keeps the liability framing in the UI, not just the terms (spec 7)", () => {
    expect(text()).toContain("not a purchase recommendation");
  });

  it("keeps spec 4.5's asking-vs-sale-price notice", () => {
    expect(text()).toContain("asking prices, not sale prices");
  });

  it("renders all four of spec 5.1's figures, not two", () => {
    // strong_offer_cents and walk_away_above_cents were serialized by the
    // backend and displayed nowhere at all.
    const body = text();
    expect(body).toContain("$14,900"); // the ask
    expect(body).toContain("$13,800"); // interval low
    expect(body).toContain("$14,300"); // interval high
    expect(body).toContain("$13,200"); // strong offer
    expect(body).toContain("$14,600"); // walk away above
  });

  it("renders the complaint data the backend has always sent", () => {
    const body = text();
    expect(body).toContain("412");
    expect(body.toLowerCase()).toContain("electrical system");
  });

  it("shows an alternative's price difference against this listing", () => {
    expect(text()).toContain("$1,700 less");
  });
});
