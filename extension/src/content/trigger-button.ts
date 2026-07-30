/**
 * The trigger, and the only thing on screen until an evaluation exists.
 *
 * Rendered inside a shadow root so that neither Facebook's stylesheet nor this
 * one can reach the other, and so the button is not affected by the class-name
 * churn that everything else in this project has to work around.
 *
 * IT SHARES THE PANEL'S TOKENS. It used to carry its own hexes and its own font
 * stack, which meant the first thing a user saw and the thing it opened were
 * two different products, and a theme change had to be made twice. Both shadow
 * roots now emit `themeVariables()`.
 *
 * PROGRESS IS A RAIL, NOT A SENTENCE. `runCapture` walks up to five steps and
 * some of them are slow -- the widening pass is several sequential searches.
 * One line of replaced text gives no sense of how far in the run is, so a
 * fifteen-second step reads as a hang. See `capture-stages.ts`.
 *
 * FIXED, BUT NOT BLIND. The dock floats over the page at a fixed position, the
 * way it always has -- this is deliberately NOT mounted inline in the page's
 * own layout, because Facebook's SPA tears out and replaces DOM subtrees on
 * listing-to-listing navigation, and an inline-mounted button gets torn out
 * with them.
 *
 * Its resting spot is a fixed offset from the viewport corner UNLESS
 * `send-anchor.ts` finds Marketplace's own "Send" button, in which case the
 * dock floats a fixed gap above it instead. That element is caller-supplied
 * for the same reason `findSendButtonAnchor` lives in its own module: this
 * file has no business knowing Facebook's markup. The reason it matters: the
 * default corner position sits in the same neighbourhood as the seller's
 * message composer, and a misclick there does not just fail to evaluate a
 * listing -- it sends a half-finished message to a stranger.
 */

import { themeVariables } from "./overlay/tokens";
import { CAPTURE_STEPS, stageIndex, type CaptureStage } from "./capture-stages";

const HOST_ID = "deal-rater-trigger";

const IDLE_LABEL = "Evaluate Listing";
const BUSY_LABEL = "Evaluating…";

/**
 * Every error this button ever shows -- a bad extraction, a network failure,
 * a background-worker timeout -- traces back to one capture run that didn't
 * finish, and the fix is always the same one click. Centralised here rather
 * than appended at each call site in `run-capture.ts`, so the instruction
 * cannot go missing from a message added later.
 */
const RELOAD_HINT = "Reload the page and try again.";

function withReloadHint(text: string): string {
  if (/reload/i.test(text)) return text;
  const trimmed = text.trim();
  const needsStop = trimmed.length > 0 && !/[.!?]$/.test(trimmed);
  return `${trimmed}${needsStop ? "." : ""} ${RELOAD_HINT}`.trim();
}

