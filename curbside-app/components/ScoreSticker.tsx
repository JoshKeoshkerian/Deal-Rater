"use client";

/**
 * The one signature visual on the site: a windshield price sticker rendered in
 * the site's own palette rather than literal paper, carrying the four scored
 * dimensions as itemized line items instead of a generic bar chart.
 *
 * Used twice with the same worked example (2017 Corolla SE, see `page.tsx`):
 * static in the hero, and here with `animate` set in the score-breakdown
 * section, which is deliberately the only thing on the page that moves on
 * scroll. `animate={false}` renders fully "armed" from the first paint —
 * there is no unarmed state to flash before hydration.
 */

import { useEffect, useRef, useState } from "react";

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
  animate = false,
}: {
  car: string;
  ask: string;
  total: number;
  weightedNote: string;
  verdict: string;
  rows: StickerRow[];
  animate?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [armed, setArmed] = useState(!animate);

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
    <div className={`sticker${armed ? " sticker--armed" : ""}`} ref={ref}>
      <span className="sticker__tape sticker__tape--l" aria-hidden="true" />
      <span className="sticker__tape sticker__tape--r" aria-hidden="true" />
      <p className="sticker__cap">
        {car} &middot; asking {ask}
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
      <p className="sticker__foot">{weightedNote}</p>
      <span className="sticker__barcode" aria-hidden="true" />
    </div>
  );
}
