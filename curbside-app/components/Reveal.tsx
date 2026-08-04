"use client";

/**
 * The landing page's scroll-in animation, which was an IntersectionObserver in
 * a `<script>` tag at the bottom of index.html.
 *
 * Two properties of the original are preserved deliberately:
 *
 *   1. IT FAILS VISIBLE. If IntersectionObserver is missing, or the user asked
 *      for reduced motion, everything is shown immediately. A reveal-on-scroll
 *      effect that breaks must leave content on the page, not hide it.
 *   2. IT OBSERVES ONCE. Each element unobserves itself after appearing, so
 *      scrolling back up does not re-run the animation.
 *
 * The landing page stays a server component; only this wrapper is client-side.
 */

import { useEffect, useRef, useState } from "react";

export function Reveal({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "section" | "figure" | "ul" | "p" | "h2";
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !("IntersectionObserver" in window)) {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const Element = Tag as React.ElementType;
  return (
    <Element ref={ref} className={`rv${shown ? " in" : ""}${className ? ` ${className}` : ""}`}>
      {children}
    </Element>
  );
}
