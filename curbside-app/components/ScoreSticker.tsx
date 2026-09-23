"use client";

/**
 * The one signature visual on the site: a windshield price sticker rendered in
 * the site's own palette rather than literal paper, carrying the four scored
 * dimensions as itemized line items instead of a generic bar chart.
 *
 * Renders once today, static in the hero (2017 Corolla SE, see `page.tsx`).
 * `animate={false}` (the default) renders fully "armed" from the first paint —
 * there is no unarmed state to flash before hydration. The `animate` mode
 * below is unused now that the second, scroll-triggered copy of this card in
 * the "score" section has been removed as a duplicate; it's left in place in
 * case a reveal-on-scroll moment is wanted elsewhere later.
 *
 * THE NUMBER'S COLOUR COMES FROM `scoreGrade` (`lib/format.ts`), the same
 * five-band mapping the saved-evaluation cards use. It used to be hardcoded to
 * lime regardless of score, which meant a 63 ("fair, not great") rendered in
 * the same bright green a 90+ would — this ties every score on the site to one
 * shared read.
 */

import { useEffect, useRef, useState } from "react";

import { scoreGrade } from "@/lib/format";

export interface StickerRow {
  label: string;
  value: number;
}

export function ScoreSticker({
  car,
  ask,
  total,
  weightedNote,
  verdict,
  rows,
  keyWarning,
  nextQuestion,
  animate = false,
}: {
  car: string;
  ask: string;
  total: number;
  weightedNote: string;
  verdict: string;
  rows: StickerRow[];
  /** The lowest-scoring row, named plainly — the "so what" a bare number chart doesn't give. */
  keyWarning?: string;
  /** One concrete thing to ask the seller, grounded in the reading above. */
  nextQuestion?: string;
  animate?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [armed, setArmed] = useState(!animate);
  const grade = scoreGrade(total);

  useEffect(() => {
    if (!animate) return;
    const node = ref.current;
    if (!node) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !("IntersectionObserver" in window)) {
      setArmed(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setArmed(true);
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [animate]);

  return (
    <div
      className={`sticker${armed ? " sticker--armed" : ""}`}
      data-grade={grade}
      ref={ref}
    >
      <span className="sticker__tape sticker__tape--l" aria-hidden="true" />
      <span className="sticker__tape sticker__tape--r" aria-hidden="true" />
      <p className="sticker__cap">
        {car} &middot; asking {ask}
        <span className="sticker__beta">BETA</span>
      </p>
      <p className="sticker__total">
        <span className="sticker__num">{total}</span>
        <span className="sticker__of">/100</span>
      </p>
      <p className="sticker__verdict">{verdict}</p>
      <ul className="sticker__rows">
        {rows.map((row) => (
          <li key={row.label} style={{ "--w": `${row.value}%` } as React.CSSProperties}>
            <span className="sticker__row-label">{row.label}</span>
            <span className="sticker__row-track">
              <span className="sticker__row-fill" />
            </span>
            <span className="sticker__row-value">{row.value}</span>
          </li>
        ))}
      </ul>
      <p className="sticker__legend">Higher is better on every reading.</p>
      {keyWarning && <p className="sticker__note">{keyWarning}</p>}
      {nextQuestion && (
        <p className="sticker__note sticker__note--ask">
          <strong>Ask:</strong> {nextQuestion}
        </p>
      )}
      <p className="sticker__foot">{weightedNote}</p>
      <span className="sticker__barcode" aria-hidden="true" />
    </div>
  );
}