const RULES = `

  .dock {
    position: fixed;
    /* Defaults for when no Send button was found. mountTriggerButton and
       updateAnchor override right/bottom with inline styles once one is --
       inline styles win over these regardless of specificity, so the
       fallback and the anchored position never fight each other. */
    right: 16px;
    bottom: 16px;
    /* One BELOW the evaluation overlay's backdrop (2147483646), which is the
       whole point. At 2147483647 this panel floated over the open evaluation,
       covering the VIN decode row and the disclaimers at the bottom of the
       sheet -- the two things a reader is most likely to want and least likely
       to think to scroll for. The overlay is modal while it is open; the
       trigger belongs underneath it. */
    z-index: 2147483645;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--sp-3);
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
    transition: right var(--dur-base) var(--ease-out), bottom var(--dur-base) var(--ease-out);
  }

  button.capture {
    font: 650 14px/1 var(--font-sans);
    padding: var(--sp-4) var(--sp-6);
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--accent);
    color: var(--accent-on);
    cursor: pointer;
    box-shadow: var(--elev-2);
    transition: transform var(--dur-fast) var(--ease-out),
                filter var(--dur-fast) var(--ease-out);
  }
  button.capture:hover:not(:disabled) { filter: brightness(1.12); }
  button.capture:active:not(:disabled) { transform: scale(.97); }
  button.capture:disabled { opacity: .7; cursor: default; }
  :where(button, [tabindex]):focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }

  /* The fixture control is secondary to the one action this button exists for,
     and is only ever mounted in a dev build. */
  button.extra {
    font: 600 12px/1 var(--font-sans);
    padding: var(--sp-3) var(--sp-4);
    border: 1px solid var(--border); border-radius: var(--radius-pill);
    background: var(--raised); color: var(--text-dim); cursor: pointer;
  }
  button.extra:hover:not(:disabled) { color: var(--text); border-color: var(--text-faint); }

  /* card ------------------------------------------------------------- */
  .card {
    width: 268px;
    padding: var(--sp-4);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: var(--sheet);
    color: var(--text);
    box-shadow: var(--elev-2);
    font-size: 12.5px;
    line-height: 1.45;
  }
  .card[hidden] { display: none; }
  .card[data-tone="error"] {
    border-color: var(--tone-adverse-border);
    background: var(--tone-adverse-surface);
    color: var(--tone-adverse-on-surface);
  }

  .card-message { margin: 0; }
  .card[data-tone="error"] .card-title {
    display: flex; align-items: baseline; gap: var(--sp-2);
    margin: 0 0 var(--sp-2); font-weight: 700; color: var(--tone-adverse-text);
  }

  /* progress rail ---------------------------------------------------- */
  .rail { display: flex; gap: 3px; margin-bottom: var(--sp-3); }
  /* display:flex beats the hidden attribute, so a terminal message kept
     showing a rail of five pending steps under it -- a finished run that looks
     like it never started. */
  .rail[hidden] { display: none; }
  .rail-step { flex: 1; min-width: 0; }
  .rail-bar {
    height: 3px; border-radius: var(--radius-pill); background: var(--track);
    overflow: hidden; position: relative;
  }
  .rail-step[data-state="done"] .rail-bar { background: var(--tone-favorable-fill); }
  /* An indeterminate sweep rather than a percentage: the step's duration is
     genuinely unknown -- the widening pass is however many metros it takes --
     and a fake progress bar that stalls at 80% is worse than an honest one
     that only says "still working". */
  .rail-step[data-state="active"] .rail-bar::after {
    content: ""; position: absolute; inset: 0;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    animation: sweep 1.15s var(--ease-out) infinite;
  }
  @keyframes sweep {
    from { transform: translateX(-100%); }
    to   { transform: translateX(100%); }
  }
  .rail-label {
    display: block; margin-top: 5px;
    font-size: 9.5px; letter-spacing: .05em; text-transform: uppercase;
    color: var(--text-faint);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .rail-step[data-state="active"] .rail-label { color: var(--text); font-weight: 700; }
  .rail-step[data-state="done"] .rail-label { color: var(--text-dim); }

  .progress-line {
    display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-3);
  }
  .elapsed {
    flex: none; font-variant-numeric: tabular-nums; color: var(--text-faint); font-size: 11px;
  }

  .retry {
    margin-top: var(--sp-3);
    font: 700 11px/1 var(--font-sans); letter-spacing: .05em; text-transform: uppercase;
    padding: var(--sp-2) var(--sp-4); border-radius: var(--radius-pill);
    border: 1px solid var(--tone-adverse-border); background: transparent;
    color: var(--tone-adverse-text); cursor: pointer;
  }
  .retry:hover { background: var(--tone-adverse-border); color: var(--text); }

  @media (prefers-reduced-motion: reduce) {
    * { transition-duration: 0.01ms !important; }
    /* The sweep is the only thing saying the run is still alive, so it is
       slowed rather than removed -- a static card and a hung card would
       otherwise look identical. */
    .rail-step[data-state="active"] .rail-bar::after { animation-duration: 3s !important; }
  }
`;

/**
 * The one saturated colour in the extension, and the text that sits on it.
 *
 * Local to the trigger rather than a token: the panel has no primary action to
 * put it on, and a colour with one use is not a system.
 */
