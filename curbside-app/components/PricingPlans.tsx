"use client";

/**
 * The three plan cards and the real checkout behind them.
 *
 * Clicking a plan while signed in starts a Stripe Checkout Session
 * server-side and redirects there directly -- no Stripe.js on this page at
 * all, see `lib/api.ts`'s `createCheckoutSession`. Clicking one while signed
 * out shows the same sign-in form used elsewhere on the site first, and
 * `onSignedIn` continues straight into checkout for the plan that was
 * clicked, so signing in completes the action rather than leaving the user
 * to click the plan a second time.
 */

import { useState } from "react";

import { Modal } from "@/components/Modal";
import { useAuth } from "@/components/AuthProvider";
import { SignIn } from "@/components/SignIn";
import { ApiError, createCheckoutSession } from "@/lib/api";
import { PLANS, formatPrice, perCheckPrice, type Plan } from "@/lib/plans";

function PlanCard({
  plan,
  busy,
  onSelect,
}: {
  plan: Plan;
  busy: boolean;
  onSelect: (plan: Plan) => void;
}) {
  const unit = perCheckPrice(plan);
  return (
    <div className={`plan${plan.featured ? " plan--featured" : ""}`}>
      {plan.featured && <span className="plan__flag">Best value</span>}
      <h3 className="plan__name">{plan.name}</h3>
      <p className="plan__price">
        <b>{formatPrice(plan.priceCents)}</b>
        <span>{plan.interval === "month" ? "/month" : "once"}</span>
      </p>
      <p className="plan__unit">{unit ? `${unit} per check` : "No per-check limit"}</p>
      <ul className="plan__points">
        {plan.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <button
        type="button"
        className={`btn plan__btn${plan.featured ? "" : " btn--ghost"}`}
        disabled={busy}
        onClick={() => onSelect(plan)}
      >
        {plan.interval === "month" ? "Subscribe" : `Buy ${plan.name.toLowerCase()}`}
      </button>
    </div>
  );
}

export function PricingPlans() {
  const { status } = useAuth();
  const [pendingSignIn, setPendingSignIn] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCheckout = async (plan: Plan) => {
    setBusy(true);
    setError(null);
    try {
      window.location.href = await createCheckoutSession(plan.id);
      // No `setBusy(false)` on success: the page is navigating away, and
      // re-enabling the buttons for the instant before that happens would
      // just invite a second click during the redirect.
    } catch (caught) {
      setBusy(false);
      const message =
        caught instanceof ApiError && caught.status === 503
          ? "Payments aren't switched on for this deployment yet."
          : caught instanceof Error
            ? caught.message
            : "Could not start checkout.";
      setError(message);
    }
  };

  const onSelect = (plan: Plan) => {
    if (status === "signed-in") {
      void startCheckout(plan);
    } else {
      setPendingSignIn(plan);
    }
  };

  return (
    <>
      <div className="plans">
        {PLANS.map((plan) => (
          <PlanCard key={plan.id} plan={plan} busy={busy} onSelect={onSelect} />
        ))}
      </div>

      {error && (
        <Modal title="Couldn’t start checkout" onClose={() => setError(null)}>
          <p>{error}</p>
        </Modal>
      )}

      {pendingSignIn && (
        <Modal
          title="Sign in to continue"
          onClose={() => setPendingSignIn(null)}
          dismissLabel={null}
        >
          <SignIn
            initialEmail={null}
            initialCode={null}
            heading={`Sign in to buy ${pendingSignIn.name}`}
            onSignedIn={() => {
              const plan = pendingSignIn;
              setPendingSignIn(null);
              void startCheckout(plan);
            }}
          />
        </Modal>
      )}
    </>
  );
}
