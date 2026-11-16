/**
 * The sign-in form: an EMAIL screen, then -- only once the email has actually
 * been sent -- a CODE screen.
 *
 * Built for conversion: this is the moment a guest becomes an account, and
 * every extra decision on it loses people. So:
 *
 *   - THE TWO STEPS ARE TWO SEPARATE SCREENS, rebuilt from scratch, never one
 *     form with a hidden field. The old form hid the code input with the
 *     `hidden` attribute, which `.signin-input { display: block }` silently
 *     overrode -- so a code box sat on screen before any code existed, and
 *     people typed their email into it or stalled. A field that isn't in the
 *     DOM can't be shown by accident.
 *   - The email screen asks for one thing, and its button says what you get
 *     (`copy.cta`), not what the system does ("Email me a code").
 *   - Common domain typos (gmial.com) are offered a one-click fix: a mistyped
 *     address is a sign-up that silently never arrives.
 *   - The code screen links straight to the user's webmail when the domain is
 *     recognisable, and the code box submits itself as soon as 8 characters
 *     are in -- typed or pasted -- so there's no second button to find.
 *
 * Extracted from `bookmark.ts`, which was its only caller until running a
 * check itself started requiring a session too (`trigger-button.ts`'s
 * `showSignIn`). Both callers want the identical state machine with different
 * framing text, so this module takes the copy as parameters and owns nothing
 * about where it is mounted.
 *
 * `onDone` fires once a session exists, and is what completes whatever the
 * user originally asked for -- saving an evaluation, or running a check they
 * clicked before signing in.
 */

import type { AuthActionResult, AuthVerifyResult, ContentToBackground } from "../../shared/messages";
import { sendToBackground } from "../../shared/messages";
import { el } from "./elements";

/**
 * `sendToBackground`, with synchronous throws turned into rejections.
 * `chrome.runtime.sendMessage` throws rather than rejects when the extension
 * was reloaded out from under an open page, and a bare `.then().catch()`
 * never sees that.
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
  /** The email screen's button. Say what they get. Defaults to "Continue". */
  cta?: string;
}

/** Mirrors `backend/app/auth/tokens.py`: CODE_LENGTH and CODE_ALPHABET. */
const CODE_LENGTH = 8;
const CODE_CHARS = /[^23456789ABCDEFGHJKMNPQRSTVWXYZ]/g;

/** How long "Resend code" stays disabled after a send. */
const RESEND_COOLDOWN_MS = 30_000;

/** Upper-cased, everything outside the code alphabet dropped, at most 8 chars. */
export function canonicalCode(raw: string): string {
  return raw.toUpperCase().replace(CODE_CHARS, "").slice(0, CODE_LENGTH);
}

/** "ABCD2345" -> "ABCD-2345", the shape the email prints. */
export function formatCode(canonical: string): string {
  return canonical.length > 4 ? `${canonical.slice(0, 4)}-${canonical.slice(4)}` : canonical;
}

const DOMAIN_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.cm": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmal.com": "hotmail.com",
  "hotmail.co": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com",
  "yahoo.co": "yahoo.com",
  "yahoo.con": "yahoo.com",
  "outlok.com": "outlook.com",
  "outloo.com": "outlook.com",
  "outlook.co": "outlook.com",
  "iclod.com": "icloud.com",
  "icloud.co": "icloud.com",
};

/** "jo@gmial.com" -> "jo@gmail.com", or null when nothing looks mistyped. */
export function suggestEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const fix = DOMAIN_TYPOS[email.slice(at + 1).toLowerCase()];
  return fix ? `${email.slice(0, at + 1)}${fix}` : null;
}

/**
 * A link straight to the inbox, for the providers most people use. Gmail's
 * search includes spam (`in:anywhere`), which is where a young sending
 * domain's mail most often lands.
 */
export function webmailFor(email: string): { label: string; url: string } | null {
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return {
      label: "Open Gmail",
      url: "https://mail.google.com/mail/u/0/#search/curbside+sign-in+code+in%3Aanywhere",
    };
  }
  if (/^(outlook|hotmail|live|msn)\./.test(domain)) {
    return { label: "Open Outlook", url: "https://outlook.live.com/mail/0/" };
  }
  if (/^(yahoo|ymail)\./.test(domain)) {
    return { label: "Open Yahoo Mail", url: "https://mail.yahoo.com/" };
  }
  if (domain === "icloud.com" || domain === "me.com" || domain === "mac.com") {
    return { label: "Open iCloud Mail", url: "https://www.icloud.com/mail" };
  }
  return null;
}

