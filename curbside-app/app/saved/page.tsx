"use client";

/**
 * The one real page: a login gate, then the signed-in user's saved evaluations.
 *
 * ENTIRELY CLIENT-SIDE, which is a decision rather than a default. The session
 * is an httpOnly cookie on `.curbsidescore.com`, so the browser attaches it to
 * calls at `api.curbsidescore.com` by itself. Rendering this on the server
 * would mean forwarding that cookie from Vercel to the API on every request —
 * more moving parts, one more place for auth to be re-implemented, and no
 * benefit for a page that must not be cached or indexed anyway.
 *
 * NOTHING IS RE-SCORED HERE. `GET /v1/users/me/saved` returns stored snapshots;
 * it runs no regression, calls no external API, and bills nothing. Live
 * re-scoring of saved listings is out of scope by decision, and this page has
 * no code path that could do it by accident.
 */

import { useCallback, useEffect, useState } from "react";

import { SavedCard } from "@/components/SavedCard";
import { SignIn } from "@/components/SignIn";
import { fetchMe, fetchSaved, NotAuthenticatedError, signOut, unsave } from "@/lib/api";
import type { SavedEvaluation, User } from "@/lib/types";

type Phase = "loading" | "signed-out" | "ready";

export default function SavedPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [items, setItems] = useState<SavedEvaluation[]>([]);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<number | null>(null);

  // The emailed link lands here as ?email=&code=. Read once, then stripped
  // from the address bar below so a single-use code is not left sitting in
  // history, or re-sent by a refresh.
  const [linkParams, setLinkParams] = useState<{ email: string | null; code: string | null }>({
    email: null,
    code: null,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const email = params.get("email");
    const code = params.get("code");
    if (email || code) {
      setLinkParams({ email, code });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const me = await fetchMe();
      setUser(me);
      setItems(await fetchSaved());
      setPhase("ready");
    } catch (caught) {
      if (caught instanceof NotAuthenticatedError) {
        setPhase("signed-out");
        return;
      }
      setError(caught instanceof Error ? caught.message : "Could not load your saved list.");
      setPhase("ready");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSignedIn = useCallback(
    (signedIn: User) => {
      setUser(signedIn);
      setPhase("loading");
      void load();
    },
    [load],
  );

  const onSignOut = async () => {
    await signOut().catch(() => undefined);
    setUser(null);
    setItems([]);
    setPhase("signed-out");
  };

  const onUnsave = async (item: SavedEvaluation) => {
    setRemoving(item.id);
    setError("");
    // Removed from the list only after the server confirms. An optimistic
    // removal that fails leaves the user believing something is gone when it
    // is not, and the next reload contradicts them.
    try {
      await unsave(item.capture_id);
      setItems((current) => current.filter((row) => row.id !== item.id));
    } catch (caught) {
      if (caught instanceof NotAuthenticatedError) {
        setPhase("signed-out");
        return;
      }
      setError(caught instanceof Error ? caught.message : "Could not remove that.");
    } finally {
      setRemoving(null);
    }
  };

  return (
    <main className="shell">
      <div className="topbar">
        <div className="brand">
          Curbside<span>.</span>
        </div>
        {phase === "ready" && user && (
          <div className="account">
            <span>{user.email}</span>
            <button type="button" className="linkish" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        )}
      </div>

      {phase === "loading" && (
        <div className="state">
          <p>Loading…</p>
        </div>
      )}

      {phase === "signed-out" && (
        <SignIn
          initialEmail={linkParams.email}
          initialCode={linkParams.code}
          onSignedIn={onSignedIn}
        />
      )}

      {phase === "ready" && (
        <>
          <h1 className="page-title">Saved evaluations</h1>
          <p className="page-sub">
            Each card is what Curbside said on the date it was checked — a snapshot, not a live
            quote. To get current figures, open the listing and run the extension again.
          </p>

          {error && <div className="error-banner">{error}</div>}

          {items.length === 0 ? (
            <div className="state">
              <h2>Nothing saved yet</h2>
              <p>
                Open a Facebook Marketplace vehicle listing, run Curbside, and press the star in
                the panel. Saved evaluations show up here.
              </p>
            </div>
          ) : (
            <ul className="cards">
              {items.map((item) => (
                <SavedCard
                  key={item.id}
                  item={item}
                  busy={removing === item.id}
                  onUnsave={onUnsave}
                />
              ))}
            </ul>
          )}

          {/* Spec 7's liability framing and spec 9's beta caveat. Once, at the
              foot of the list, rather than repeated on every card. */}
          <div className="notices">
            <p>
              <strong>Beta signal, not a rating.</strong> The weights and the discount curve are
              starting hypotheses that have not been checked against hand-evaluated listings yet.
              This is an informational analysis of a listing, not a purchase recommendation, and
              never a substitute for a pre-purchase inspection or a vehicle history report.
            </p>
            <p>
              Marketplace shows asking prices, not sale prices. Every figure here describes how
              similar vehicles were <em>advertised</em>, not what they sold for.
            </p>
          </div>
        </>
      )}
    </main>
  );
}
