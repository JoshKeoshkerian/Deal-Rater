"use client";

/**
 * The login gate: an EMAIL screen, then -- only once the email has actually
 * been sent -- a CODE screen. Same flow and same principles as the
 * extension's (`extension/src/content/overlay/signin-panel.ts`):
 *
 *   - Two separate screens. The code box doesn't exist until a code does.
 *   - One field per screen, a button that says what happens next, and a
 *     one-click fix for common email typos.
 *   - The code screen links to the user's webmail, and the code box submits
 *     itself as soon as 8 characters are in (typed or pasted).
 *
 * `verifySignInCode` sends `client: "web"`, which makes the server set an
 * httpOnly cookie instead of returning a token this page would have to hold.
 *
 * IT ALSO HANDLES THE EMAILED LINK. `mailer.py` sends both a code and a link,
 * and the link lands here as `?email=&code=`; when both are present the form
 * verifies straight away rather than asking for what they just clicked past.
 *
 * A successful sign-in always updates the shared auth state, so the header
 * flips to signed-in wherever this form was rendered. `onSignedIn` is the
 * extra thing a particular page wants afterwards.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { ApiError, requestSignInCode, verifySignInCode } from "@/lib/api";
import {
  CODE_LENGTH,
  canonicalCode,
  formatCode,
  looksLikeEmail,
  suggestEmail,
  webmailFor,
} from "@/lib/signin-helpers";
import type { User } from "@/lib/types";

type Step = "email" | "code";
type Tone = "info" | "error";

/** Seconds "Resend code" disables itself for after a send. */
const RESEND_COOLDOWN_S = 30;

function messageFor(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 429) {
    return "Too many attempts. Wait a bit before trying again.";
  }
  return error instanceof Error ? error.message : fallback;
}