function statusLine(): HTMLElement {
  const message = el("p", "signin-message");
  // Announced rather than merely displayed: the panel is a modal, and a screen
  // reader user who submits has no other way to learn what happened.
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  return message;
}

/**
 * Renders the form into `container`, replacing whatever was there. Callers
 * own showing/hiding the container itself -- this only ever touches its
 * children.
 *
 * `onCancel`, when given, adds a "Not now" action that backs out without
 * completing anything.
 */
export function buildSignInForm(
  container: HTMLElement,
  onDone: () => void,
  copy: SignInCopy,
  onCancel?: () => void,
): void {
  showEmailStep(container, onDone, copy, onCancel, "");
}

function cancelButton(onCancel: () => void): HTMLButtonElement {
  const cancel = el("button", "signin-cancel", "Not now") as HTMLButtonElement;
  cancel.type = "button";
  cancel.addEventListener("click", onCancel);
  return cancel;
}

function showEmailStep(
  container: HTMLElement,
  onDone: () => void,
  copy: SignInCopy,
  onCancel: (() => void) | undefined,
  prefill: string,
): void {
  container.replaceChildren();
  const form = el("form", "signin") as HTMLFormElement;
  form.dataset["step"] = "email";
  form.noValidate = true; // our own messages, not the browser's tooltip

  const emailInput = el("input", "signin-input") as HTMLInputElement;
  emailInput.type = "email";
  emailInput.name = "email";
  emailInput.autocomplete = "email";
  emailInput.inputMode = "email";
  emailInput.spellcheck = false;
  emailInput.placeholder = "you@example.com";
  emailInput.value = prefill;
  emailInput.setAttribute("aria-label", "Email address");

  const suggestion = el("button", "signin-suggest") as HTMLButtonElement;
  suggestion.type = "button";
  suggestion.hidden = true;
  const refreshSuggestion = () => {
    const fix = suggestEmail(emailInput.value.trim());
    suggestion.hidden = fix === null;
    if (fix) {
      suggestion.replaceChildren("Did you mean ", el("strong", undefined, fix), "?");
      suggestion.onclick = () => {
        emailInput.value = fix;
        suggestion.hidden = true;
        emailInput.focus();
      };
    }
  };
  emailInput.addEventListener("input", refreshSuggestion);
  refreshSuggestion();

  const cta = copy.cta ?? "Continue";
  const submit = el("button", "signin-submit", cta) as HTMLButtonElement;
  submit.type = "submit";

  const assurance = el("p", "signin-assurance", "No password · No card · Takes 30 seconds");
  const message = statusLine();

  const fail = (text: string) => {
    message.textContent = text;
    message.dataset["tone"] = "error";
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = emailInput.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fail("Enter your email address, like you@example.com.");
      emailInput.focus();
      return;
    }

    submit.disabled = true;
    emailInput.disabled = true;
    submit.textContent = "Sending your code…";
    delete message.dataset["tone"];
    message.textContent = "";

    void ask<AuthActionResult>({ type: "AUTH_REQUEST_CODE", email })
      .then((result) => {
        if (!result.ok) {
          submit.disabled = false;
          emailInput.disabled = false;
          submit.textContent = cta;
          fail(result.error);
          return;
        }
        showCodeStep(container, onDone, copy, onCancel, email);
      })
      .catch(() => {
        submit.disabled = false;
        emailInput.disabled = false;
        submit.textContent = cta;
        fail("Could not reach Curbside. Check your connection and try again.");
      });
  });

  const actions = el("div", "signin-actions");
  actions.append(submit);
  if (onCancel) actions.append(cancelButton(onCancel));

  form.append(
    el("p", "signin-title", copy.title),
    el("p", "signin-blurb", copy.blurb),
    emailInput,
    suggestion,
    actions,
    assurance,
    message,
  );
  container.append(form);
  emailInput.focus();
}

