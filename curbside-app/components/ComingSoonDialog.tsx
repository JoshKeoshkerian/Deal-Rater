"use client";

/**
 * The dialog every payments control opens, because none of them are wired to a
 * processor yet.
 *
 * It leads with the fact that nothing happened. A mocked-up checkout that stays
 * silent is indistinguishable from a broken one, and the person most likely to
 * be misled by it is whoever ships this next.
 *
 * Escape closes it, the scrim closes it, and focus moves to the dismiss button
 * on open — the parts of a hand-rolled modal that are usually missing.
 */

import { useCallback, useEffect, useRef } from "react";

export function ComingSoonDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <div className="modal-scrim" onClick={close} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="coming-soon-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="coming-soon-title">{title}</h2>
        {children}
        <button type="button" className="btn" ref={closeRef} onClick={close}>
          Got it
        </button>
      </div>
    </div>
  );
}
