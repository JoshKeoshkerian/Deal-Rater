/**
 * The save/bookmark control, and the sign-in it prompts for.
 *
 * Three elements built together because they are one interaction: a labelled
 * star button in the header, a strip under it naming the site the saves are
 * readable on, and a panel that appears only when the button is clicked by
 * somebody who is not signed in.
 *
 * WHY A STAR AND NOT AN SVG BOOKMARK
 * -----------------------------------
 * A text glyph avoids injecting markup: Facebook enforces Trusted Types on some
 * pages, and an `innerHTML` assignment for an inline SVG is exactly what that
 * blocks. `document.createElementNS` would work, but a filled/outline pair that
 * every platform already renders is less machinery for the same result.
 *
 * WHY THE GLYPH IS NOT ALONE
 * ---------------------------
 * It was, and saving was the most valuable thing the panel does and the least
 * discoverable: a bare ☆ in the corner of somebody else's page is decoration
 * until it is clicked, and the site the saves are readable on -- the actual
 * product -- was named nowhere in the UI at all. So the glyph now carries the
 * word "Save" beside it, and a strip under the header says where a saved
 * evaluation goes, with the URL as a live link. Both are cheap; a feature the
 * user never finds is not.
 *
 * The strip is one quiet line rather than a callout. It is not a finding about
 * the vehicle and must never compete with one (`tokens.ts` rule 2) -- what it
 * earns over silence is that a first-time user learns the feature exists
 * without having to click an unlabelled glyph to find out.
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

/**
 * Where saved evaluations are read back (`curbside-app/`).
 *
 * MOVED FROM `app.curbsidescore.com` when the marketing site and the app were
 * merged into one Next.js project on the apex. The old host still resolves --
 * it 308s here -- so an install that has not updated yet keeps working; this
 * only saves the hop, and takes effect when a new version reaches the store.
 *
 * `/saved` rather than the bare host: the root is the landing page now, and
 * somebody who has already saved things does not need to be sold the product.
 */
export const SAVED_APP_URL = "https://curbsidescore.com/saved";

/** The same host without the scheme or path -- what the link reads as. */
const SAVED_APP_LABEL = "curbsidescore.com";

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

/** The word beside the glyph. Short: it shares a row with the vehicle line. */
const WORD: Record<SaveState, string> = {
  unknown: "Save",
  "signed-out": "Save",
  "not-saved": "Save",
  saved: "Saved",
  busy: "Save",
};

const LABEL: Record<SaveState, string> = {
  unknown: "Save this evaluation",
  "signed-out": "Save this evaluation",
  "not-saved": "Save this evaluation",
  saved: "Saved — click to remove",
  busy: "Working…",
};

/**
 * The strip's sentence, in its two readings. Both end by naming the site, which
 * is the part the header alone could never say.
 */
const STRIP_LEAD: Record<"saved" | "unsaved", string> = {
  unsaved: "Save this evaluation and read it back on any device at",
  saved: "Saved. It is waiting with your other saved listings at",
};

