#!/usr/bin/env node
/**
 * Render the evaluation panel in each of its states, on one page.
 *
 *   node scripts/panel-preview.mjs [outfile.html]
 *
 * It bundles `content/overlay/index.ts` and calls the real `renderEvaluation`,
 * then lifts the markup out of the shadow root. Nothing here reimplements the
 * panel, so the page cannot drift from the code -- which is the whole reason to
 * have it. Fixtures live in `lib/preview-fixtures.mjs`.
 *
 * The panel is `position: fixed` and full height in the product. This page
 * neutralises exactly that: the backdrop becomes static and the sheet sizes to
 * its content, so several states can sit side by side. Nothing else is
 * overridden.
 */

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Window } from "happy-dom";

import { loadTs } from "./lib/load-ts.mjs";
import { CONFIDENT, FLAT, SCAM, UNRELIABLE } from "./lib/preview-fixtures.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Undoes the panel's fixed positioning so it can be embedded in a page. */
const EMBED = `
  .panel { position: relative; background: #10181f; border: 1px solid #24333f;
           border-radius: 10px; overflow: hidden;
           box-shadow: 0 1px 2px rgba(6,12,18,.16), 0 12px 28px -18px rgba(6,12,18,.5); }
  .panel .backdrop { position: static; inset: auto; background: none; display: block; z-index: auto; }
  .panel .sheet { width: auto; height: auto; max-height: none; overflow: visible; box-shadow: none; }
  .panel header { position: static; }
  .panel .close { display: none; }
`;

