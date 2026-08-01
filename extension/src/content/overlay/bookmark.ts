/**
 * The save/bookmark control, and the sign-in it prompts for.
 *
 * Two elements built together because they are one interaction: a star in the
 * header, and a panel under it that appears only when the star is clicked by
 * somebody who is not signed in.
 *
 * WHY A STAR AND NOT AN SVG BOOKMARK
 * -----------------------------------
 * `theme.ts` already establishes the pattern -- a text glyph in a 28px round
 * button -- and matching it keeps the header's three controls visually one set.
 * It also avoids injecting markup: Facebook enforces Trusted Types on some
 * pages, and an `innerHTML` assignment for an inline SVG is exactly what that
 * blocks. `document.createElementNS` would work, but a filled/outline pair that
 * every platform already renders is less machinery for the same result.
 *
 * SIGNING IN COMPLETES THE ACTION THE USER ASKED FOR
 * ---------------------------------------------------
 * They clicked save. So the panel saves the evaluation as soon as the code
 * verifies, rather than signing them in and leaving the star empty for them to
 * click a second time. A sign-in prompt that forgets why it appeared is a
 * prompt the user has to satisfy twice.
 *
 * WHAT THIS DOES NOT DO
 * ----------------------
 * It never holds the session token. Every call goes through the service worker
 * (`shared/session.ts` explains the boundary), and this module only ever learns
 * whether somebody is signed in and whether this evaluation is saved.
 */

import type {
  AuthActionResult,
  AuthVerifyResult,
  ContentToBackground,
  SavedStateResult,
} from "../../shared/messages";
import { sendToBackground } from "../../shared/messages";
import { el } from "./elements";

/**
 * `sendToBackground`, with synchronous throws turned into rejections.
 *
 * `chrome.runtime.sendMessage` does not always reject -- it THROWS, before
 * returning a promise, when the messaging channel is gone. The common cause in
 * production is "Extension context invalidated": the extension was reloaded or
 * updated while this overlay was still on the page, which orphans the content
 * script. A bare `.then().catch()` never sees that, so it would escape as an
 * unhandled error on somebody's facebook.com tab.
 *
 * Every call in this module goes through here, so no failure mode of the save
 * button can take down a panel whose evaluation is already rendered and
 * readable.
 */
