"use client";

/**
 * The "Three Corollas" showcase: three real (scaled-down, cropped) panel
 * screenshots.
 *
 * TWO PROBLEMS THIS SOLVES THAT A PLAIN IMAGE GRID DOESN'T:
 *
 *   1. There was no way to see a screenshot at a readable size — every image
 *      is a desktop panel shrunk to fit a card. Each one is now a button that
 *      opens it full-size in a dialog, alongside the same summary text that's
 *      already in the caption (no new data, just a bigger view of it).
 *   2. On narrow screens, three tall screenshots used to sit one after another
 *      between the hero and the rest of the page. A small selector row lets a
 *      phone visitor pick one screenshot to look at instead of scrolling past
 *      all three — desktop keeps the original three-column grid regardless of
 *      which one is "selected" here.
 */

import { useCallback, useState } from "react";

import { scoreGrade } from "@/lib/format";
import { useModalA11y } from "@/components/useModalA11y";

export interface Shot {
  src: string;
  alt: string;
  score: number;
  verdict: string;
  note: string;
}

export function ShowcaseShots({ shots }: { shots: Shot[] }) {
  const [active, setActive] = useState(0);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const close = useCallback(() => setOpenIndex(null), []);
  const openShot = openIndex === null ? null : shots[openIndex];

  return (
    <>
      {/* Narrow-viewport-only selector; hidden by CSS at desktop widths, where
          all three shots already show at once in the grid below. */}
      <div className="shot-tabs" role="group" aria-label="Choose which example to view">
        {shots.map((shot, index) => {
          const grade = scoreGrade(shot.score);
          return (
            <button
              key={shot.src}
              type="button"
              className="shot-tab"
              data-grade={grade}
              aria-pressed={active === index}
              onClick={() => setActive(index)}
            >
              <span className="shot-tab__num">{shot.score}</span>
              {shot.verdict}
            </button>
          );
        })}
      </div>

      <div className="shots" data-active={active}>
        {shots.map((shot, index) => {
          const grade = scoreGrade(shot.score);
          return (
            <figure className="shot" key={shot.src}>
              <button
                type="button"
                className="shot__frame shot__frame--btn"
                onClick={() => setOpenIndex(index)}
                aria-label={`View full-size: ${shot.alt}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shot.src} alt={shot.alt} width={660} height={1180} loading="lazy" />
                <span className="shot__expand">View full size</span>
              </button>
              <figcaption>
                <p className="shot__verdict">
                  <span className="shot__num" data-grade={grade}>
                    {shot.score}
                  </span>{" "}
                  {shot.verdict}
                </p>
                <p>{shot.note}</p>
              </figcaption>
            </figure>
          );
        })}
      </div>

      {openShot && <ShotLightbox shot={openShot} onClose={close} />}
    </>
  );
}

function ShotLightbox({ shot, onClose }: { shot: Shot; onClose: () => void }) {
  const grade = scoreGrade(shot.score);
  const containerRef = useModalA11y<HTMLDivElement>({ open: true, onClose });

  return (
    <div className="modal-scrim shot-lightbox-scrim" onClick={onClose} role="presentation">
      <div
        className="shot-lightbox"
        role="dialog"
        aria-modal="true"
        aria-label={shot.alt}
        ref={containerRef}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="shot-lightbox__close" onClick={onClose}>
          Close
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={shot.src} alt={shot.alt} width={660} height={1180} />
        <div className="shot-lightbox__caption">
          <p className="shot__verdict">
            <span className="shot__num" data-grade={grade}>
              {shot.score}
            </span>{" "}
            {shot.verdict}
          </p>
          <p>{shot.note}</p>
        </div>
      </div>
    </div>
  );
}