function showCodeStep(
  container: HTMLElement,
  onDone: () => void,
  copy: SignInCopy,
  onCancel: (() => void) | undefined,
  email: string,
): void {
  container.replaceChildren();
  const form = el("form", "signin") as HTMLFormElement;
  form.dataset["step"] = "code";
  form.noValidate = true;

  const sentTo = el("p", "signin-blurb");
  const change = el("button", "signin-link", "Change") as HTMLButtonElement;
  change.type = "button";
  change.addEventListener("click", () => showEmailStep(container, onDone, copy, onCancel, email));
  sentTo.append(
    `We sent an ${CODE_LENGTH}-character code to `,
    el("strong", undefined, email),
    ". ",
    change,
  );

  const codeInput = el("input", "signin-input signin-code") as HTMLInputElement;
  codeInput.type = "text";
  codeInput.name = "code";
  codeInput.autocomplete = "one-time-code";
  codeInput.autocapitalize = "characters";
  codeInput.spellcheck = false;
  codeInput.placeholder = "ABCD-2345";
  codeInput.maxLength = CODE_LENGTH + 1; // the hyphen
  codeInput.setAttribute("aria-label", `${CODE_LENGTH}-character code from the email`);

  const submit = el("button", "signin-submit", "Verify and continue") as HTMLButtonElement;
  submit.type = "submit";

  const message = statusLine();

  const resend = el("button", "signin-link", "Resend code") as HTMLButtonElement;
  resend.type = "button";

  /**
   * Standing note, not part of `message`: that line is overwritten by every
   * attempt and error, which is exactly when somebody is hunting for a code
   * that landed in junk -- the most likely first-run failure this product has.
   */
  const hint = el(
    "p",
    "signin-hint",
    "Not there in a minute? Check your spam or junk folder, and mark it as not spam " +
      "so the next one arrives in your inbox.",
  );

  let verifying = false;
  const fail = (text: string) => {
    message.textContent = text;
    message.dataset["tone"] = "error";
  };

  const verify = () => {
    const code = canonicalCode(codeInput.value);
    if (verifying) return;
    if (code.length < CODE_LENGTH) {
      fail(`The code is ${CODE_LENGTH} characters, like ABCD-2345.`);
      codeInput.focus();
      return;
    }
    verifying = true;
    submit.disabled = true;
    codeInput.disabled = true;
    submit.textContent = "Signing you in…";
    delete message.dataset["tone"];
    message.textContent = "";

    void ask<AuthVerifyResult>({ type: "AUTH_VERIFY_CODE", email, code })
      .then((result) => {
        if (!result.ok) {
          throw new Error(result.error);
        }
        container.replaceChildren();
        onDone();
      })
      .catch((error: unknown) => {
        verifying = false;
        submit.disabled = false;
        codeInput.disabled = false;
        submit.textContent = "Verify and continue";
        fail(
          error instanceof Error && error.message
            ? error.message
            : "Could not reach Curbside. Check your connection and try again.",
        );
        codeInput.focus();
        codeInput.select();
      });
  };

  // Format as they type or paste, and go as soon as the code is complete.
  codeInput.addEventListener("input", () => {
    const code = canonicalCode(codeInput.value);
    codeInput.value = formatCode(code);
    if (message.dataset["tone"] === "error") {
      delete message.dataset["tone"];
      message.textContent = "";
    }
    if (code.length === CODE_LENGTH) verify();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    verify();
  });

  resend.addEventListener("click", () => {
    resend.disabled = true;
    resend.textContent = "Sending…";
    void ask<AuthActionResult>({ type: "AUTH_REQUEST_CODE", email })
      .then((result) => {
        if (!result.ok) throw new Error(result.error);
        resend.textContent = "New code sent";
        delete message.dataset["tone"];
        message.textContent = `A new code is on its way to ${email}. Use the newest one.`;
      })
      .catch((error: unknown) => {
        resend.textContent = "Resend code";
        fail(error instanceof Error && error.message ? error.message : "Could not send a new code.");
      })
      .finally(() => {
        setTimeout(() => {
          resend.disabled = false;
          resend.textContent = "Resend code";
        }, RESEND_COOLDOWN_MS);
      });
  });

  const actions = el("div", "signin-actions");
  actions.append(submit);
  if (onCancel) actions.append(cancelButton(onCancel));

  const extras = el("p", "signin-extras");
  const webmail = webmailFor(email);
  if (webmail) {
    const open = el("a", "signin-webmail", `${webmail.label} ↗`) as HTMLAnchorElement;
    open.href = webmail.url;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    form.append(el("p", "signin-title", "Check your email"), sentTo, open);
  } else {
    form.append(el("p", "signin-title", "Check your email"), sentTo);
  }
  extras.append(resend);

  form.append(codeInput, actions, message, extras, hint);
  container.append(form);
  codeInput.focus();
}

