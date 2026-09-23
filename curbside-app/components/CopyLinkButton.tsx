"use client";

/**
 * "Copy link" next to the install CTA, for a visitor on a phone.
 *
 * Curbside only runs in desktop Chrome, and there is no way to prove that from
 * viewport width alone — plenty of desktop windows are narrow, and a phone in
 * landscape can be wider than a small laptop. So this doesn't try to detect
 * anything; it's shown to everyone, and gives a phone visitor one real thing to
 * do (get the link onto a computer) instead of a fake "email me a link" form or
 * an implication the extension runs in the Facebook app.
 */

import { useState } from "react";

export function CopyLinkButton() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      className="linkish copy-link"
      onClick={() => void copy()}
      aria-live="polite"
    >
      {copied ? "Link copied" : "Copy link"}
    </button>
  );
}
