"use client";

/**
 * Account and subscription management, reading real billing state.
 *
 * WHAT CHANGED FROM THE PREVIEW. The plan/balance/history below used to come
 * from a hand-written fixture (`lib/billing.ts`'s old `PREVIEW_STATES`) with
 * a banner saying so. Both are gone: this now calls `GET /v1/billing/me`
 * (`backend/app/api/billing.py`), same as the saved list calls its own
 * endpoint. "Buy more checks" links to `/pricing`, where plan-picking already
 * lives; "Change plan" and "Cancel subscription" both open Stripe's Billing
 * Portal, which is where either actually happens now.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { Modal } from "@/components/Modal";
import { SignIn } from "@/components/SignIn";
import { billingDate, type BillingState } from "@/lib/billing";
import { checkedOn } from "@/lib/format";
import { ApiError, fetchBillingState, openBillingPortal } from "@/lib/api";
import { FREE_EVALUATIONS, formatPrice, planById } from "@/lib/plans";

import "./account.css";

/**
 * `useSearchParams()` needs a Suspense boundary in the App Router, or it
 * de-opts this whole route from static rendering with a build-time warning.
 * The fallback never actually shows in practice -- the search params are
 * available on the client synchronously from the URL the page already
 * loaded with -- but the boundary has to exist regardless.
 */
export default function AccountPage() {
  return (
    <Suspense fallback={null}>
      <AccountPageContent />
    </Suspense>
  );
}

function AccountPageContent() {
  const { user, status, error: authError, refresh, signOut, signOutError } = useAuth();
  const searchParams = useSearchParams();
  const checkoutResult = searchParams.get("checkout");

  const [billing, setBilling] = useState<BillingState | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  const loadBilling = useCallback(async () => {
    setBillingError(null);
    try {
      setBilling(await fetchBillingState());
    } catch (caught) {
      setBillingError(caught instanceof Error ? caught.message : "Could not load billing.");
    }
  }, []);

  useEffect(() => {
    if (status === "signed-in") void loadBilling();
  }, [status, loadBilling]);

  const openPortal = async () => {
    setPortalBusy(true);
    setPortalError(null);
    try {
      window.location.href = await openBillingPortal();
    } catch (caught) {
      setPortalBusy(false);
      const message =
        caught instanceof ApiError && caught.status === 503
          ? "Payments aren't switched on for this deployment yet."
          : caught instanceof Error
            ? caught.message
            : "Could not open the billing portal.";
      setPortalError(message);
    }
  };

  if (status === "unknown") {
    return (
      <main className="wrap page" id="main">
        <div className="state">
          <p>Loading…</p>
        </div>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="wrap page" id="main">
        <header className="page-head">
          <h1 className="page-h1">Your account</h1>
        </header>
        <div className="state" role="alert">
          <h2>Couldn&rsquo;t reach Curbside</h2>
          <p>{authError || "Something went wrong checking whether you're signed in."}</p>
          <button type="button" className="btn btn--ghost" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (status !== "signed-in" || !user) {
    return (
      <main className="wrap page" id="main">
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

  const plan = billing?.plan ? planById(billing.plan) : null;
  const unlimited = plan?.interval === "month";
  const remaining = billing?.evaluations_remaining ?? null;

  return (
    <main className="wrap page" id="main">
      {checkoutResult === "success" && (
        <div className="notice-banner">
          <div>
            <strong>Thanks!</strong> Your payment went through. It can take a few seconds for the
            balance below to update.
          </div>
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
        {signOutError && (
          <p className="form-note" data-tone="error" role="status">
            {signOutError}
          </p>
        )}
      </section>

      <section className="panel">
        <h2 className="panel__title">Plan</h2>

        {billingError ? (
          <div className="state" role="alert">
            <p>{billingError}</p>
            <button type="button" className="btn btn--ghost" onClick={() => void loadBilling()}>
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="planrow">
              <div className="planrow__now">
                <span className="lbl">Current</span>
                <p className="planrow__name">{plan ? plan.name : "Free"}</p>
                <p className="planrow__sub">
                  {plan
                    ? `${formatPrice(plan.priceCents)}${plan.interval === "month" ? " per month" : ", one time"}`
                    : `${FREE_EVALUATIONS} checks on sign-in`}
                </p>
              </div>

              <div className="planrow__balance">
                {unlimited ? (
                  <>
                    <span className="lbl">Checks left</span>
                    <p className="balance balance--unlimited">Unlimited</p>
                    <p className="planrow__sub">
                      {billing?.ends_at
                        ? `Ends ${billingDate(billing.ends_at)} — no further charges.`
                        : billing?.renews_at
                          ? `Renews ${billingDate(billing.renews_at)}.`
                          : null}
                    </p>
                  </>
                ) : (
                  <>
                    <span className="lbl">Checks left</span>
                    <p className="balance">
                      {remaining ?? 0}
                      {(billing?.free_evaluations_remaining ?? 0) > 0 && (
                        <span className="balance__of"> of your {FREE_EVALUATIONS} free</span>
                      )}
                    </p>
                    <meter
                      className="balance__meter"
                      min={0}
                      max={
                        (billing?.free_evaluations_remaining ?? 0) > 0
                          ? FREE_EVALUATIONS
                          : (plan?.evaluations ?? FREE_EVALUATIONS)
                      }
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
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={portalBusy}
                    onClick={() => void openPortal()}
                  >
                    Change plan
                  </button>
                  <button
                    type="button"
                    className="linkish danger"
                    disabled={portalBusy}
                    onClick={() => void openPortal()}
                  >
                    Cancel subscription
                  </button>
                </>
              ) : (
                <>
                  <Link className="btn" href="/pricing">
                    Buy more checks
                  </Link>
                  <Link className="btn btn--ghost" href="/pricing">
                    Compare plans
                  </Link>
                </>
              )}
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <h2 className="panel__title">Billing history</h2>
        {!billing || billing.purchases.length === 0 ? (
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
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">What</th>
                <th scope="col" className="num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {billing.purchases.map((purchase) => (
                <tr key={purchase.id}>
                  <td>{billingDate(purchase.at, "short")}</td>
                  <td>{purchase.description}</td>
                  <td className="num">{formatPrice(purchase.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {portalError && (
        <Modal title="Couldn’t open the billing portal" onClose={() => setPortalError(null)}>
          <p>{portalError}</p>
        </Modal>
      )}
    </main>
  );
}
