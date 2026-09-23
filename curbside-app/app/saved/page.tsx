"use client";

/**
 * The signed-in user's saved evaluations.
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
 *
 * SIGN-IN STATE NOW COMES FROM `AuthProvider`, not from this page's own
 * `fetchMe`. The header needs the same answer on every route, and two callers
 * asking the server the same question on one page load is one too many.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { SavedCard } from "@/components/SavedCard";
import { SignIn } from "@/components/SignIn";
import { fetchSaved, NotAuthenticatedError, unsave } from "@/lib/api";
import type { SavedEvaluation } from "@/lib/types";

import "./saved.css";

type SortOrder = "recent" | "oldest" | "score_desc" | "score_asc";

const SORT_LABELS: Record<SortOrder, string> = {
  recent: "Most recent",
  oldest: "Oldest first",
  score_desc: "Score: high to low",
  score_asc: "Score: low to high",
};

/**
 * Sorted for display only -- never re-fetched, never re-scored. The server
 * hands back the list newest-saved-first (see `backend/app/api/saved.py`);
 * everything else is a client-side reordering of that same snapshot data.
 *
 * Unscored items (`score === null`, e.g. too few comps) have nothing to rank
 * by, so a score sort sinks them to the bottom regardless of direction rather
 * than arbitrarily treating "not scored" as better or worse than a number.
 */
function sortItems(items: SavedEvaluation[], order: SortOrder): SavedEvaluation[] {
  const sorted = [...items];
  switch (order) {
    case "oldest":
      return sorted.sort(
        (a, b) => new Date(a.evaluated_at).getTime() - new Date(b.evaluated_at).getTime(),
      );
    case "score_desc":
    case "score_asc":
      return sorted.sort((a, b) => {
        const scoreA = a.evaluation.deal_score.score;
        const scoreB = b.evaluation.deal_score.score;
        if (scoreA === null && scoreB === null) return 0;
        if (scoreA === null) return 1;
        if (scoreB === null) return -1;
        return order === "score_desc" ? scoreB - scoreA : scoreA - scoreB;
      });
    case "recent":
    default:
      return sorted.sort(
        (a, b) => new Date(b.evaluated_at).getTime() - new Date(a.evaluated_at).getTime(),
      );
  }
}

type ListState = "idle" | "loading" | "error" | "loaded";