export interface BookmarkControl {
  /** Goes in the header, beside the theme toggle. */
  button: HTMLElement;
  /** Goes directly under the header. Always visible. */
  strip: HTMLElement;
  /** Goes under the strip. Empty until sign-in is needed. */
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
  // The site is named here as well as on the strip: this is where somebody
  // decides whether handing over an email address is worth it, and "on the web"
  // is not a thing anyone can go and look at first.
  const blurb = el(
    "p",
    "signin-blurb",
    "Saved evaluations are kept as a snapshot of what this tool said today, and you " +
      `can read them back at ${SAVED_APP_LABEL}. No password — we email you a code.`,
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

/**
 * The strip under the header: what saving is for, and where the saves live.
 *
 * The link is built once and only its lead sentence is repainted, so a state
 * change never swaps out an anchor the user might be on the way to clicking.
 */
function buildStrip(): { node: HTMLElement; lead: HTMLElement; glyph: HTMLElement } {
  const node = el("div", "saved-strip");
  const glyph = el("span", "saved-strip-glyph", GLYPH["not-saved"]);

  const text = el("p", "saved-strip-text");
  const lead = el("span", undefined, `${STRIP_LEAD.unsaved} `);

  const link = el("a", "saved-strip-link") as HTMLAnchorElement;
  link.href = SAVED_APP_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = SAVED_APP_LABEL;
  link.append(el("span", "link-arrow", "↗"));

  text.append(lead, link);
  node.append(glyph, text);
  return { node, lead, glyph };
}

export function buildBookmark(captureId: number): BookmarkControl {
  const button = el("button", "bookmark") as HTMLButtonElement;
  button.type = "button";
  const buttonGlyph = el("span", "bookmark-glyph", GLYPH["not-saved"]);
  const buttonWord = el("span", "bookmark-word", WORD["not-saved"]);
  button.append(buttonGlyph, buttonWord);

  const strip = buildStrip();
  const panel = el("div", "signin-panel");

  let state: SaveState = "unknown";

  const paint = () => {
    const saved = state === "saved";
    buttonGlyph.textContent = GLYPH[state];
    buttonWord.textContent = WORD[state];
    button.dataset["state"] = state;
    button.title = LABEL[state];
    button.setAttribute("aria-label", LABEL[state]);
    // `aria-pressed` rather than a role change: it is one control whose state
    // toggles, which is exactly what a toggle button is.
    button.setAttribute("aria-pressed", String(saved));
    button.disabled = state === "busy";

    // The strip follows the button rather than carrying a state of its own --
    // there is one fact here ("is this saved"), and two elements disagreeing
    // about it is the failure mode worth designing out.
    strip.node.dataset["state"] = saved ? "saved" : "unsaved";
    strip.glyph.textContent = GLYPH[saved ? "saved" : "not-saved"];
    strip.lead.textContent = `${saved ? STRIP_LEAD.saved : STRIP_LEAD.unsaved} `;
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

  return { button, strip: strip.node, panel };
}

export const BOOKMARK_STYLES = `
  /* A pill, not a 28px icon well like .close and .theme-toggle. Those two act
     on the panel and are self-evident from their glyphs; this one acts on the
     evaluation and is the only header control with somewhere to send you, so it
     carries its word and a filled surface -- the header's one element that
     should read as offering something rather than dismissing it. */
  .bookmark {
    display: inline-flex; align-items: center; gap: var(--sp-2); flex: none;
    height: 28px; padding: 0 var(--sp-3); box-sizing: border-box;
    background: var(--raised); border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    color: var(--text-dim); cursor: pointer;
    font: 650 var(--fs-xs)/1 var(--font-sans); letter-spacing: .03em;
    transition: color var(--dur-fast) var(--ease-out),
                background var(--dur-fast) var(--ease-out),
                border-color var(--dur-fast) var(--ease-out),
                transform var(--dur-fast) var(--ease-out);
  }
  .bookmark-glyph { font-size: var(--fs-md); line-height: 1; }
  .bookmark-word { white-space: nowrap; }
  .bookmark:hover:not(:disabled) { color: var(--text); border-color: var(--text-faint); }
  .bookmark:active:not(:disabled) { transform: scale(.96); }
  .bookmark[data-state="saved"] {
    color: var(--tone-favorable-text);
    background: var(--tone-favorable-surface);
    border-color: var(--tone-favorable-border);
  }
  .bookmark:disabled { opacity: .6; cursor: default; }

  /* The strip under the header. A left rail in the LINK colour rather than a
     tone: it is not a judgement about the vehicle (tokens.ts rule 2), it is a
     place to go, and that is the one thing the header could not say. */
  .saved-strip {
    display: flex; align-items: baseline; gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-6);
    background: var(--raised);
    border-bottom: 1px solid var(--border);
    box-shadow: inset 3px 0 0 var(--link);
  }
  .saved-strip[data-state="saved"] {
    background: var(--tone-favorable-surface);
    border-bottom-color: var(--tone-favorable-border);
    box-shadow: inset 3px 0 0 var(--tone-favorable-fill);
  }
  .saved-strip-glyph { flex: none; font-size: var(--fs-sm); color: var(--text-dim); }
  .saved-strip[data-state="saved"] .saved-strip-glyph { color: var(--tone-favorable-text); }
  .saved-strip-text {
    margin: 0; font-size: var(--fs-xs); line-height: 1.55; color: var(--text-muted);
  }
  /* Inherits the strip's size rather than the panel's default link size, so the
     URL sits in the sentence instead of standing a step above it. */
  .saved-strip-link { font-size: inherit; }

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