function ask<T>(message: ContentToBackground): Promise<T> {
  try {
    return sendToBackground<T>(message);
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

type SaveState =
  /** The initial state, before the backend has answered. */
  | "unknown"
  /** Nobody is signed in on this install. */
  | "signed-out"
  | "not-saved"
  | "saved"
  /** A request is in flight. */
  | "busy";

const GLYPH: Record<SaveState, string> = {
  unknown: "☆",
  "signed-out": "☆",
  "not-saved": "☆",
  saved: "★",
  busy: "☆",
};

const LABEL: Record<SaveState, string> = {
  unknown: "Save this evaluation",
  "signed-out": "Save this evaluation",
  "not-saved": "Save this evaluation",
  saved: "Saved — click to remove",
  busy: "Working…",
};

export interface BookmarkControl {
  /** Goes in the header, beside the theme toggle. */
  button: HTMLElement;
  /** Goes directly under the header. Empty until sign-in is needed. */
  panel: HTMLElement;
}

/**
 * The sign-in form: an email step, then a code step.
 *
 * `onDone` fires once a session exists, and is what saves the evaluation the
 * user originally clicked on.
 */
function buildSignIn(panel: HTMLElement, onDone: () => void): void {
  panel.replaceChildren();
  panel.dataset["open"] = "true";

  const form = el("form", "signin");
  const title = el("p", "signin-title", "Save this evaluation");
  const blurb = el(
    "p",
    "signin-blurb",
    "Saved evaluations are kept as a snapshot of what this tool said today, " +
      "and you can read them back on the web. No password — we email you a code.",
  );

  const emailInput = el("input", "signin-input") as HTMLInputElement;
  emailInput.type = "email";
  emailInput.required = true;
  emailInput.placeholder = "you@example.com";
  emailInput.setAttribute("aria-label", "Email address");

  const codeInput = el("input", "signin-input") as HTMLInputElement;
  codeInput.type = "text";
  codeInput.placeholder = "ABCD-2345";
  codeInput.autocomplete = "one-time-code";
  codeInput.setAttribute("aria-label", "Sign-in code");
  codeInput.hidden = true;

  const submit = el("button", "signin-submit", "Email me a code") as HTMLButtonElement;
  submit.type = "submit";

  const message = el("p", "signin-message");
  // Announced rather than merely displayed: the panel is a modal, and a screen
  // reader user who submits an email has no other way to learn it worked.
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");

  const cancel = el("button", "signin-cancel", "Not now") as HTMLButtonElement;
  cancel.type = "button";
  cancel.addEventListener("click", () => {
    panel.replaceChildren();
    delete panel.dataset["open"];
  });

  let step: "email" | "code" = "email";

  const setBusy = (busy: boolean) => {
    submit.disabled = busy;
    emailInput.disabled = busy;
    codeInput.disabled = busy;
  };

  const fail = (text: string) => {
    message.textContent = text;
    message.dataset["tone"] = "error";
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = emailInput.value.trim();
    if (!email) return;

    setBusy(true);
    message.dataset["tone"] = "info";

    if (step === "email") {
      message.textContent = "Sending…";
      void ask<AuthActionResult>({ type: "AUTH_REQUEST_CODE", email })
        .then((result) => {
          setBusy(false);
          if (!result.ok) {
            fail(result.error);
            return;
          }
          step = "code";
          codeInput.hidden = false;
          codeInput.focus();
          submit.textContent = "Sign in";
          message.dataset["tone"] = "info";
          message.textContent = `Code sent to ${email}. It expires shortly.`;
        })
        .catch(() => {
          setBusy(false);
          fail("Could not reach the server.");
        });
      return;
    }

    const code = codeInput.value.trim();
    if (!code) {
      setBusy(false);
      return;
    }

    message.textContent = "Checking…";
    void ask<AuthVerifyResult>({ type: "AUTH_VERIFY_CODE", email, code })
      .then((result) => {
        setBusy(false);
        if (!result.ok) {
          fail(result.error);
          codeInput.select();
          return;
        }
        panel.replaceChildren();
        delete panel.dataset["open"];
        onDone();
      })
      .catch(() => {
        setBusy(false);
        fail("Could not reach the server.");
      });
  });

  const actions = el("div", "signin-actions");
  actions.append(submit, cancel);
  form.append(title, blurb, emailInput, codeInput, actions, message);
  panel.append(form);
  emailInput.focus();
}

export function buildBookmark(captureId: number): BookmarkControl {
  const button = el("button", "bookmark") as HTMLButtonElement;
  button.type = "button";

  const panel = el("div", "signin-panel");

  let state: SaveState = "unknown";

  const paint = () => {
    button.textContent = GLYPH[state];
    button.dataset["state"] = state;
    button.title = LABEL[state];
    button.setAttribute("aria-label", LABEL[state]);
    // `aria-pressed` rather than a role change: it is one control whose state
    // toggles, which is exactly what a toggle button is.
    button.setAttribute("aria-pressed", String(state === "saved"));
    button.disabled = state === "busy";
  };

  const apply = (result: SavedStateResult) => {
    if (!result.ok) {
      // A failed save leaves the star as it was rather than lying about the
      // outcome. The title is where the reason goes; the panel has no room for
      // an error banner and this is not important enough to earn one.
      state = state === "busy" ? "not-saved" : state;
      paint();
      button.title = result.error;
      return;
    }
    state = !result.signedIn ? "signed-out" : result.saved ? "saved" : "not-saved";
    paint();
  };

  const toggle = () => {
    const save = state !== "saved";
    state = "busy";
    paint();
    void ask<SavedStateResult>({
      type: save ? "SAVE_EVALUATION" : "UNSAVE_EVALUATION",
      captureId,
    })
      .then(apply)
      .catch(() => apply({ ok: false, error: "Could not reach the server." }));
  };

  button.addEventListener("click", () => {
    if (state === "busy") return;
    if (state === "signed-out" || state === "unknown") {
      buildSignIn(panel, toggle);
      return;
    }
    toggle();
  });

  paint();

  // The initial read. Swallowed on failure for the same reason the theme
  // control's is: the panel has already rendered, and a backend that cannot
  // answer "is this saved" should leave an empty star rather than an error on
  // an evaluation that is otherwise complete.
  void ask<SavedStateResult>({ type: "SAVED_STATE", captureId })
    .then(apply)
    .catch(() => undefined);

  return { button, panel };
}

export const BOOKMARK_STYLES = `
  /* Sized and shaped with .close and .theme-toggle (see HEADER_STYLES); only
     what differs lives here. */
  .bookmark {
    display: grid; place-items: center; flex: none;
    width: 28px; height: 28px; padding: 0;
    background: none; border: 1px solid transparent; border-radius: var(--radius-pill);
    color: var(--text-dim); cursor: pointer; font: inherit; line-height: 1;
    font-size: var(--fs-lg);
    transition: color var(--dur-fast) var(--ease-out),
                background var(--dur-fast) var(--ease-out),
                border-color var(--dur-fast) var(--ease-out);
  }
  .bookmark:hover:not(:disabled) {
    color: var(--text); background: var(--raised); border-color: var(--border);
  }
  .bookmark[data-state="saved"] { color: var(--tone-favorable-text); }
  .bookmark:disabled { opacity: .5; cursor: default; }

  .signin-panel { display: none; }
  .signin-panel[data-open="true"] {
    display: block;
    padding: var(--sp-5) var(--sp-6);
    background: var(--raised);
    border-bottom: 1px solid var(--border);
  }

  .signin-title {
    margin: 0 0 var(--sp-2); font-size: var(--fs-sm); font-weight: 700; color: var(--text);
  }
  .signin-blurb {
    margin: 0 0 var(--sp-4); font-size: var(--fs-xs); line-height: 1.5; color: var(--text-faint);
  }
  .signin-input {
    display: block; width: 100%; box-sizing: border-box;
    margin: 0 0 var(--sp-3); padding: var(--sp-3);
    font: inherit; font-size: var(--fs-sm);
    color: var(--text); background: var(--sheet);
    border: 1px solid var(--border); border-radius: var(--radius-sm);
  }
  .signin-input:disabled { opacity: .6; }

  .signin-actions { display: flex; align-items: center; gap: var(--sp-3); }
  .signin-submit {
    padding: var(--sp-3) var(--sp-4);
    font: inherit; font-size: var(--fs-sm); font-weight: 600;
    color: var(--sheet); background: var(--text);
    border: none; border-radius: var(--radius-sm); cursor: pointer;
  }
  .signin-submit:disabled { opacity: .6; cursor: default; }
  .signin-cancel {
    padding: var(--sp-3) var(--sp-2);
    font: inherit; font-size: var(--fs-sm);
    color: var(--text-faint); background: none; border: none; cursor: pointer;
  }
  .signin-cancel:hover { color: var(--text); }

  .signin-message {
    margin: var(--sp-3) 0 0; font-size: var(--fs-xs); line-height: 1.45;
    color: var(--text-faint);
  }
  .signin-message[data-tone="error"] { color: var(--tone-adverse-text); }
  .signin-message:empty { display: none; }
`;
