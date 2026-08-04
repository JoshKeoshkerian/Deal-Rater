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

  it("asks for an email first, then a code", async () => {
    const { button, panel } = buildBookmark(1);
    await settle();
    button.click();

    const [email, code] = inputs(panel);
    expect(code!.hidden).toBe(true);

    reply = () => ({ ok: true });
    email!.value = "buyer@example.com";
    submit(panel);
    await settle();

    expect(sent.at(-1)).toEqual({ type: "AUTH_REQUEST_CODE", email: "buyer@example.com" });
    expect(code!.hidden).toBe(false);
    expect(panel.textContent).toContain("buyer@example.com");
  });

  it("saves the evaluation once the code verifies", async () => {
    const { button, panel } = buildBookmark(9);
    await settle();
    button.click();

    reply = () => ({ ok: true });
    const [email, code] = inputs(panel);
    email!.value = "buyer@example.com";
    submit(panel);
    await settle();

    reply = (message) =>
      message.type === "AUTH_VERIFY_CODE"
        ? { ok: true, email: "buyer@example.com" }
        : { ok: true, signedIn: true, saved: true };
    code!.value = "abcd-2345";
    submit(panel);
    await settle();

    // The whole point: they clicked save, so signing in finishes that action
    // rather than handing them an empty star to click again.
    expect(sent.at(-1)).toEqual({ type: "SAVE_EVALUATION", captureId: 9 });
    expect(star(button)).toBe("★");
    expect(panel.dataset["open"]).toBeUndefined();
  });

  it("reports a bad code and stays on the code step", async () => {
    const { button, panel } = buildBookmark(1);
    await settle();
    button.click();

    reply = () => ({ ok: true });
    const [email, code] = inputs(panel);
    email!.value = "buyer@example.com";
    submit(panel);
    await settle();

    reply = () => ({ ok: false, error: "That code is not right, or it has expired." });
    code!.value = "WRONGCOD";
    submit(panel);
    await settle();

    expect(panel.textContent).toContain("not right");
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
