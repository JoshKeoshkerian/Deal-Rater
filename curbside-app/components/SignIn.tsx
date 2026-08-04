"use client";

/**
 * The login gate: email, then the code from that email.
 *
 * The same two-step flow as the extension's, and the same backend endpoints —
 * only the transport differs. `verifySignInCode` sends `client: "web"`, which
 * is what makes the server set an httpOnly cookie instead of returning a token
 * this page would then have to hold.
 *
 * IT ALSO HANDLES THE EMAILED LINK. `mailer.py` sends both a code to type and a
 * link to click, and the link lands here as `?email=&code=`. When those are
 * present the form skips straight to verifying, so clicking the link in a mail
 * client does what a link is expected to do rather than dumping the user on a
 * form asking for something they just clicked past.
 *
 * A SUCCESSFUL SIGN-IN ALWAYS UPDATES THE SHARED AUTH STATE, so the header
 * flips to signed-in wherever this form was rendered. `onSignedIn` is the extra
 * thing a particular page wants afterwards — the saved list uses it to load the
 * list — and is optional because /account has nothing further to do.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { requestSignInCode, verifySignInCode } from "@/lib/api";
import type { User } from "@/lib/types";

type Step = "email" | "code";
type Tone = "info" | "error";

export function SignIn({
  initialEmail,
  initialCode,
  onSignedIn,
  heading = "Your saved evaluations",
}: {
  initialEmail: string | null;
  initialCode: string | null;
  onSignedIn?: (user: User) => void;
  /** What the form is a gate to. The two pages using it gate different things. */
  heading?: string;
}) {
  const { setUser } = useAuth();
  const [step, setStep] = useState<Step>(initialCode ? "code" : "email");
  const [email, setEmail] = useState(initialEmail ?? "");
  const [code, setCode] = useState(initialCode ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<Tone>("info");

  const fail = useCallback((text: string) => {
    setMessage(text);
    setTone("error");
  }, []);

  const verify = useCallback(
    async (withEmail: string, withCode: string) => {
      setBusy(true);
      setTone("info");
      setMessage("Checking…");
      try {
        const result = await verifySignInCode(withEmail, withCode);
        if (!result?.user) {
          fail("Signed in, but the server did not say who as. Try again.");
          return;
        }
        setUser(result.user);
        onSignedIn?.(result.user);
      } catch (error) {
        fail(error instanceof Error ? error.message : "That did not work.");
      } finally {
        setBusy(false);
      }
    },
    [fail, onSignedIn, setUser],
  );

  // The emailed link, verified once on arrival. The ref guards React 18+
  // StrictMode's deliberate double-invoke in development, which would
  // otherwise spend the single-use code on the first call and report the
  // second as invalid — a bug that appears only in development and looks
  // exactly like a broken login.
  const autoVerified = useRef(false);
  useEffect(() => {
    if (autoVerified.current) return;
    if (!initialEmail || !initialCode) return;
    autoVerified.current = true;
    void verify(initialEmail, initialCode);
  }, [initialEmail, initialCode, verify]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;

    if (step === "email") {
      setBusy(true);
      setTone("info");
      setMessage("Sending…");
      try {
        await requestSignInCode(email.trim());
        setStep("code");
        setTone("info");
        setMessage(`Code sent to ${email.trim()}. It works once, and expires shortly.`);
      } catch (error) {
        fail(error instanceof Error ? error.message : "Could not send that.");
      } finally {
        setBusy(false);
      }
      return;
    }

    await verify(email.trim(), code.trim());
  };

  return (
    <form className="signin" onSubmit={onSubmit}>
      <h2>{heading}</h2>
      <p>
        Sign in with the email you used in the extension. There is no password — we send you a
        code.
      </p>

      <label className="price-label" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        className="field"
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        disabled={busy || step === "code"}
        onChange={(event) => setEmail(event.target.value)}
      />

      {step === "code" && (
        <>
          <label className="price-label" htmlFor="code">
            Code from the email
          </label>
          <input
            id="code"
            className="field code"
            type="text"
            required
            autoComplete="one-time-code"
            placeholder="ABCD-2345"
            value={code}
            disabled={busy}
            autoFocus
            onChange={(event) => setCode(event.target.value)}
          />
        </>
      )}

      <button className="btn" type="submit" disabled={busy}>
        {step === "email" ? "Email me a code" : "Sign in"}
      </button>

      {step === "code" && (
        <p className="form-note">
          <button
            type="button"
            className="linkish"
            disabled={busy}
            onClick={() => {
              setStep("email");
              setCode("");
              setMessage("");
            }}
          >
            Use a different email
          </button>
        </p>
      )}

      {/* role=status so the outcome is announced, not only shown. */}
      <p className="form-note" data-tone={tone} role="status" aria-live="polite">
        {message}
      </p>
    </form>
  );
}