function accent(selector: string): string {
  const scoped = (attr: string) =>
    selector.startsWith(":host")
      ? `${selector}([data-theme="${attr}"])`
      : `${selector}[data-theme="${attr}"]`;
  const light = "--accent: #2f6f9f; --accent-on: #ffffff;";
  const dark = "--accent: #3d86bd; --accent-on: #06101a;";
  return `
  ${selector} { ${light} }
  @media (prefers-color-scheme: dark) { ${selector} { ${dark} } }
  ${scoped("light")} { ${light} }
  ${scoped("dark")} { ${dark} }
`;
}

/**
 * `selector` is where the custom properties hang: `:host` in the product, a
 * class in the preview harness, which renders the button's states side by side
 * outside any shadow root.
 */
export function triggerStylesheet(selector = ":host"): string {
  const reset = selector === ":host" ? ":host { all: initial; }" : "";
  return `${reset}\n${themeVariables(selector)}\n${accent(selector)}\n${RULES}`;
}

export interface TriggerButton {
  /** A step of a running capture. Draws the rail. */
  setProgress(message: string, stage?: CaptureStage): void;
  /** A terminal message. Clears the rail. */
  setStatus(message: string, tone?: "info" | "error"): void;
  setBusy(busy: boolean): void;
  remove(): void;
  addExtraAction(label: string, onClick: () => void): void;
  /**
   * Re-point the dock at a new element to float above (typically Marketplace's
   * own Send button, from `send-anchor.ts`), or at null to fall back to the
   * fixed corner position. `content/index.ts` calls this on every route
   * change: the dock itself is never torn down by a listing-to-listing
   * navigation (it lives on `document.body`, not inside the page's own
   * layout), but the Send button it was floating above belonged to the
   * PREVIOUS listing's composer and may no longer exist.
   */
  updateAnchor(target: Element | null): void;
}

/** Gap kept between the dock and whatever it is floating above. */
const ANCHOR_GAP_PX = 16;

/**
 * `aboveElement` is the element to float a fixed gap above -- typically
 * Marketplace's own Send button, from `send-anchor.ts` -- so the dock cannot
 * be mistaken for it. Null (or not found) falls back to the fixed corner
 * position this button has always used.
 */
