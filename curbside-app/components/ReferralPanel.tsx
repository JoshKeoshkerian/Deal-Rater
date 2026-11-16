"use client";

/**
 * "Refer a friend" on /account: the share link, a copy button, and progress
 * toward the cap. The rules live in `backend/app/referrals/service.py`; the
 * numbers shown here come from `GET /v1/referrals/me`, not from constants,
 * so the copy cannot promise something the backend won't pay.
 */

import { useCallback, useEffect, useState } from "react";

import { fetchReferrals } from "@/lib/api";
import type { ReferralState } from "@/lib/types";

function checks(n: number): string {
  return `${n} free check${n === 1 ? "" : "s"}`;
}

export function ReferralPanel() {
  const [state, setState] = useState<ReferralState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setState(await fetchReferrals());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load your referral link.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async () => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const atCap = state !== null && state.rewarded >= state.max_rewards;

  return (
    <section className="panel" aria-labelledby="referral-title">
      <h2 className="panel__title" id="referral-title">
        Refer a friend
      </h2>

      {error ? (
        <div className="state" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn--ghost" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : !state ? (
        <p className="dim">Loading…</p>
      ) : (
        <>
          <p className="referral__lede">
            {atCap ? (
              <>
                You&rsquo;ve earned the maximum {checks(state.max_rewards * state.checks_per_referral)}{" "}
                from referrals. Thanks for spreading the word! You can still share your link.
              </>
            ) : (
              <>
                Share your link. When a friend installs Curbside and signs up with their email,
                you get <strong>{checks(state.checks_per_referral)}</strong>, for up to{" "}
                {state.max_rewards} friends.
              </>
            )}
          </p>

          <div className="referral__link">
            <input
              className="referral__input"
              type="text"
              readOnly
              value={state.url}
              aria-label="Your referral link"
              onFocus={(event) => event.currentTarget.select()}
            />
            <button type="button" className="btn" onClick={() => void copy()} aria-live="polite">
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>

          <dl className="deflist referral__stats">
            <div>
              <dt>Friends rewarded</dt>
              <dd>
                {state.rewarded} of {state.max_rewards}
              </dd>
            </div>
            <div>
              <dt>Checks earned</dt>
              <dd>{state.checks_earned}</dd>
            </div>
            {state.pending > 0 && (
              <div>
                <dt>Waiting on install</dt>
                <dd className="dim">
                  {state.pending} signed up on the website but haven&rsquo;t signed in to the
                  extension yet.
                </dd>
              </div>
            )}
          </dl>
        </>
      )}
    </section>
  );
}
