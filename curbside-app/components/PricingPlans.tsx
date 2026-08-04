"use client";

/**
 * The three plan cards and the not-yet-live checkout.
 *
 * THE BUTTONS DO NOT BUY ANYTHING and the dialog they open says so in its first
 * sentence. This is the deliberate shape of a payments section built before a
 * payment processor: the layout, the copy and the price ladder are the parts
 * worth reviewing now, and a button that quietly did nothing would be a worse
 * lie than one that explains itself.
 *
 * When a processor lands, the click handler becomes the call that creates a
 * checkout session and `ComingSoonDialog` is deleted.
 */

import { useState } from "react";

import { ComingSoonDialog } from "@/components/ComingSoonDialog";
import { useAuth } from "@/components/AuthProvider";
import { FREE_EVALUATIONS, PLANS, formatPrice, perCheckPrice, type Plan } from "@/lib/plans";

function PlanCard({ plan, onSelect }: { plan: Plan; onSelect: (plan: Plan) => void }) {
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
        onClick={() => onSelect(plan)}
      >
        {plan.interval === "month" ? "Subscribe" : `Buy ${plan.name.toLowerCase()}`}
      </button>
    </div>
  );
}

export function PricingPlans() {
  const { status, user } = useAuth();
  const [selected, setSelected] = useState<Plan | null>(null);

  return (
    <>
      <div className="plans">
        {PLANS.map((plan) => (
          <PlanCard key={plan.id} plan={plan} onSelect={setSelected} />
        ))}
      </div>

      {selected && (
        <ComingSoonDialog
          title="Payments aren’t switched on yet."
          onClose={() => setSelected(null)}
        >
          <p>
            Nothing was charged and nothing was reserved. This page exists so the plans can be read
            and argued with before the checkout behind them is built.
          </p>
          <p className="modal__plan">
            You picked <b>{selected.name}</b> &mdash; {formatPrice(selected.priceCents)}
            {selected.interval === "month" ? " per month" : " once"}.
          </p>
          <p>
            Until it is live, every install gets {FREE_EVALUATIONS} free checks and nothing is
            metered beyond that.
            {status === "signed-in" && user ? ` Signed in as ${user.email}.` : ""}
          </p>
        </ComingSoonDialog>
      )}
    </>
  );
}
