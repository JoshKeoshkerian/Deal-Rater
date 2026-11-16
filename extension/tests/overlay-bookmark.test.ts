/**
 * The save button and the sign-in it prompts for.
 *
 * These drive `buildBookmark` directly rather than through `renderEvaluation`,
 * because what is under test is a state machine over responses from the service
 * worker, and the panel around it is `overlay-modal.test.ts`'s subject.
 *
 * The worker is a stub that records what was asked and answers with whatever
 * the test sets. Nothing here touches the network, and nothing here knows what
 * a session token looks like -- which is the point of the boundary in
 * `shared/session.ts`: the content script only ever learns outcomes.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { buildBookmark, SAVED_APP_URL } from "../src/content/overlay/bookmark";

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

function submit(panel: HTMLElement): void {
  panel
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

function inputs(panel: HTMLElement): HTMLInputElement[] {
  return Array.from(panel.querySelectorAll<HTMLInputElement>("input"));
}

function emailInput(panel: HTMLElement): HTMLInputElement {
  return panel.querySelector<HTMLInputElement>('input[name="email"]')!;
}

/** The code box. Only exists once the email step has succeeded. */
function codeInput(panel: HTMLElement): HTMLInputElement | null {
  return panel.querySelector<HTMLInputElement>('input[name="code"]');
}

