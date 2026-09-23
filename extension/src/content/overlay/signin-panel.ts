/**
 * The sign-in form: an email step, then a code step.
 *
 * Extracted from `bookmark.ts`, which was its only caller until running a
 * check itself started requiring a session too (`trigger-button.ts`'s
 * `showSignIn`). Both callers want the identical email/code state machine
 * with different framing text, so this module takes the copy as parameters
 * and owns nothing about where it is mounted.
 *
 * `onDone` fires once a session exists, and is what completes whatever the
 * user originally asked for -- saving an evaluation, or running a check they
 * clicked before signing in. See the callers for why that matters: a sign-in
 * prompt that forgets why it appeared is a prompt the user has to satisfy
 * twice.
 */

import type { AuthActionResult, AuthVerifyResult, ContentToBackground } from "../../shared/messages";
import { sendToBackground } from "../../shared/messages";
import { el } from "./elements";

/**
 * `sendToBackground`, with synchronous throws turned into rejections. See
 * `bookmark.ts`'s `ask` for why this matters: `chrome.runtime.sendMessage`
 * throws rather than rejects when the extension was reloaded out from under
 * an open page, and a bare `.then().catch()` never sees that.
 */
function ask<T>(message: ContentToBackground): Promise<T> {
  try {
    return sendToBackground<T>(message);
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

export interface SignInCopy {
  title: string;
  blurb: string;
}

/**
 * Renders the form into `container`, replacing whatever was there. Callers
 * own showing/hiding the container itself (e.g. `panel.dataset["open"]` in
 * `bookmark.ts`) -- this only ever touches its children.
 *
 * `onCancel`, when given, adds a "Not now" action that backs out without
 * completing anything. Omitted where there is nothing sensible to back out
 * to -- the form IS the only thing on screen in that state.
 */
export function buildSignInForm(
  container: HTMLElement,
  onDone: () => void,
  copy: SignInCopy,
  onCancel?: () => void,
): void {
  container.replaceChildren();

  const form = el("form", "signin");
  const title = el("p", "signin-title", copy.title);
  const blurb = el("p", "signin-blurb", copy.blurb);

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

  /**
   * The spam-folder note, and why it is not part of `message`. See
   * `bookmark.ts`'s original: a transactional email from a domain with almost
   * no sending history lands in junk often enough that "it never arrived" is
   * the most likely first-run failure this product has, and `message` gets
   * overwritten by "Checking…" and by every error -- the wrong place for a
   * hint that needs to stay put while someone hunts for the code.
   */
  const hint = el(
    "p",
    "signin-hint",
    "Not there in a minute? Check your spam or junk folder — and mark it as not spam, " +
      "so the next one arrives in your inbox.",
  );
  hint.hidden = true;

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
          hint.hidden = false;
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
        container.replaceChildren();
        onDone();
      })
      .catch(() => {
        setBusy(false);
        fail("Could not reach the server.");
      });
  });

  const actions = el("div", "signin-actions");
  actions.append(submit);
  if (onCancel) {
    const cancel = el("button", "signin-cancel", "Not now") as HTMLButtonElement;
    cancel.type = "button";
    cancel.addEventListener("click", onCancel);
    actions.append(cancel);
  }
  form.append(title, blurb, emailInput, codeInput, actions, message, hint);
  container.append(form);
  emailInput.focus();
}

export const SIGNIN_PANEL_STYLES = `
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

  /* A step below the status line, not beside it: it is a standing note about
     where the mail might be, and must never read as this attempt's outcome. */
  .signin-hint {
    margin: var(--sp-2) 0 0; font-size: var(--fs-xs); line-height: 1.45;
    color: var(--text-faint);
  }
  .signin-hint[hidden] { display: none; }
`;
