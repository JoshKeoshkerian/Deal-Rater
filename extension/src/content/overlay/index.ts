/**
 * The evaluation overlay.
 *
 * EXPERIMENT: SCORE BREAKDOWN AS THE STAR OF THE SHOW
 * -----------------------------------------------------
 * Pricing, Risk and Questions to ask the seller no longer have their own
 * top-level sections. Each of the score breakdown's four dimension bars is
 * now its own dropdown, and expanding one reveals everything that dimension
 * is made of -- see `breakdown.ts`'s `componentDetail`:
 *
 *   price residual          -> Pricing (spec 5.1's four numbers, drawn)
 *   information completeness -> which fields the seller stated vs. left out
 *   vehicle risk             -> recalls + complaints + the model's read
 *   seller and scam risk     -> red flags (incl. title status) + questions
 *
 * VERTICAL ORDER
 * ---------------
 * Headline -> score breakdown -> Negotiation -> Better alternatives. The
 * latter two are not deal-score dimensions (spec 6.4 keeps negotiation
 * strength out of the composite on purpose), so they stay their own
 * disclosures rather than living under a bar that doesn't exist for them.
 *
 * THREE THINGS THE MARKUP IS NOT ALLOWED TO DROP
 * ----------------------------------------------
 * 1. THE SCORE BREAKDOWN. Spec 5.2: the composite "is a summary of the
 *    separated dimensions... not a replacement for them, and the UI should
 *    ALWAYS show the breakdown alongside it."
 *
 * 2. THE LIABILITY FRAMING. Spec 7: "informational analysis of a listing, not a
 *    purchase recommendation... IN THE UI, not just the terms."
 *
 * 3. THE BETA LABEL. Spec 9: "Until step 1 is done, present output as a beta
 *    signal, not an authoritative rating." `deal_score.beta` is always true.
 *
 * IT IS A MODAL, SO IT BEHAVES LIKE ONE
 * -------------------------------------
 * Escape closes it, Tab cycles inside it, and focus goes back to the Capture
 * button on the way out. None of that was here before: the only exits were the
 * close button and a backdrop click, which is a dead end for anyone not using
 * a mouse -- on a page they cannot reach either, because the overlay covers it.
 *
 * Shadow DOM throughout, for the same reason as the trigger button: Facebook's
 * stylesheet and this one must not be able to reach each other.
 */

import { loadSettings, saveSettings } from "../../shared/settings";
import type { EvaluationResponse } from "../../shared/types";
import { buildBreakdown } from "./breakdown";
import { animateFills, disclosure, el, section } from "./elements";
import { buildHeader } from "./headline";
import { alternativesSummary, buildAlternatives, buildNegotiation, negotiationSummary } from "./sections";
import { stylesheet } from "./styles";
import {
  isThemePreference,
  nextTheme,
  resolveTheme,
  systemPrefersDark,
  themeAttribute,
  themeControlText,
  type ThemePreference,
} from "./theme";

const HOST_ID = "deal-rater-overlay";
const TRIGGER_ID = "deal-rater-trigger";

/** Everything in the sheet a Tab can land on. */
const FOCUSABLE = 'button, a[href], summary, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Spec 7's liability framing, plus spec 4.5's asking-vs-sale-price notice,
 * as one block rather than three stacked greys.
 */
function buildNotices(data: EvaluationResponse): HTMLElement {
  const node = el("div", "notices");
  const body = el("p");
  body.append(
    el("strong", undefined, "Beta signal, not a rating. "),
    el(
      "span",
      undefined,
      "The weights and the discount curve are starting hypotheses that have not been " +
        "checked against hand-evaluated listings yet. This is an informational analysis of " +
        "one listing, not a purchase recommendation, and never a substitute for a " +
        "pre-purchase inspection or a vehicle history report.",
    ),
  );
  node.append(body);

  // Spec 4.5's asking-vs-sale-price distinction used to live inline in the
  // pricing section; that section is now trimmed to its figures and the gauge,
  // so this is the only place left to say it -- it must not go missing.
  const known = /beta signal|informational analysis/i;
  for (const notice of data.notices) {
    if (!known.test(notice)) node.append(el("p", undefined, notice));
  }
  return node;
}

/**
 * The theme control.
 *
 * Built here rather than in `headline.ts` because choosing a theme means
 * reading and writing settings, and that module renders an evaluation. The
 * button appears immediately at the default and corrects itself when storage
 * answers -- a read that takes about a millisecond, behind a network round trip
 * the user has already waited on, so the correction is never seen.
 */
function buildThemeControl(host: HTMLElement): HTMLElement {
  const button = el("button", "theme-toggle") as HTMLButtonElement;
  button.type = "button";

  let preference: ThemePreference = "auto";

  const paint = () => {
    const resolved = resolveTheme(preference, systemPrefersDark());
    const attribute = themeAttribute(preference);
    if (attribute) host.dataset["theme"] = attribute;
    else delete host.dataset["theme"];

    const { glyph, label } = themeControlText(preference, resolved);
    button.textContent = glyph;
    button.title = label;
    button.setAttribute("aria-label", label);
  };

  paint();

  // Swallowed rather than surfaced: the panel has already rendered at the
  // default, and a storage read that fails means the user sees the system
  // theme instead of their saved one. That is a cosmetic degradation, and it
  // has no business raising an unhandled rejection in someone's console on
  // facebook.com. Same for the write.
  void loadSettings()
    .then((settings) => {
      if (isThemePreference(settings.theme)) {
        preference = settings.theme;
        paint();
      }
    })
    .catch(() => undefined);

  button.addEventListener("click", () => {
    preference = nextTheme(preference);
    paint();
    void saveSettings({ theme: preference }).catch(() => undefined);
  });

  return button;
}

