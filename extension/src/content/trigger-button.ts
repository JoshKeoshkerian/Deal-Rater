/**
 * The trigger. Deliberately the entire user interface for this step.
 *
 * Rendered inside a shadow root so that neither Facebook's stylesheet nor this
 * one can reach the other, and so the button is not affected by the class-name
 * churn that everything else in this project has to work around.
 */

const HOST_ID = "deal-rater-trigger";

const STYLES = `
  :host { all: initial; }
  .panel {
    position: fixed;
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
    gap: 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  button {
    font: 600 14px/1 inherit;
    padding: 12px 18px;
    border: 0;
    border-radius: 999px;
    background: #1c2b3a;
    color: #fff;
    cursor: pointer;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.28);
  }
  button:hover:not(:disabled) { background: #26394d; }
  button:disabled { opacity: 0.65; cursor: default; }
  button:focus-visible { outline: 2px solid #7fb8e8; outline-offset: 2px; }
  /* The fixture control is secondary to the one action this button exists for,
     and is only ever mounted in a dev build. */
  button.extra {
    font-size: 12.5px; padding: 8px 14px;
    background: #16212b; color: #a9bccb;
  }
  button.extra:hover:not(:disabled) { background: #1c2b3a; color: #e8eef4; }
  @media (prefers-reduced-motion: reduce) {
    * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
  }
  .status {
    max-width: 280px;
    padding: 8px 12px;
    border-radius: 8px;
    background: #1c2b3a;
    color: #e8eef4;
    font-size: 12.5px;
    line-height: 1.45;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.28);
  }
  .status[data-tone="error"] { background: #5b1f1f; }
  .status[hidden] { display: none; }
`;

export interface TriggerButton {
  setStatus(message: string, tone?: "info" | "error"): void;
  setBusy(busy: boolean): void;
  remove(): void;
  addExtraAction(label: string, onClick: () => void): void;
}

export function mountTriggerButton(onClick: () => void): TriggerButton | null {
  if (document.getElementById(HOST_ID)) return null;

  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = STYLES;

  const panel = document.createElement("div");
  panel.className = "panel";

  const status = document.createElement("div");
  status.className = "status";
  status.hidden = true;

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Capture listing";
  button.addEventListener("click", onClick);

  panel.append(status, button);
  shadow.append(style, panel);
  document.body.appendChild(host);

  let hideTimer: number | undefined;

  return {
    setStatus(message, tone = "info") {
      status.textContent = message;
      status.dataset["tone"] = tone;
      status.hidden = false;
      if (hideTimer) clearTimeout(hideTimer);
      if (tone === "info") {
        hideTimer = window.setTimeout(() => {
          status.hidden = true;
        }, 8000);
      }
    },
    setBusy(busy) {
      button.disabled = busy;
      button.textContent = busy ? "Capturing…" : "Capture listing";
    },
    remove() {
      if (hideTimer) clearTimeout(hideTimer);
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
  };
}
