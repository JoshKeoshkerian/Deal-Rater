"use client";

/**
 * The focus/scroll behaviour every hand-rolled modal on this site needs, in
 * one place instead of copied into each one.
 *
 * WHAT IT DOES: moves focus into the dialog on open (to `initialFocusRef` if
 * given, else the first focusable element), traps Tab/Shift+Tab inside it,
 * closes on Escape, locks background scroll, and restores focus to whatever
 * was focused before the dialog opened.
 *
 * WHAT IT DELIBERATELY DOESN'T DO: touch the dialog's own open/close state or
 * its click handlers — `onClose` is the only thing it calls, and only in
 * response to Escape. Everything else (scrim clicks, button actions) stays
 * exactly as each caller already wired it.
 */

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModalA11y<T extends HTMLElement>({
  open,
  onClose,
  initialFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  /** Focused on open instead of the first focusable element, if given. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const containerRef = useRef<T | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    document.body.classList.add("scroll-locked");

    const focusTarget =
      initialFocusRef?.current ??
      containerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    focusTarget?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = containerRef.current
        ? Array.from(containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        : [];
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (!focusable.includes(active as HTMLElement)) {
        // Focus escaped the container somehow (e.g. autofocus elsewhere) —
        // pull it back in rather than letting Tab continue into the page.
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("scroll-locked");
      previouslyFocused.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return containerRef;
}
