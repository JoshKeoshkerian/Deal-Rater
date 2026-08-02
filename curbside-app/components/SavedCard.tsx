"use client";

/**
 * One saved evaluation.
 *
 * A SUMMARY, not the overlay. The panel in the extension is a dense, four-
 * dimension breakdown built for the moment of decision, with the listing open
 * in the next tab. This is a list of things checked weeks ago, and its job is
 * to let someone find the one they meant. The link back to the listing is the
 * path to the detail.
 *
 * TWO THINGS THIS IS NOT ALLOWED TO DROP, both carried over from the overlay:
 *
 *   1. THE BETA LABEL. Spec 9: "Until step 1 is done, present output as a beta
 *      signal, not an authoritative rating." `deal_score.beta` is always true.
 *   2. THE LIABILITY FRAMING. Spec 7: "in the UI, not just the terms." It sits
 *      once at the foot of the list rather than on every card — see page.tsx.
 *
 * And one this page adds, because it is the whole premise of a saved list:
 * WHEN IT WAS CHECKED. Every figure here is what the tool said on that date.
 * Spec 4.5 already insists these are asking prices rather than sale prices; a
 * number that is also three weeks old earns the same care.
 */

import { checkedOn, formatScore, miles, money, scoreGrade } from "@/lib/format";
import type { SavedEvaluation } from "@/lib/types";

export function SavedCard({
  item,
  onUnsave,
  busy,
}: {
  item: SavedEvaluation;
  onUnsave: (item: SavedEvaluation) => void;
  busy: boolean;
}) {
  const { evaluation } = item;
  const score = evaluation.deal_score.score;
  const pricing = evaluation.pricing;
  const details = evaluation.vehicle_details;

  const facts = [
    miles(details.mileage),
    details.title_status ? `${details.title_status} title` : null,
    evaluation.negotiation.days_listed !== null
      ? `listed ${evaluation.negotiation.days_listed} days when checked`
      : null,
  ].filter(Boolean);

  const hasRange =
    pricing.asking_interval_low_cents !== null && pricing.asking_interval_high_cents !== null;

  return (
    <li className="card">
      <div className="card-top">
        <div>
          <div className="card-vehicle">{item.vehicle ?? evaluation.vehicle}</div>
        </div>
        <div className="score" data-grade={score === null ? "none" : scoreGrade(score)}>
          {score === null ? (
            <b>Not scored</b>
          ) : (
            <>
              <b>{formatScore(score)}</b>
              <i>/100</i>
            </>
          )}
          {evaluation.deal_score.beta && (
            <span className="beta" title="Uncalibrated: the weights have not been checked against hand-evaluated listings.">
              BETA
            </span>
          )}
        </div>
      </div>

      {facts.length > 0 && <p className="card-facts">{facts.join(" · ")}</p>}

      <p className="card-headline">{evaluation.headline}</p>

      <div className="prices">
        <div>
          <span className="price-label">Asking</span>
          <span className="price-value">{money(pricing.ask_cents)}</span>
        </div>
        <div>
          <span className="price-label">Expected range</span>
          <span className="price-value expected">
            {hasRange
              ? `${money(pricing.asking_interval_low_cents)} – ${money(
                  pricing.asking_interval_high_cents,
                )}`
              : "Not enough comps"}
          </span>
        </div>
      </div>

      {item.snapshot_only && (
        <p className="stale">
          The underlying capture has passed this product&rsquo;s data-retention window, so this
          card can no longer be re-checked from stored data. The figures below it are unchanged.
          Re-evaluating means opening the listing and running the extension again.
        </p>
      )}

      <div className="card-foot">
        <span className="checked">Checked {checkedOn(item.evaluated_at)}</span>
        <span className="card-actions">
          {item.listing_url && (
            <a href={item.listing_url} target="_blank" rel="noopener noreferrer">
              Open listing
            </a>
          )}
          <button
            type="button"
            className="linkish"
            disabled={busy}
            onClick={() => onUnsave(item)}
          >
            {busy ? "Removing…" : "Remove"}
          </button>
        </span>
      </div>
    </li>
  );
}