/**
 * One click to open or close every disclosure in the panel.
 *
 * The label tracks whatever is ACTUALLY open, not just what this button last
 * did. Opening a single row by hand -- clicking "Price Residual" directly --
 * used to leave the button reading "Expand all" with something already
 * expanded, which is backwards: the moment anything is open, the one useful
 * action left is to close it, so the label should already say so.
 */
function buildExpandAll(sheet: HTMLElement): HTMLElement {
  const button = el("button", "toggle-all", "Expand all") as HTMLButtonElement;
  button.type = "button";

  const rows = () => Array.from(sheet.querySelectorAll<HTMLDetailsElement>("details"));

  const sync = () => {
    button.textContent = rows().some((row) => row.open) ? "Collapse all" : "Expand all";
  };

  button.addEventListener("click", () => {
    const opening = !rows().some((row) => row.open);
    for (const row of rows()) row.open = opening;
    sync();
  });

  // A <details> element's "toggle" event does not bubble, so a listener on an
  // ancestor in the bubble phase would never see one fired by a row opened or
  // closed by hand. The capture phase is not gated by that flag -- it always
  // reaches every ancestor on the way down to the target -- which is what lets
  // one listener here catch every row without attaching one to each.
  sheet.addEventListener("toggle", sync, true);

  return button;
}

export function renderEvaluation(data: EvaluationResponse): void {
  document.getElementById(HOST_ID)?.remove();

  const host = el("div");
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = stylesheet();

  const backdrop = el("div", "backdrop");
  const sheet = el("div", "sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", `Deal evaluation for ${data.vehicle}`);

  let dismissed = false;

  /**
   * Reverse the entry transition, then remove.
   *
   * The timeout is not a fallback for a slow transition -- it is the only path
   * when there is no transition to end at all, which is what
   * `prefers-reduced-motion` produces. Whichever fires first wins and the other
   * is cancelled.
   */
  const close = () => {
    if (dismissed) return;
    dismissed = true;
    window.removeEventListener("keydown", onKeydown, true);
    backdrop.dataset["open"] = "false";

    const finish = () => {
      host.remove();
      // The overlay covered the page the Capture button lives on. Leaving focus
      // on a removed node drops a keyboard user back at the top of Facebook.
      const trigger = document.getElementById(TRIGGER_ID);
      trigger?.shadowRoot?.querySelector<HTMLButtonElement>("button")?.focus();
    };

    const timer = setTimeout(finish, 400);
    backdrop.addEventListener("transitionend", (event) => {
      if (event.target !== backdrop || (event as TransitionEvent).propertyName !== "opacity") return;
      clearTimeout(timer);
      finish();
    });
  };

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;

    // A modal that lets Tab escape into the page behind it is a modal only for
    // the mouse. `root.activeElement` rather than `document.activeElement`:
    // from outside the shadow boundary the latter is always the host.
    const stops = Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (node) => !(node as HTMLButtonElement).disabled && node.offsetParent !== null,
    );
    if (stops.length === 0) return;

    const first = stops[0]!;
    const last = stops[stops.length - 1]!;
    const active = root.activeElement as HTMLElement | null;

    if (event.shiftKey && (active === first || active === null)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  window.addEventListener("keydown", onKeydown, true);

  // 1. Headline, in whichever state the evidence supports.
  sheet.append(buildHeader(data, close, buildThemeControl(host)));

  // The breakdown belongs with the headline (spec 5.2) and is the section
  // closest to it for that reason -- nothing else renders between them.
  // Always open, not a disclosure: spec 5.2 wants it shown "alongside" the
  // score, not one click away from it. Pricing, Risk and Questions to ask the
  // seller now live inside its four bars -- see the module docstring.
  sheet.append(
    section("Score breakdown", buildBreakdown(data), undefined, buildExpandAll(sheet))!,
  );

  // 2. Negotiation.
  sheet.append(
    disclosure("Negotiation", negotiationSummary(data), buildNegotiation(data)),
  );

  // 3. Better alternatives.
  sheet.append(
    disclosure("Better alternatives", alternativesSummary(data), buildAlternatives(data)),
  );

  sheet.append(buildNotices(data));

  backdrop.append(sheet);
  root.append(style, backdrop);
  document.body.append(host);

  // Entry, and every bar and meter in the panel, on the frame after mount.
  // Both need the browser to have laid the elements out at their starting
  // values first, or there is nothing to transition from.
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      backdrop.dataset["open"] = "true";
    });
  } else {
    backdrop.dataset["open"] = "true";
  }
  animateFills(sheet);

  // The close button is the way out of an overlay covering somebody else's
  // page, so it is where focus starts.
  root.querySelector<HTMLButtonElement>("button.close")?.focus();
}
