/**
 * Development-only fixture capture.
 *
 * The step-2 success criterion is reliable extraction across 30+ varied
 * listings. Verifying that by hand once is a demo; verifying it on every change
 * needs the pages saved. This writes the current page to a file so it can
 * become a regression fixture.
 *
 * A saved page contains whatever the real page contained, including seller
 * names and photographs. Run `npm run scrub-fixture` on it before it goes
 * anywhere near the repository — `tests/fixtures/raw/` is gitignored precisely
 * so an unscrubbed snapshot cannot be committed by accident.
 *
 * Uses a blob URL and a synthetic click rather than `chrome.downloads`, so the
 * extension does not have to request a permission for a developer tool.
 */

export function downloadPageSnapshot(): void {
  const html = document.documentElement.outerHTML;
  const listingId = location.pathname.match(/\/marketplace\/item\/(\d+)/)?.[1] ?? "page";
  const kind = location.pathname.includes("/search") ? "search" : "item";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `fb-${kind}-${listingId}-${stamp}.html`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Revoking immediately can cancel the download in some builds.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