export function mountTriggerButton(
  onClick: () => void,
  aboveElement?: Element | null,
): TriggerButton | null {
  if (document.getElementById(HOST_ID)) return null;

  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = triggerStylesheet();

  const panel = document.createElement("div");
  panel.className = "dock";

  const card = document.createElement("div");
  card.className = "card";
  card.hidden = true;
  // Progress and outcome both land here, so a screen reader is told without
  // the card having to steal focus from whatever the user was doing.
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");

  const rail = document.createElement("div");
  rail.className = "rail";
  const railSteps = CAPTURE_STEPS.map((step) => {
    const node = document.createElement("div");
    node.className = "rail-step";
    const bar = document.createElement("div");
    bar.className = "rail-bar";
    const label = document.createElement("span");
    label.className = "rail-label";
    label.textContent = step.label;
    node.append(bar, label);
    rail.append(node);
    return node;
  });

  const progressLine = document.createElement("div");
  progressLine.className = "progress-line";
  const message = document.createElement("p");
  message.className = "card-message";
  const elapsed = document.createElement("span");
  elapsed.className = "elapsed";
  progressLine.append(message, elapsed);

  card.append(rail, progressLine);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "capture";
  button.textContent = IDLE_LABEL;
  button.addEventListener("click", onClick);

  panel.append(card, button);
  shadow.append(style, panel);
  document.body.appendChild(host);

  let aboveTarget: Element | null | undefined = aboveElement;

  /**
   * Pin the dock a fixed gap above `aboveTarget`'s current on-screen position,
   * right-aligned to it. Inline styles rather than a CSS class: they beat the
   * stylesheet's `right: 16px; bottom: 16px` fallback unconditionally, so
   * there is never a specificity fight between "anchored" and "not".
   *
   * `getBoundingClientRect` is VIEWPORT-relative, same coordinate space as
   * `position: fixed`, which is what makes floating above an in-flow page
   * element work without reading anything from the page beyond its geometry.
   */
  const reposition = () => {
    if (!aboveTarget?.isConnected) {
      panel.style.removeProperty("right");
      panel.style.removeProperty("bottom");
      return;
    }
    const rect = aboveTarget.getBoundingClientRect();
    panel.style.right = `${Math.max(window.innerWidth - rect.right, 8)}px`;
    panel.style.bottom = `${Math.max(window.innerHeight - rect.top + ANCHOR_GAP_PX, 8)}px`;
  };

  reposition();
  // Fixed positioning tracks the VIEWPORT, not the Send button -- if the page
  // scrolls or the window resizes, the dock has to be told to recompute or it
  // drifts away from whatever it was floating above. Passive: this only reads
  // layout, never blocks the scroll it is listening to.
  window.addEventListener("scroll", reposition, { passive: true, capture: true });
  window.addEventListener("resize", reposition, { passive: true });

  let hideTimer: number | undefined;
  // A clock, not a poller. It runs only between setBusy(true) and
  // setBusy(false) -- i.e. only inside a capture the user started -- and reads
  // nothing from the page. Spec 8.1's constraint is on collection, and this
  // collects nothing.
  let tick: number | undefined;
  let startedAt = 0;

  const clearRetry = () => card.querySelector(".retry")?.remove();
  const clearTitle = () => card.querySelector(".card-title")?.remove();

  const drawRail = (stage?: CaptureStage) => {
    const current = stage ? stageIndex(stage) : -1;
    rail.hidden = current < 0;
    railSteps.forEach((node, index) => {
      // Everything before the current step is done whether or not it ran:
      // two of the five are conditional, and a rail that leaves a skipped
      // step looking pending implies the run went backwards.
      node.dataset["state"] =
        current < 0 ? "pending" : index < current ? "done" : index === current ? "active" : "pending";
    });
  };

  const stopClock = () => {
    if (tick) clearInterval(tick);
    tick = undefined;
  };

  return {
    setProgress(text, stage) {
      if (hideTimer) clearTimeout(hideTimer);
      clearRetry();
      clearTitle();
      delete card.dataset["tone"];
      message.textContent = text;
      drawRail(stage);
      card.hidden = false;

      if (!tick) {
        startedAt = Date.now();
        elapsed.textContent = "";
        tick = window.setInterval(() => {
          const seconds = Math.round((Date.now() - startedAt) / 1000);
          // Silent for the first few seconds. A timer that starts at 1s makes a
          // fast capture feel slow by drawing attention to its duration.
          elapsed.textContent = seconds >= 4 ? `${seconds}s` : "";
        }, 1000);
      }
    },

    setStatus(text, tone = "info") {
      if (hideTimer) clearTimeout(hideTimer);
      stopClock();
      clearRetry();
      clearTitle();
      elapsed.textContent = "";
      drawRail(undefined);
      message.textContent = tone === "error" ? withReloadHint(text) : text;
      card.hidden = false;

      if (tone === "error") {
        card.dataset["tone"] = "error";
        const title = document.createElement("div");
        title.className = "card-title";
        title.append("⚠", " That didn't finish");
        card.insertBefore(title, message.parentElement);

        // The old bubble left a red message on screen and no way forward.
        // Retrying is one click and the same click the user already made.
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "retry";
        retry.textContent = "Try again";
        retry.addEventListener("click", onClick);
        card.append(retry);
      } else {
        delete card.dataset["tone"];
        hideTimer = window.setTimeout(() => {
          card.hidden = true;
        }, 8000);
      }
    },

    setBusy(busy) {
      button.disabled = busy;
      button.textContent = busy ? BUSY_LABEL : IDLE_LABEL;
      if (!busy) stopClock();
    },

    remove() {
      if (hideTimer) clearTimeout(hideTimer);
      stopClock();
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      host.remove();
    },

    addExtraAction(label, handler) {
      const extra = document.createElement("button");
      extra.type = "button";
      extra.className = "extra";
      extra.textContent = label;
      extra.addEventListener("click", handler);
      panel.appendChild(extra);
    },

    updateAnchor(target) {
      aboveTarget = target;
      reposition();
    },
  };
}
