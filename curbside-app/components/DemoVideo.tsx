"use client";

/**
 * The YouTube demo, embedded without paying for it up front.
 *
 * A YouTube iframe costs ~1MB of script and sets cookies the moment it
 * renders, whether or not anyone presses play -- a real hit to a landing page
 * that paid traffic lands on. So this renders a self-hosted poster image
 * (`public/video/demo-poster.webp`, the video's own thumbnail) with a play
 * button, and swaps in the iframe only on click, autoplaying. The iframe uses
 * youtube-nocookie.com, so nothing is set until playback starts.
 *
 * Two entry points, one player:
 *   - `DemoVideo`: inline, in the landing page's "See it in action" section.
 *   - `DemoVideoButton`: the hero's secondary CTA; opens the same player in a
 *     dialog, already playing.
 *
 * Each play is a Vercel Analytics `demo_play` event with a `location`, next to
 * `install_click`, so watching can be compared with installing.
 */

import { track } from "@vercel/analytics";
import { useCallback, useState } from "react";

import { useModalA11y } from "@/components/useModalA11y";
import { DEMO_VIDEO_ID } from "@/lib/links";

const TITLE = "Curbside: How it works";

function recordPlay(location: string) {
  try {
    track("demo_play", { location });
  } catch {
    // Analytics must never block playback.
  }
}

function PlayGlyph({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor" />
    </svg>
  );
}

function Player({ autoplay }: { autoplay: boolean }) {
  const params = new URLSearchParams({
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
    ...(autoplay ? { autoplay: "1" } : {}),
  });
  return (
    <iframe
      className="demo__iframe"
      src={`https://www.youtube-nocookie.com/embed/${DEMO_VIDEO_ID}?${params.toString()}`}
      title={TITLE}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      referrerPolicy="strict-origin-when-cross-origin"
      allowFullScreen
    />
  );
}

export function DemoVideo({ location = "demo-section" }: { location?: string }) {
  const [playing, setPlaying] = useState(false);

  return (
    <div className="demo__frame">
      {playing ? (
        <Player autoplay />
      ) : (
        <button
          type="button"
          className="demo__poster"
          onClick={() => {
            recordPlay(location);
            setPlaying(true);
          }}
          aria-label={`Play video: ${TITLE}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/video/demo-poster.webp" alt="" width={1280} height={720} loading="lazy" />
          <span className="demo__play">
            <PlayGlyph size={30} />
          </span>
        </button>
      )}
    </div>
  );
}

function DemoDialog({ onClose }: { onClose: () => void }) {
  const containerRef = useModalA11y<HTMLDivElement>({ open: true, onClose });

  return (
    <div className="modal-scrim demo-scrim" onClick={onClose} role="presentation">
      <div
        className="demo-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={TITLE}
        ref={containerRef}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="demo-dialog__close" onClick={onClose}>
          Close
        </button>
        <div className="demo__frame demo__frame--dialog">
          <Player autoplay />
        </div>
      </div>
    </div>
  );
}

export function DemoVideoButton({
  className = "btn btn--ghost btn--big",
  location = "hero",
  children = "Watch the demo",
}: {
  className?: string;
  location?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          recordPlay(location);
          setOpen(true);
        }}
      >
        <span className="demo-btn__icon" aria-hidden="true">
          <PlayGlyph size={14} />
        </span>
        {children}
      </button>
      {open && <DemoDialog onClose={close} />}
    </>
  );
}