export const SIGNIN_PANEL_STYLES = `
  .signin-title {
    margin: 0 0 var(--sp-2); font-size: var(--fs-md); font-weight: 700; color: var(--text);
  }
  .signin-blurb {
    margin: 0 0 var(--sp-4); font-size: var(--fs-sm); line-height: 1.5; color: var(--text-muted);
  }
  .signin-blurb strong { color: var(--text); font-weight: 600; overflow-wrap: anywhere; }

  .signin-input {
    display: block; width: 100%; box-sizing: border-box;
    margin: 0 0 var(--sp-3); padding: var(--sp-3) var(--sp-4);
    font: inherit; font-size: var(--fs-base);
    color: var(--text); background: var(--sheet);
    border: 1px solid var(--border); border-radius: var(--radius-sm);
  }
  .signin-input:focus { outline: 2px solid var(--focus); outline-offset: 1px; border-color: transparent; }
  .signin-input:disabled { opacity: .6; }
  /* The code box: big, spaced, monospaced, so it reads like the email does. */
  .signin-code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: var(--fs-lg); letter-spacing: .18em; text-align: center; text-transform: uppercase;
  }
  /* Belt and braces: anything hidden stays hidden whatever its class says. */
  .signin [hidden] { display: none !important; }

  .signin-suggest {
    display: block; margin: calc(var(--sp-2) * -1) 0 var(--sp-3); padding: 0;
    font: inherit; font-size: var(--fs-xs); text-align: left;
    color: var(--link); background: none; border: none; cursor: pointer;
  }
  .signin-suggest strong { font-weight: 700; }

  .signin-actions { display: flex; align-items: center; gap: var(--sp-3); }
  .signin-submit {
    flex: 1 1 auto;
    padding: var(--sp-3) var(--sp-4);
    font: inherit; font-size: var(--fs-sm); font-weight: 700;
    color: var(--sheet); background: var(--text);
    border: none; border-radius: var(--radius-sm); cursor: pointer;
  }
  .signin-submit:hover:not(:disabled) { opacity: .9; }
  .signin-submit:disabled { opacity: .6; cursor: default; }
  .signin-cancel {
    flex: 0 0 auto;
    padding: var(--sp-3) var(--sp-2);
    font: inherit; font-size: var(--fs-sm);
    color: var(--text-faint); background: none; border: none; cursor: pointer;
  }
  .signin-cancel:hover { color: var(--text); }

  .signin-assurance {
    margin: var(--sp-3) 0 0; font-size: var(--fs-xs); color: var(--text-faint); text-align: center;
  }

  .signin-webmail {
    display: block; margin: 0 0 var(--sp-4); padding: var(--sp-3) var(--sp-4);
    font-size: var(--fs-sm); font-weight: 600; text-align: center; text-decoration: none;
    color: var(--text); background: var(--raised);
    border: 1px solid var(--border); border-radius: var(--radius-sm);
  }
  .signin-webmail:hover { border-color: var(--text-faint); }

  .signin-link {
    padding: 0; font: inherit; font-size: inherit; font-weight: 600;
    color: var(--link); background: none; border: none; cursor: pointer;
  }
  .signin-link:disabled { color: var(--text-faint); cursor: default; }

  .signin-extras { margin: var(--sp-3) 0 0; font-size: var(--fs-xs); }

  .signin-message {
    margin: var(--sp-3) 0 0; font-size: var(--fs-xs); line-height: 1.45;
    color: var(--text-muted);
  }
  .signin-message[data-tone="error"] { color: var(--tone-adverse-text); }
  .signin-message:empty { display: none; }

  .signin-hint {
    margin: var(--sp-2) 0 0; font-size: var(--fs-xs); line-height: 1.45;
    color: var(--text-faint);
  }
`;
