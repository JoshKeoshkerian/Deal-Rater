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
    // Pricing, recalls and complaints all render INSIDE the four breakdown
    // bars, so a fixture with no components has none of them -- the panel
    // correctly says "no dimension could be assessed". AI Insights is a
    // sibling section instead (`known_issues*` below), not nested in a bar.
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
      offer: {
        stance: "negotiate",
        basis: "comps",
        opening_cents: 1_310_000,
        target_cents: 1_380_000,
        walk_away_cents: 1_460_000,
        reasoning: ["Comparable listings support about $13,800."],
        caveat: null,
        withheld_reason: null,
      },
      opening_message: "Hi -- is the 2016 Mazda CX-5 still available?",
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
      different_trim: [],
    },
    known_issues: null,
    known_issues_unavailable_reason: null,
    known_issues_unavailable_code: null,
    known_issues_pending: false,
    helpful_links: [
      {
        label: "Kelley Blue Book",
        url: "https://www.kbb.com/mazda/cx-5/2016/",
        note: "Independent pricing reference.",
      },
      {
        label: "Consumer Reports",
        url: "https://www.consumerreports.org/cars/mazda/cx-5/2016/overview/",
        note: "Reliability history and owner satisfaction for this model.",
      },
    ],
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
  // The bookmark control asks the service worker whether this evaluation is
  // saved as soon as it mounts. Answering "nobody is signed in" is the state
  // every one of these tests renders in, and it is the honest default: these
  // assertions are about the panel, not about an account.
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      sync: {
        get: async (defaults: unknown) => defaults,
        set: async () => undefined,
      },
    },
    runtime: {
      sendMessage: async () => ({ ok: true, signedIn: false }),
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

/**
 * The negotiation section, whose whole reason for being reworked is that on most
 * listings it rendered a 0-100 meter, a leverage word and a day count -- and no
 * figure at all, because the offer was gated on comp anchors the backend
 * withholds roughly 19 times in 20.
 */
describe("negotiation (spec 6.4, 7.5)", () => {
  const render = (over: Partial<EvaluationResponse> = {}) => {
    renderEvaluation(evaluation(over));
    return document.getElementById(HOST_ID)!.shadowRoot!;
  };

  /**
   * The negotiation disclosure's own body.
   *
   * Scoped rather than `querySelector(".disclosure-body")`, which would land on
   * whichever disclosure the panel happens to render first -- currently one nested
   * inside a breakdown bar.
   */
  const negotiationBody = (root: ShadowRoot): Element => {
    const found = Array.from(root.querySelectorAll("details.disclosure")).find(
      (node) => node.querySelector(".disclosure-title")?.textContent === "Negotiation",
    );
    return found!.querySelector(".disclosure-body")!;
  };

  it("renders the offer ladder rather than one unlabelled figure", () => {
    const root = render();
    const body = root.textContent ?? "";
    expect(body).toContain("Open at");
    expect(body).toContain("$13,100");
    expect(body).toContain("Expect to pay");
    expect(body).toContain("$13,800");
    expect(body).toContain("Walk away above");
  });

  const askAnchored = (over: Partial<EvaluationResponse["negotiation"]> = {}) => ({
    ...evaluation().negotiation,
    offer: {
      stance: "negotiate",
      basis: "ask",
      opening_cents: 1_310_000,
      target_cents: 1_380_000,
      walk_away_cents: null,
      reasoning: ["Open at $13,100 and expect to settle nearer $13,800."],
      caveat: "These figures come from how long this has been listed, not from comparable prices.",
      withheld_reason: null,
    },
    ...over,
  });

  it("still has figures when the comp set could not name a price", () => {
    // The defect this rework exists for. An ask-anchored plan is the COMMON
    // case, and it has to render as a complete section, not a degraded one.
    const body = render({ negotiation: askAnchored() }).textContent ?? "";
    expect(body).toContain("$13,100");
    // ...and says which claim it is making, so it cannot be read as a market price.
    expect(body).toContain("not from comparable prices");
  });

  it("puts the caveat last and says it once", () => {
    // It used to be said three times, in the middle: in the offer's reasoning, as
    // the panel's own restatement of the same point, and a third time beside the
    // time-on-market graphic when there was no posted date. A reader working
    // towards the offer had to wade through the hedging to reach it.
    const body = negotiationBody(render({ negotiation: askAnchored() }));
    const pills = body.querySelectorAll(".note-pill");
    expect(pills).toHaveLength(1);

    const children = Array.from(body.children);
    expect(children[children.length - 1]).toBe(pills[0]);
  });

  it("does not hedge a comp-anchored offer that has nothing to qualify", () => {
    // Spec 4.5's asking-vs-sale-price point is already a standing notice on the
    // whole evaluation, and repeating it per-section is what made this read as an
    // apology rather than a brief.
    expect(negotiationBody(render()).querySelectorAll(".note-pill")).toHaveLength(0);
  });

  it("draws days listed on an axis instead of scoring it out of 100", () => {
    const body = render().textContent ?? "";
    expect(body).toContain("38 days listed");
    expect(body).toContain("30d");
    // The old meter. An uncalibrated composite that starts at 30 and tops out
    // near 83 has no business being drawn as a score.
    expect(body).not.toContain("Negotiating room");
    expect(body).not.toContain("78/100");
  });

  it("states a missing posted date once, without explaining it twice", () => {
    // The fact goes where the graphic would have been; what it MEANS for the
    // figures goes in the caveat at the bottom. Both used to say both.
    const body =
      negotiationBody(
        render({ negotiation: { ...evaluation().negotiation, days_listed: null } }),
      ).textContent ?? "";
    expect(body).toContain("did not expose a posted date");
    expect(body.match(/posted date/g)).toHaveLength(1);
  });

  it("offers the drafted message as something editable and copyable", () => {
    const root = render({
      negotiation: {
        ...evaluation().negotiation,
        opening_message: "Hi -- is the 2016 Mazda CX-5 still available?",
      },
    });
    const draft = root.querySelector<HTMLTextAreaElement>("textarea.draft-body");
    expect(draft).not.toBeNull();
    expect(draft!.value).toContain("still available");
    expect(root.textContent).toContain("Copy message");
  });

  it("explains itself rather than showing an empty section when withheld", () => {
    const body =
      render({
        negotiation: {
          ...evaluation().negotiation,
          offer: {
            stance: "withheld",
            basis: "none",
            opening_cents: null,
            target_cents: null,
            walk_away_cents: null,
            reasoning: [],
            caveat: null,
            withheld_reason: "This listing has no asking price.",
          },
          opening_message: null,
        },
      }).textContent ?? "";
    expect(body).toContain("no asking price");
  });
});
