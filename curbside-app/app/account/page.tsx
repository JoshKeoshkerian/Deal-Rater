"use client";

/**
 * Account and subscription management.
 *
 * THE PLAN AND THE BALANCE ON THIS PAGE ARE DRAWN, NOT MEASURED. There is no
 * billing in the backend — see the header comment in `lib/billing.ts` — so
 * every figure below the account block comes from a hand-written fixture. The
 * banner at the top says so, and the state switcher beside it exists because
 * "what would this look like once it is built" is the actual question this page
 * was made to answer, and one hardcoded state answers a third of it.
 *
 * WHAT IS REAL HERE: the email address, the account creation date and the sign
 * out button. Those come from `GET /v1/users/me` and the live session, exactly
 * as the saved list does.
 *
 * When billing exists, three things change and nothing else: the fixture import
 * becomes a fetch, the banner and the switcher come out, and the buttons call a
 * processor instead of opening a dialog.
 */

import Link from "next/link";
import { useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { ComingSoonDialog } from "@/components/ComingSoonDialog";
import { SignIn } from "@/components/SignIn";
import {
  BILLING_IS_PREVIEW,
  PREVIEW_STATES,
  billingDate,
  type PreviewStateId,
} from "@/lib/billing";
import { checkedOn } from "@/lib/format";
import { FREE_EVALUATIONS, formatPrice, planById } from "@/lib/plans";

import "./account.css";

type Action = "buy" | "change" | "cancel" | "resume";

const ACTION_TITLES: Record<Action, string> = {
  buy: "Payments aren’t switched on yet.",
  change: "Plan changes aren’t switched on yet.",
  cancel: "Cancelling isn’t switched on yet.",
  resume: "Resuming isn’t switched on yet.",
};

export default function AccountPage() {
  const { user, status, signOut } = useAuth();
  const [previewId, setPreviewId] = useState<PreviewStateId>("free");
  const [action, setAction] = useState<Action | null>(null);

  const preview = PREVIEW_STATES.find((entry) => entry.id === previewId) ?? PREVIEW_STATES[0];
  const billing = preview.state;
  const plan = billing.plan ? planById(billing.plan) : null;
  const unlimited = plan?.interval === "month";

  if (status === "unknown") {
    return (
      <main className="wrap page">
        <div className="state">
          <p>Loading…</p>
        </div>
      </main>
    );
  }

  if (status !== "signed-in" || !user) {
    return (
      <main className="wrap page">
        <header className="page-head">
          <h1 className="page-h1">Your account</h1>
          <p className="page-lede">
            Sign in to see your plan, your remaining checks and your saved evaluations.
          </p>
        </header>
        <SignIn initialEmail={null} initialCode={null} heading="Sign in to Curbside" />
      </main>
    );
  }

  // Free-tier users have no plan row; the allowance is the whole story.
  const remaining = billing.evaluationsRemaining;

  return (
    <main className="wrap page">
      {BILLING_IS_PREVIEW && (
        <div className="preview-banner">
          <div>
            <strong>Preview.</strong> Billing isn&rsquo;t built yet, so the plan, balance and
            history below are made up. Your email address and saved evaluations are real.
          </div>
          <label className="preview-banner__pick">
            <span>Show me</span>
            <select
              value={previewId}
              onChange={(event) => setPreviewId(event.target.value as PreviewStateId)}
            >
              {PREVIEW_STATES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <header className="page-head">
        <h1 className="page-h1">Your account</h1>
      </header>

      <section className="panel">
        <h2 className="panel__title">Sign-in</h2>
        <dl className="deflist">
          <div>
            <dt>Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>Account since</dt>
            <dd>{checkedOn(user.created_at)}</dd>
          </div>
          <div>
            <dt>Password</dt>
            <dd className="dim">
              None. Signing in emails you a one-time code, so there is no password to change or
              leak.
            </dd>
          </div>
        </dl>
        <div className="panel__actions">
          <Link className="btn btn--ghost" href="/saved">
            Saved evaluations
          </Link>
          <button type="button" className="linkish" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">Plan</h2>

        <div className="planrow">
          <div className="planrow__now">
            <span className="lbl">Current</span>
            <p className="planrow__name">{plan ? plan.name : "Free"}</p>
            <p className="planrow__sub">
              {plan
                ? `${formatPrice(plan.priceCents)}${plan.interval === "month" ? " per month" : ", one time"}`
                : `${FREE_EVALUATIONS} checks on install`}
            </p>
          </div>

          <div className="planrow__balance">
            {unlimited ? (
              <>
                <span className="lbl">Checks left</span>
                <p className="balance balance--unlimited">Unlimited</p>
                <p className="planrow__sub">
                  {billing.endsAt
                    ? `Ends ${billingDate(billing.endsAt)} — no further charges.`
                    : billing.renewsAt
                      ? `Renews ${billingDate(billing.renewsAt)}.`
                      : null}
                </p>
              </>
            ) : (
              <>
                <span className="lbl">Checks left</span>
                <p className="balance">
                  {remaining ?? 0}
                  {billing.freeEvaluationsRemaining > 0 && (
                    <span className="balance__of"> of your {FREE_EVALUATIONS} free</span>
                  )}
                </p>
                {/* A meter, not a progress bar: it measures a level, and
                    `<meter>` is the element that says so to a screen reader. */}
                <meter
                  className="balance__meter"
                  min={0}
                  max={billing.freeEvaluationsRemaining > 0 ? FREE_EVALUATIONS : (plan?.evaluations ?? FREE_EVALUATIONS)}
                  low={2}
                  optimum={FREE_EVALUATIONS}
                  value={remaining ?? 0}
                >
                  {remaining ?? 0} checks left
                </meter>
                <p className="planrow__sub">
                  {(remaining ?? 0) === 0
                    ? "Out of checks. Saved evaluations stay readable."
                    : "Checks don’t expire."}
                </p>
              </>
            )}
          </div>
        </div>

        <div className="panel__actions">
          {unlimited ? (
            <>
              <button type="button" className="btn btn--ghost" onClick={() => setAction("change")}>
                Change plan
              </button>
              <button type="button" className="linkish danger" onClick={() => setAction("cancel")}>
                Cancel subscription
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={() => setAction("buy")}>
                Buy more checks
              </button>
              <Link className="btn btn--ghost" href="/pricing">
                Compare plans
              </Link>
            </>
          )}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">Billing history</h2>
        {billing.purchases.length === 0 ? (
          <p className="dim">
            Nothing yet — you haven&rsquo;t paid for anything. The {FREE_EVALUATIONS} free checks
            don&rsquo;t appear here.
          </p>
        ) : (
          <table className="history">
            <colgroup>
              <col className="date" />
              <col />
              <col className="amount" />
              <col className="receipt" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">What</th>
                <th scope="col" className="num">
                  Amount
                </th>
                <th scope="col">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {billing.purchases.map((purchase) => (
                <tr key={purchase.id}>
                  <td>{billingDate(purchase.at, "short")}</td>
                  <td>{purchase.description}</td>
                  <td className="num">{formatPrice(purchase.amountCents)}</td>
                  <td>
                    {purchase.receiptUrl ? (
                      <a href={purchase.receiptUrl}>PDF</a>
                    ) : (
                      <span className="dim">&mdash;</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {action && (
        <ComingSoonDialog title={ACTION_TITLES[action]} onClose={() => setAction(null)}>
          <p>
            Nothing changed. Billing has not been built yet, so there is no plan to alter, no card
            on file, and nothing to cancel.
          </p>
          <p>
            While it&rsquo;s off, every install gets {FREE_EVALUATIONS} free checks and nothing is
            metered beyond that. Your saved evaluations are unaffected either way.
          </p>
        </ComingSoonDialog>
      )}
    </main>
  );
}