export function SignIn({
  initialEmail,
  initialCode,
  onSignedIn,
  heading = "Your saved evaluations",
  blurb = "Enter your email and we'll send you a code. No password needed.",
  cta = "Continue",
}: {
  initialEmail: string | null;
  initialCode: string | null;
  onSignedIn?: (user: User) => void;
  /** What the form is a gate to. The pages using it gate different things. */
  heading?: string;
  blurb?: string;
  /** The email screen's button. Say what they get. */
  cta?: string;
}) {
  const { setUser } = useAuth();
  const [step, setStep] = useState<Step>(initialCode ? "code" : "email");
  const [email, setEmail] = useState(initialEmail ?? "");
  const [code, setCode] = useState(initialCode ? formatCode(canonicalCode(initialCode)) : "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<Tone>("info");
  const [resendCooldown, setResendCooldown] = useState(0);

  const fail = useCallback((text: string) => {
    setMessage(text);
    setTone("error");
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = window.setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [resendCooldown]);

  const verify = useCallback(
    async (withEmail: string, withCode: string) => {
      setBusy(true);
      setMessage("");
      try {
        const result = await verifySignInCode(withEmail, withCode);
        if (!result?.user) {
          fail("Signed in, but the server did not say who as. Try again.");
          return;
        }
        setUser(result.user);
        onSignedIn?.(result.user);
      } catch (error) {
        fail(messageFor(error, "That did not work."));
      } finally {
        setBusy(false);
      }
    },
    [fail, onSignedIn, setUser],
  );

  const sendCode = useCallback(
    async (to: string, resend: boolean) => {
      setBusy(true);
      setMessage("");
      try {
        await requestSignInCode(to);
        setStep("code");
        setCode("");
        setResendCooldown(RESEND_COOLDOWN_S);
        if (resend) {
          setTone("info");
          setMessage(`A new code is on its way to ${to}. Use the newest one.`);
        }
      } catch (error) {
        fail(messageFor(error, resend ? "Could not send a new code." : "Could not send that."));
      } finally {
        setBusy(false);
      }
    },
    [fail],
  );

  // The emailed link, verified once on arrival. The ref guards StrictMode's
  // double-invoke in development, which would otherwise spend the single-use
  // code on the first call and report the second as invalid.
  const autoVerified = useRef(false);
  useEffect(() => {
    if (autoVerified.current) return;
    if (!initialEmail || !initialCode) return;
    autoVerified.current = true;
    void verify(initialEmail, initialCode);
  }, [initialEmail, initialCode, verify]);

  const trimmed = email.trim();
  const suggestion = step === "email" ? suggestEmail(trimmed) : null;

  if (step === "email") {
    return (
      <form
        className="signin"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          if (!looksLikeEmail(trimmed)) {
            fail("Enter your email address, like you@example.com.");
            return;
          }
          void sendCode(trimmed, false);
        }}
      >
        <h2>{heading}</h2>
        <p>{blurb}</p>

        <label className="price-label" htmlFor="signin-email">
          Email
        </label>
        <input
          id="signin-email"
          className="field"
          type="email"
          inputMode="email"
          autoComplete="email"
          spellCheck={false}
          autoFocus
          placeholder="you@example.com"
          value={email}
          disabled={busy}
          onChange={(event) => setEmail(event.target.value)}
        />
        {suggestion && (
          <button type="button" className="linkish signin-suggest" onClick={() => setEmail(suggestion)}>
            Did you mean <strong>{suggestion}</strong>?
          </button>
        )}

        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Sending your code…" : cta}
        </button>
        <p className="signin-assurance">No password · No card · Takes 30 seconds</p>

        <p className="form-note" data-tone={tone} role="status" aria-live="polite">
          {message}
        </p>
      </form>
    );
  }

  const webmail = webmailFor(trimmed);

  return (
    <form
      className="signin"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        const canonical = canonicalCode(code);
        if (canonical.length < CODE_LENGTH) {
          fail(`The code is ${CODE_LENGTH} characters, like ABCD-2345.`);
          return;
        }
        void verify(trimmed, canonical);
      }}
    >
      <h2>Check your email</h2>
      <p>
        We sent an {CODE_LENGTH}-character code to <strong className="signin-email">{trimmed}</strong>
        .{" "}
        <button
          type="button"
          className="linkish"
          disabled={busy}
          onClick={() => {
            setStep("email");
            setCode("");
            setMessage("");
            setResendCooldown(0);
          }}
        >
          Change
        </button>
      </p>

      {webmail && (
        <a className="btn btn--ghost signin-webmail" href={webmail.url} target="_blank" rel="noopener noreferrer">
          {webmail.label} <span aria-hidden="true">↗</span>
        </a>
      )}

      <label className="price-label" htmlFor="signin-code">
        Code from the email
      </label>
      <input
        id="signin-code"
        className="field code"
        type="text"
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellCheck={false}
        autoFocus
        maxLength={CODE_LENGTH + 1}
        placeholder="ABCD-2345"
        value={code}
        disabled={busy}
        onChange={(event) => {
          const canonical = canonicalCode(event.target.value);
          setCode(formatCode(canonical));
          if (tone === "error") setMessage("");
          // Go as soon as the code is complete: no second button to find.
          if (canonical.length === CODE_LENGTH && !busy) void verify(trimmed, canonical);
        }}
      />

      <button className="btn" type="submit" disabled={busy}>
        {busy ? "Signing you in…" : "Verify and continue"}
      </button>

      <p className="form-note" data-tone={tone} role="status" aria-live="polite">
        {message}
      </p>

      <p className="form-note code-actions">
        <button
          type="button"
          className="linkish"
          disabled={busy || resendCooldown > 0}
          onClick={() => void sendCode(trimmed, true)}
        >
          {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : "Resend code"}
        </button>
      </p>

      {/* A standing note, not the status line: that line is overwritten by
          every attempt, which is exactly when someone is hunting for a code
          that landed in junk -- the most likely first-run failure. */}
      <p className="form-note form-note--hint">
        Not there in a minute? Check your spam or junk folder, and mark it as not spam so the
        next one arrives in your inbox.
      </p>
    </form>
  );
}