export default function SavedPage() {
  const { status, error: authError, refresh, signOut } = useAuth();
  const [items, setItems] = useState<SavedEvaluation[]>([]);
  // Distinct from "loaded with zero items" on purpose — a fetch failure used
  // to leave `items` at [] and render "Nothing saved yet" over an error
  // banner at the same time, which reads as an empty account rather than a
  // failed load.
  const [listState, setListState] = useState<ListState>("idle");
  const [error, setError] = useState("");
  const [unsaveError, setUnsaveError] = useState("");
  const [removing, setRemoving] = useState<Set<number>>(new Set());
  const [sortOrder, setSortOrder] = useState<SortOrder>("recent");
  // Bumped on every load and on sign-out/unmount, so a response that resolves
  // after the session has moved on (signed out, or signed back in as someone
  // else) is recognised as stale and never applied to state.
  const requestIdRef = useRef(0);

  const sortedItems = useMemo(() => sortItems(items, sortOrder), [items, sortOrder]);

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
    const requestId = ++requestIdRef.current;
    setListState("loading");
    try {
      const result = await fetchSaved();
      if (requestIdRef.current !== requestId) return; // superseded — see requestIdRef above
      setItems(result);
      setError("");
      setListState("loaded");
    } catch (caught) {
      if (requestIdRef.current !== requestId) return;
      if (caught instanceof NotAuthenticatedError) {
        // The cookie died between the header's check and this call. Ending the
        // shared session is what puts the sign-in form back on screen.
        await signOut();
        return;
      }
      setError(caught instanceof Error ? caught.message : "Could not load your saved list.");
      setListState("error");
    }
  }, [signOut]);

  // Fetch only once the session is confirmed. Firing this while auth is still
  // `unknown` would spend a guaranteed 401 on every page load. The cleanup
  // invalidates the request id on every status change (sign-out, or a
  // different account signing in), not only on unmount — this component stays
  // mounted across a sign-out, it just renders a different branch below.
  useEffect(() => {
    if (status !== "signed-in") return;
    void load();
    return () => {
      requestIdRef.current++;
    };
  }, [status, load]);

  const onUnsave = async (item: SavedEvaluation) => {
    setRemoving((current) => new Set(current).add(item.id));
    setUnsaveError("");
    // Removed from the list only after the server confirms. An optimistic
    // removal that fails leaves the user believing something is gone when it
    // is not, and the next reload contradicts them.
    try {
      await unsave(item.capture_id);
      setItems((current) => current.filter((row) => row.id !== item.id));
    } catch (caught) {
      if (caught instanceof NotAuthenticatedError) {
        await signOut();
        return;
      }
      setUnsaveError(caught instanceof Error ? caught.message : "Could not remove that.");
    } finally {
      setRemoving((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
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
          <h1 className="page-h1">Saved evaluations</h1>
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

  if (status !== "signed-in") {
    return (
      <main className="wrap page" id="main">
        <header className="page-head">
          <h1 className="page-h1">Saved evaluations</h1>
          <p className="page-lede">Sign in to see the listings you&rsquo;ve saved.</p>
        </header>
        {/* No `onSignedIn` needed: verifying updates the shared auth state,
            and the effect above loads the list when that flips. */}
        <SignIn
          initialEmail={linkParams.email}
          initialCode={linkParams.code}
          heading="Sign in"
        />
      </main>
    );
  }

  return (
    <main className="wrap page" id="main">
      <header className="page-head">
        <h1 className="page-h1">Saved evaluations</h1>
        <p className="page-lede">
          Each card is what Curbside said on the date it was checked — a snapshot, not a live quote.
          To get current figures, open the listing and run the extension again: the card here
          updates to match, rather than becoming a second copy of the same car.
        </p>
      </header>

      {(listState === "idle" || listState === "loading") && (
        <div className="state">
          <p>Loading your saved list…</p>
        </div>
      )}

      {listState === "error" && (
        <div className="state" role="alert">
          <h2>Couldn&rsquo;t load your saved list</h2>
          <p>{error}</p>
          <button type="button" className="btn btn--ghost" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {listState === "loaded" && items.length === 0 && (
        <div className="state">
          <h2>Nothing saved yet</h2>
          <p>
            Open a Facebook Marketplace vehicle listing, run Curbside, and press the star in the
            panel. Saved evaluations show up here.
          </p>
        </div>
      )}

      {listState === "loaded" && items.length > 0 && (
        <>
          {unsaveError && (
            <div className="error-banner" role="alert">
              {unsaveError}
            </div>
          )}
          <div className="sort-row">
            <label htmlFor="sort-order">Sort</label>
            <select
              id="sort-order"
              className="sort-select"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value as SortOrder)}
            >
              {Object.entries(SORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <ul className="cards">
            {sortedItems.map((item) => (
              <SavedCard
                key={item.id}
                item={item}
                busy={removing.has(item.id)}
                onUnsave={onUnsave}
              />
            ))}
          </ul>
        </>
      )}

      {/* Spec 7's liability framing and spec 9's beta caveat. Once, at the
          foot of the list, rather than repeated on every card. */}
      <div className="notices">
        <p>
          <strong>Beta signal, not a rating.</strong> The weights and the discount curve are
          starting hypotheses that have not been checked against hand-evaluated listings yet. This
          is an informational analysis of a listing, not a purchase recommendation, and never a
          substitute for a pre-purchase inspection or a vehicle history report.
        </p>
        <p>
          Marketplace shows asking prices, not sale prices. Every figure here describes how similar
          vehicles were <em>advertised</em>, not what they sold for.
        </p>
        <p>
          Running low on checks? <Link href="/account">Your account</Link> has what&rsquo;s left.
        </p>
      </div>
    </main>
  );
}