/** Type into the code box the way a user does: an input event per change. */
function typeCode(panel: HTMLElement, value: string): void {
  const box = codeInput(panel)!;
  box.value = value;
  box.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Fill the email and submit it, with the worker accepting the send. */
async function sendCodeTo(panel: HTMLElement, address = "buyer@example.com"): Promise<void> {
  emailInput(panel).value = address;
  submit(panel);
  await settle();
}

/**
 * The star, on its own.
 *
 * The button carries a word beside the glyph now, so `button.textContent` is
 * "☆Save" rather than "☆" -- these assertions are about which star is drawn,
 * and reading the glyph span keeps them about that and not about the wording.
 */
function star(button: HTMLElement): string | null {
  return button.querySelector(".bookmark-glyph")!.textContent;
}

beforeEach(() => {
  sent = [];
  reply = () => ({ ok: true, signedIn: false });
  stubWorker();
});

describe("the save button", () => {
  it("asks whether this evaluation is already saved, on mount", async () => {
    buildBookmark(42);
    await settle();

    expect(sent).toEqual([{ type: "SAVED_STATE", captureId: 42 }]);
  });

  it("shows a filled star for something already saved", async () => {
    reply = () => ({ ok: true, signedIn: true, saved: true });
    const { button } = buildBookmark(1);
    await settle();

    expect(star(button)).toBe("★");
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows an empty star for something not saved", async () => {
    reply = () => ({ ok: true, signedIn: true, saved: false });
    const { button } = buildBookmark(1);
    await settle();

    expect(star(button)).toBe("☆");
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("says what it does in words, not only in a glyph", async () => {
    // The whole reason the word is there: a bare star in the corner of
    // somebody else's page is decoration until it has been clicked.
    reply = () => ({ ok: true, signedIn: true, saved: false });
    const { button } = buildBookmark(1);
    await settle();

    expect(button.querySelector(".bookmark-word")!.textContent).toBe("Save");

    reply = () => ({ ok: true, signedIn: true, saved: true });
    button.click();
    await settle();

    expect(button.querySelector(".bookmark-word")!.textContent).toBe("Saved");
  });

  it("saves on click, and fills in", async () => {
    reply = (message) =>
      message.type === "SAVED_STATE"
        ? { ok: true, signedIn: true, saved: false }
        : { ok: true, signedIn: true, saved: true };
    const { button } = buildBookmark(7);
    await settle();

    button.click();
    await settle();

    expect(sent.at(-1)).toEqual({ type: "SAVE_EVALUATION", captureId: 7 });
    expect(star(button)).toBe("★");
  });

  it("unsaves on a second click", async () => {
    reply = (message) =>
      message.type === "SAVED_STATE"
        ? { ok: true, signedIn: true, saved: true }
        : { ok: true, signedIn: true, saved: false };
    const { button } = buildBookmark(7);
    await settle();

    button.click();
    await settle();

    expect(sent.at(-1)).toEqual({ type: "UNSAVE_EVALUATION", captureId: 7 });
    expect(star(button)).toBe("☆");
  });

  it("ignores clicks while a request is in flight", async () => {
    reply = () => ({ ok: true, signedIn: true, saved: false });
    const { button } = buildBookmark(1);
    await settle();

    button.click();
    button.click();

    expect(sent.filter((m) => m.type === "SAVE_EVALUATION")).toHaveLength(1);
  });

  it("keeps the star as it was when a save fails", async () => {
    reply = (message) =>
      message.type === "SAVED_STATE"
        ? { ok: true, signedIn: true, saved: false }
        : { ok: false, error: "the server said no" };
    const { button } = buildBookmark(1);
    await settle();

    button.click();
    await settle();

    // Not filled: the evaluation was not saved, and a star that lies about it
    // is worse than one that does not move.
    expect(star(button)).toBe("☆");
    expect(button.title).toBe("the server said no");
  });

  it("brings an older saved copy up to this run's figures", async () => {
    // The user ran the tool again on a car they saved last week. The star is
    // filled either way; what this fixes is the website showing last week's
    // numbers for a listing whose evaluation is on screen right now.
    reply = (message) =>
      message.type === "SAVED_STATE"
        ? { ok: true, signedIn: true, saved: true, stale: true }
        : { ok: true, signedIn: true, saved: true };
    const { button } = buildBookmark(31);
    await settle();

    expect(sent).toEqual([
      { type: "SAVED_STATE", captureId: 31 },
      { type: "SAVE_EVALUATION", captureId: 31 },
    ]);
    expect(star(button)).toBe("★");
  });

  it("does not re-post a save for the capture it was saved from", async () => {
    reply = () => ({ ok: true, signedIn: true, saved: true, stale: false });
    buildBookmark(31);
    await settle();

    expect(sent).toEqual([{ type: "SAVED_STATE", captureId: 31 }]);
  });

  it("leaves the star filled when the refresh fails", async () => {
    // The car IS still saved -- with last run's numbers. Emptying the star
    // would be the one wrong answer available.
    reply = (message) =>
      message.type === "SAVED_STATE"
        ? { ok: true, signedIn: true, saved: true, stale: true }
        : { ok: false, error: "the server said no" };
    const { button } = buildBookmark(1);
    await settle();

    expect(star(button)).toBe("★");
    expect(button.title).toBe("the server said no");
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

    const { button } = buildBookmark(1);
    await settle();

    expect(star(button)).toBe("☆");
  });
});

describe("the strip under the header", () => {
  it("names the site the saves are readable on, as a real link", async () => {
    const { strip } = buildBookmark(1);
    await settle();

    const link = strip.querySelector<HTMLAnchorElement>("a")!;
    expect(link.href).toBe(SAVED_APP_URL);
    expect(link.textContent).toContain("curbsidescore.com");
    // A link out of an overlay on facebook.com, so it opens elsewhere and does
    // not hand the destination a window handle back to this page.
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
  });

  it("points the URL at the saved list on the apex", () => {
    // Two things this pins. The HOST: `app.curbsidescore.com` now 308s to the
    // apex, so linking it still works and is a needless hop. The PATH: the
    // root is the marketing page since the merge, and somebody with saved
    // evaluations does not need to be sold the product again.
    expect(SAVED_APP_URL).toBe("https://curbsidescore.com/saved");
  });

  it("explains what saving is for before anything has been saved", async () => {
    reply = () => ({ ok: true, signedIn: true, saved: false });
    const { strip } = buildBookmark(1);
    await settle();

    expect(strip.dataset["state"]).toBe("unsaved");
    expect(strip.textContent).toContain("Save this evaluation");
  });

  it("follows the button rather than keeping a state of its own", async () => {
    reply = (message) =>
      message.type === "SAVED_STATE"
        ? { ok: true, signedIn: true, saved: false }
        : { ok: true, signedIn: true, saved: true };
    const { button, strip } = buildBookmark(1);
    await settle();

    button.click();
    await settle();

    expect(strip.dataset["state"]).toBe("saved");
    expect(strip.textContent).toContain("Saved.");
    // Still a link, and still the same one: a repaint must not swap out an
    // anchor somebody is on the way to clicking.
    expect(strip.querySelector<HTMLAnchorElement>("a")!.href).toBe(SAVED_APP_URL);
  });

  it("says so when it has refreshed an older saved copy", async () => {
    reply = (message) =>
      message.type === "SAVED_STATE"
        ? { ok: true, signedIn: true, saved: true, stale: true }
        : { ok: true, signedIn: true, saved: true };
    const { strip } = buildBookmark(1);
    await settle();

    // Silently rewriting something the user saved is the kind of helpfulness
    // that reads as a bug when it is discovered later, so it is disclosed in
    // the one place the save state is already reported.
    expect(strip.dataset["state"]).toBe("saved");
    expect(strip.textContent).toContain("updated just now");
  });

  it("stays put when a save fails", async () => {
    reply = (message) =>
      message.type === "SAVED_STATE"
        ? { ok: true, signedIn: true, saved: false }
        : { ok: false, error: "the server said no" };
    const { button, strip } = buildBookmark(1);
    await settle();

    button.click();
    await settle();

    expect(strip.dataset["state"]).toBe("unsaved");
  });
});

describe("signing in, because the user clicked save", () => {
  it("prompts rather than failing silently", async () => {
    const { button, panel } = buildBookmark(1);
    await settle();

    expect(panel.dataset["open"]).toBeUndefined();
    button.click();

    expect(panel.dataset["open"]).toBe("true");
    expect(panel.textContent).toContain("Save this evaluation");
    // Nothing was attempted against the backend: there is no session to try.
    expect(sent.filter((m) => m.type === "SAVE_EVALUATION")).toHaveLength(0);
  });

  it("shows only the email box until a code has actually been sent", async () => {
    const { button, panel } = buildBookmark(1);
    await settle();
    button.click();

    // The regression: a code box on screen before any code exists.
    expect(inputs(panel)).toHaveLength(1);
    expect(codeInput(panel)).toBeNull();
    expect(panel.querySelector(".signin-hint")).toBeNull();

    reply = () => ({ ok: true });
    await sendCodeTo(panel);

    expect(sent.at(-1)).toEqual({ type: "AUTH_REQUEST_CODE", email: "buyer@example.com" });
    expect(inputs(panel)).toHaveLength(1);
    expect(codeInput(panel)).not.toBeNull();
    expect(panel.textContent).toContain("Check your email");
    expect(panel.textContent).toContain("buyer@example.com");
  });

  it("stays on the email step when sending fails", async () => {
    const { button, panel } = buildBookmark(1);
    await settle();
    button.click();

    reply = () => ({ ok: false, error: "Could not send the sign-in email." });
    await sendCodeTo(panel);

    expect(codeInput(panel)).toBeNull();
    expect(panel.textContent).toContain("Could not send");
    expect(emailInput(panel).disabled).toBe(false);
  });

  it("refuses an obviously invalid address without calling the server", async () => {
    const { button, panel } = buildBookmark(1);
    await settle();
    button.click();

    await sendCodeTo(panel, "not-an-email");

    expect(sent.filter((m) => m.type === "AUTH_REQUEST_CODE")).toHaveLength(0);
    expect(panel.textContent).toContain("Enter your email");
  });

  it("offers a one-click fix for a mistyped domain", async () => {
    const { button, panel } = buildBookmark(1);
    await settle();
    button.click();

    const email = emailInput(panel);
    email.value = "buyer@gmial.com";
    email.dispatchEvent(new Event("input", { bubbles: true }));
    const fix = panel.querySelector<HTMLButtonElement>(".signin-suggest")!;
    expect(fix.hidden).toBe(false);
    expect(fix.textContent).toContain("buyer@gmail.com");

    fix.click();
    expect(email.value).toBe("buyer@gmail.com");
  });

  it("links straight to the inbox for a known provider", async () => {
    const { button, panel } = buildBookmark(1);
    await settle();
    button.click();

    reply = () => ({ ok: true });
    await sendCodeTo(panel, "buyer@gmail.com");

    const open = panel.querySelector<HTMLAnchorElement>(".signin-webmail")!;
    expect(open.textContent).toContain("Open Gmail");
    expect(open.href).toContain("mail.google.com");
    expect(open.target).toBe("_blank");
  });

  it("goes back to the email step, prefilled, on Change", async () => {
    const { button, panel } = buildBookmark(1);
    await settle();
    button.click();

    reply = () => ({ ok: true });
    await sendCodeTo(panel);
    panel.querySelector<HTMLButtonElement>(".signin-blurb .signin-link")!.click();

    expect(codeInput(panel)).toBeNull();
    expect(emailInput(panel).value).toBe("buyer@example.com");
  });

  it("says where to look when the email does not arrive", async () => {
    // Mail from a young sending domain lands in junk often enough that this is
    // the most likely first-run failure the product has.
    const { button, panel } = buildBookmark(1);
    await settle();
    button.click();

    reply = () => ({ ok: true });
    await sendCodeTo(panel);

    expect(panel.querySelector(".signin-hint")!.textContent).toContain("spam or junk folder");
  });

  it("formats the code as it is typed and submits itself when complete", async () => {
    const { button, panel } = buildBookmark(9);
    await settle();
    button.click();

    reply = () => ({ ok: true });
    await sendCodeTo(panel);

    reply = (message) =>
      message.type === "AUTH_VERIFY_CODE"
        ? { ok: true, email: "buyer@example.com" }
        : { ok: true, signedIn: true, saved: true };

    typeCode(panel, "abcd");
    expect(codeInput(panel)!.value).toBe("ABCD");
    expect(sent.filter((m) => m.type === "AUTH_VERIFY_CODE")).toHaveLength(0);

    // A paste of the code as the email prints it, with stray whitespace.
    typeCode(panel, " abcd-2345 ");
    await settle();
    await settle();

    expect(sent).toContainEqual({
      type: "AUTH_VERIFY_CODE",
      email: "buyer@example.com",
      code: "ABCD2345",
    });
    // The whole point: they clicked save, so signing in finishes that action.
    expect(sent.at(-1)).toEqual({ type: "SAVE_EVALUATION", captureId: 9 });
    expect(star(button)).toBe("★");
    expect(panel.dataset["open"]).toBeUndefined();
  });

  it("explains a too-short code instead of sending it", async () => {
    const { button, panel } = buildBookmark(1);
    await settle();
    button.click();

    reply = () => ({ ok: true });
    await sendCodeTo(panel);
    typeCode(panel, "ABC");
    submit(panel);
    await settle();

    expect(sent.filter((m) => m.type === "AUTH_VERIFY_CODE")).toHaveLength(0);
    expect(panel.textContent).toContain("8 characters");
  });

  it("reports a bad code, keeps the spam hint, and stays on the code step", async () => {
    const { button, panel } = buildBookmark(1);
    await settle();
    button.click();

    reply = () => ({ ok: true });
    await sendCodeTo(panel);

    reply = () => ({ ok: false, error: "That code is not right, or it has expired." });
    typeCode(panel, "WRNGCDXX");
    await settle();

    expect(panel.textContent).toContain("not right");
    expect(panel.querySelector(".signin-hint")).not.toBeNull();
    expect(codeInput(panel)!.disabled).toBe(false);
    expect(panel.dataset["open"]).toBe("true");
    expect(sent.filter((m) => m.type === "SAVE_EVALUATION")).toHaveLength(0);
  });

  it("closes on Not now without signing in", async () => {
    const { button, panel } = buildBookmark(1);
    await settle();
    button.click();

    panel.querySelector<HTMLButtonElement>(".signin-cancel")!.click();

    expect(panel.dataset["open"]).toBeUndefined();
    expect(panel.children).toHaveLength(0);
  });

  it("prompts again when a stored session has expired", async () => {
    // The worker clears an unresolvable token and reports signed-out, so the
    // button lands in the state that prompts rather than showing an error.
    reply = () => ({ ok: true, signedIn: false });
    const { button, panel } = buildBookmark(1);
    await settle();

    button.click();

    expect(panel.dataset["open"]).toBe("true");
  });
});

describe("a check that ran on a guest session", () => {
  const guestReply = () => ({ ok: true, signedIn: false, guest: true, signupBonus: 2 });

  it("turns the strip into the sign-up offer, with the number from the worker", async () => {
    reply = guestReply;
    const { strip } = buildBookmark(1);
    await settle();

    expect(strip.dataset["state"]).toBe("guest");
    const cta = strip.querySelector<HTMLButtonElement>(".saved-strip-cta")!;
    expect(cta.hidden).toBe(false);
    expect(cta.textContent).toBe("Save + get 2 more free checks");
    expect(strip.querySelector<HTMLAnchorElement>(".saved-strip-link")!.hidden).toBe(true);
  });

  it("opens the sign-up form from the strip, framed as the offer", async () => {
    reply = guestReply;
    const { strip, panel } = buildBookmark(1);
    await settle();

    strip.querySelector<HTMLButtonElement>(".saved-strip-cta")!.click();

    expect(panel.dataset["open"]).toBe("true");
    expect(panel.querySelector(".signin-title")!.textContent).toBe(
      "Save this car and get 2 more free checks",
    );
  });

  it("opens the same form from the star", async () => {
    reply = guestReply;
    const { button, panel } = buildBookmark(1);
    await settle();

    button.click();

    expect(panel.querySelector(".signin-title")!.textContent).toContain("2 more free checks");
  });

  it("saves the evaluation once the code verifies", async () => {
    reply = (message) => {
      if (message.type === "SAVED_STATE") return guestReply();
      if (message.type === "AUTH_REQUEST_CODE") return { ok: true };
      if (message.type === "AUTH_VERIFY_CODE") return { ok: true, email: "a@b.co" };
      if (message.type === "SAVE_EVALUATION") return { ok: true, signedIn: true, saved: true };
      return { ok: false, error: "unexpected" };
    };
    const { button, strip, panel } = buildBookmark(7);
    await settle();

    strip.querySelector<HTMLButtonElement>(".saved-strip-cta")!.click();
    expect(panel.querySelector(".signin-submit")!.textContent).toBe("Save & get 2 more free checks");
    await sendCodeTo(panel, "a@b.co");
    typeCode(panel, "ABCD-2345");
    await settle();
    await settle();

    expect(sent.map((m) => m.type)).toContain("SAVE_EVALUATION");
    expect(star(button)).toBe("★");
    expect(strip.dataset["state"]).toBe("saved");
    expect(strip.querySelector<HTMLButtonElement>(".saved-strip-cta")!.hidden).toBe(true);
  });
});