async function main() {
  const outfile = process.argv[2] ?? resolve(root, "panel-preview.html");

  const window = new Window({ url: "https://example.com/" });
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;

  const { renderEvaluation } = await loadTs(resolve(root, "src/content/overlay/index.ts"));
  const { buildHeader } = await loadTs(resolve(root, "src/content/overlay/headline.ts"));
  const { stylesheet } = await loadTs(resolve(root, "src/content/overlay/styles.ts"));

  /** Render one evaluation and return the panel markup, minus its <style>. */
  function panel(data) {
    renderEvaluation(data);
    const host = document.getElementById("deal-rater-overlay");
    const markup = host.shadowRoot.querySelector(".backdrop").outerHTML;
    host.remove();
    return `<div class="panel">${markup}</div>`;
  }

  const header = (data) =>
    `<div class="panel">${buildHeader(data, () => {}).outerHTML}` +
    `<div class="rest">the rest of the panel</div></div>`;

  const css =
    stylesheet()
      // No shadow root on this page, so the host-scoped custom properties are
      // hung on the wrapper instead.
      .replace(/:host\s*{\s*all: initial;\s*}/, "")
      .replace(/:host/g, ".panel") + EMBED;

  const page = `<title>Evaluation panel — state review</title>
<style>
  :root {
    --rv-ground: #eceff2; --rv-raised: #f7f9fa; --rv-ink: #141d26;
    --rv-muted: #5a7183; --rv-hairline: #d3dae1; --rv-key: #2f6f9f;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --rv-ground: #0a1016; --rv-raised: #0e161d; --rv-ink: #e8eef4;
      --rv-muted: #7f95a8; --rv-hairline: #1e2b36; --rv-key: #7fb8e8;
    }
  }
  :root[data-theme="light"] {
    --rv-ground: #eceff2; --rv-raised: #f7f9fa; --rv-ink: #141d26;
    --rv-muted: #5a7183; --rv-hairline: #d3dae1; --rv-key: #2f6f9f;
  }
  :root[data-theme="dark"] {
    --rv-ground: #0a1016; --rv-raised: #0e161d; --rv-ink: #e8eef4;
    --rv-muted: #7f95a8; --rv-hairline: #1e2b36; --rv-key: #7fb8e8;
  }

  body {
    margin: 0; padding: clamp(24px, 5vw, 56px) clamp(20px, 5vw, 56px) 72px;
    background: var(--rv-ground); color: var(--rv-ink);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 14px; line-height: 1.55; -webkit-font-smoothing: antialiased;
  }
  .rv-shell { max-width: 1120px; margin: 0 auto; }
  .rv-eyebrow {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px; letter-spacing: .09em; text-transform: uppercase;
    color: var(--rv-muted); margin: 0 0 10px;
  }
  .rv-title {
    font-size: clamp(22px, 3vw, 26px); font-weight: 600; letter-spacing: -.015em;
    margin: 0 0 10px; text-wrap: balance;
  }
  .rv-lede { margin: 0; max-width: 68ch; color: var(--rv-muted); }
  .rv-lede code, .rv-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .92em;
  }
  .rv-lede code { color: var(--rv-ink); }

  .rv-band { margin-top: clamp(34px, 5vw, 56px); }
  .rv-band > h2 {
    font-size: 12px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
    color: var(--rv-muted); margin: 0 0 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .rv-band > p { margin: 0 0 20px; max-width: 68ch; color: var(--rv-muted); font-size: 13px; }
  .rv-band-rule { border: 0; border-top: 1px solid var(--rv-hairline); margin: 0 0 18px; }

  .rv-cols { display: grid; gap: clamp(22px, 3.5vw, 40px); grid-template-columns: 1fr; }
  @media (min-width: 900px) { .rv-cols { grid-template-columns: 1fr 1fr; } }
  .rv-col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .rv-state-name { font-size: 16px; font-weight: 600; margin: 0; letter-spacing: -.01em; }
  .rv-condition {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11.5px; color: var(--rv-muted); margin: -6px 0 0;
    font-variant-numeric: tabular-nums;
  }
  .rv-notes { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 8px; }
  .rv-notes li { display: grid; grid-template-columns: 7em 1fr; gap: 12px; align-items: baseline; }
  .rv-key {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px; color: var(--rv-key);
  }
  .rv-note { font-size: 12.5px; color: var(--rv-muted); }
  .rv-note strong { color: var(--rv-ink); font-weight: 600; }

  .rest {
    padding: 13px 20px 16px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
    color: #46596b; border-top: 1px dashed #24333f;
  }
${css}
</style>
<div class="rv-shell">
  <p class="rv-eyebrow">Deal Rater · evaluation overlay · spec 7</p>
  <h1 class="rv-title">The panel, in every state it can be in</h1>
  <p class="rv-lede">
    Rendered by <code>renderEvaluation</code> itself and lifted out of the shadow root, so what
    is below is the shipped markup. Collapsed rows are collapsed here exactly as they are in the
    product — open one to check that its summary line already told you the finding.
  </p>

  <div class="rv-band">
    <h2>Headline</h2>
    <p>Approved earlier. Repeated here because everything under it was built to sit beneath one
       of these two.</p>
    <hr class="rv-band-rule">
    <div class="rv-cols">
      <div class="rv-col">
        <h3 class="rv-state-name">Confident</h3>
        <p class="rv-condition">31 comps · interval 4% of midpoint</p>
        ${header(CONFIDENT)}
      </div>
      <div class="rv-col">
        <h3 class="rv-state-name">Unreliable</h3>
        <p class="rv-condition">4 comps · interval 51% of midpoint</p>
        ${header(UNRELIABLE)}
      </div>
    </div>
  </div>

  <div class="rv-band">
    <h2>Full panel</h2>
    <p>One screen instead of three. Always visible: the headline, the four pricing numbers, and
       any adverse finding. Everything else is one click away, summarised on its own row.</p>
    <hr class="rv-band-rule">
    <div class="rv-cols">
      <div class="rv-col">
        <h3 class="rv-state-name">Confident</h3>
        <p class="rv-condition">clean title · 3 recall campaigns · strong negotiation</p>
        ${panel(CONFIDENT)}
        <ul class="rv-notes">
          <li><span class="rv-key">recalls</span><span class="rv-note">Promoted out of the bullet list into a bordered callout — <strong>caution, not adverse</strong>: NHTSA publishes campaigns for the model, not whether this car had the work done.</span></li>
          <li><span class="rv-key">4.5</span><span class="rv-note">"Asking prices, not sale prices" now sits inside the pricing block, not in the footer.</span></li>
          <li><span class="rv-key">withheld</span><span class="rv-note">Open <em>Better alternatives</em>: the too-cheap listing is named with its reason instead of counted.</span></li>
        </ul>
      </div>
      <div class="rv-col">
        <h3 class="rv-state-name">Unreliable</h3>
        <p class="rv-condition">4 comps · 2 scam signals · known-issues call not configured</p>
        ${panel(UNRELIABLE)}
        <ul class="rv-notes">
          <li><span class="rv-key">range</span><span class="rv-note">Labelled unreliable <strong>inline, next to the figures</strong>, not in a footnote.</span></li>
          <li><span class="rv-key">6.3</span><span class="rv-note">Two scam signals: listed inside the seller row, no callout. One signal alone would render nothing.</span></li>
          <li><span class="rv-key">6.6</span><span class="rv-note">No "What to check" row at all — the reason is a fact about the server, so the buyer is not told about it.</span></li>
        </ul>
      </div>
    </div>
  </div>

  <div class="rv-band">
    <h2>Edge cases</h2>
    <p>The two states where the panel departs from its own defaults.</p>
    <hr class="rv-band-rule">
    <div class="rv-cols">
      <div class="rv-col">
        <h3 class="rv-state-name">Scam combination</h3>
        <p class="rv-condition">4 signals · score withheld by the backend</p>
        ${panel(SCAM)}
        <ul class="rv-notes">
          <li><span class="rv-key">6.3</span><span class="rv-note">Four signals: a prominent warning at the top of the panel, <strong>not a bar</strong> and not a deduction buried in a composite.</span></li>
          <li><span class="rv-key">6.6</span><span class="rv-note">"What to check" <em>does</em> render here — spec 10's gate returned a verdict about the car, which is a finding.</span></li>
        </ul>
      </div>
      <div class="rv-col">
        <h3 class="rv-state-name">Flat breakdown</h3>
        <p class="rv-condition">sub-scores 62–70 · spread 8 points</p>
        ${panel(FLAT)}
        <ul class="rv-notes">
          <li><span class="rv-key">breakdown</span><span class="rv-note">Open <em>Score breakdown</em>: four near-identical bars would answer "what dragged this down?" with "nothing", expensively. One sentence and the figures do it better.</span></li>
          <li><span class="rv-key">6.5</span><span class="rv-note">Alternatives suppressed — and now only because this listing really is priced better than half its comps.</span></li>
        </ul>
      </div>
    </div>
  </div>
</div>
`;

  await writeFile(outfile, page, "utf8");
  console.log(`wrote ${outfile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
