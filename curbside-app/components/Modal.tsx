"use client";

/**
 * The generic dialog shell shared by every hand-rolled modal on this site.
 *
 * Renamed from `ComingSoonDialog` once billing became real: it never carried
 * any "coming soon" logic of its own — that copy always lived in the caller
 * — so the only thing that changes here is the honest name.
 *
 * Escape closes it, the scrim closes it, Tab/Shift+Tab stay trapped inside it,
 * background scroll is locked while it's open, and focus returns to whatever
 * opened it on close — see `useModalA11y`, shared with the screenshot lightbox.
 */

import { useCallback, useId, useRef } from "react";

import { useModalA11y } from "@/components/useModalA11y";

export function Modal({
  title,
  children,
  onClose,
  dismissLabel = "Got it",
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  /**
   * The trailing button's label, or `null` to render no trailing button at
   * all -- for a modal whose content already carries its own primary action
   * (a form's submit button, say), where a second "Got it" button beside it
   * would be redundant. Escape and the scrim still close it either way.
   */
  dismissLabel?: string | null;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const close = useCallback(() => onClose(), [onClose]);
  const containerRef = useModalA11y<HTMLDivElement>({
    open: true,
    onClose: close,
    initialFocusRef: dismissLabel === null ? undefined : closeRef,
  });
  const titleId = useId();

  return (
    <div className="modal-scrim" onClick={close} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={containerRef}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
        {dismissLabel !== null && (
          <button type="button" className="btn" ref={closeRef} onClick={close}>
            {dismissLabel}
          </button>
        )}
      </div>
    </div>
  );
}
