#!/usr/bin/env node
/**
 * Render the evaluation panel in each of its states, in both themes, on one
 * page.
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
 *
 * THEMES. `stylesheet(".panel")` hangs the token layer on each panel wrapper
 * rather than on a shadow host, so every panel on this page carries its own
 * `data-theme` and light and dark can be compared side by side. The switch at
 * the top drives all of them at once.
 *
 * THE TRIGGER BUTTON IS HERE TOO. It is the first thing a user sees and the
 * only thing on screen while a capture runs, and its states -- five progress
 * steps and an error -- were previously reviewable only by running a capture
 * against a live listing and hoping to catch one.
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
  .panel { position: relative; background: var(--sheet); border: 1px solid var(--border);
           border-radius: 10px; overflow: hidden;
           box-shadow: 0 1px 2px rgba(6,12,18,.16), 0 12px 28px -18px rgba(6,12,18,.5); }
  .panel .backdrop { position: static; inset: auto; background: none; display: block;
                     z-index: auto; opacity: 1; }
  .panel .sheet { width: auto; height: auto; max-height: none; overflow: visible;
                  box-shadow: none; transform: none; }
  .panel header { position: static; }
  .panel .close, .panel .theme-toggle { display: none; }

  /* The trigger button, same treatment: unpinned from the viewport corner and
     widened to its column. Its own root class is .dock, not .panel, precisely
     so this page's wrapper and the button's root cannot collide. */
  .trigger { border: 0; background: none; box-shadow: none; border-radius: 0; }
  .trigger .dock { position: relative; right: auto; bottom: auto; z-index: auto;
                   align-items: stretch; }
  .trigger .card { width: auto; }
`;

async function main() {
  const outfile = process.argv[2] ?? resolve(root, "panel-preview.html");

  const window = new Window({ url: "https://example.com/" });
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  // The panel and the trigger both feature-detect these. happy-dom has no
  // frames and no media queries, so their absence is the honest answer: every
  // JS-driven animation short-circuits to its final value, which is the state
  // this page wants to show anyway.
  globalThis.requestAnimationFrame = undefined;
  globalThis.matchMedia = undefined;
  // The theme control reads settings. It renders at its default and corrects
  // itself when storage answers; here it just never gets an answer.
  globalThis.chrome = {
    storage: { sync: { get: async (defaults) => defaults, set: async () => {} } },
  };

  const { renderEvaluation } = await loadTs(resolve(root, "src/content/overlay/index.ts"));
  const { buildHeader } = await loadTs(resolve(root, "src/content/overlay/headline.ts"));
  const { stylesheet } = await loadTs(resolve(root, "src/content/overlay/styles.ts"));
  const { mountTriggerButton, triggerStylesheet } = await loadTs(
    resolve(root, "src/content/trigger-button.ts"),
  );

  /**
   * Pin every fill to its target width.
   *
   * `animateFills` needs two real animation frames, which this page does not
   * have. Rather than fake them, the markup already carries the target in
   * `data-fill`, so it is copied into an inline width and the bars are shown at
   * the value they animate to in the product.
   */
  const pinFills = (markup) =>
    markup.replace(/data-fill="([^"]+)"/g, (whole, value) => `${whole} style="width:${value}"`);

  /** Render one evaluation and return the panel markup, minus its <style>. */
  function panel(data, theme) {
    renderEvaluation(data);
    const host = document.getElementById("deal-rater-overlay");
    const markup = host.shadowRoot.querySelector(".backdrop").outerHTML;
    host.remove();
    return `<div class="panel" data-theme="${theme}">${pinFills(markup)}</div>`;
  }

  const header = (data, theme) =>
    `<div class="panel" data-theme="${theme}">${pinFills(buildHeader(data, () => {}).outerHTML)}` +
    `<div class="rest">the rest of the panel</div></div>`;

  /** Drive the trigger button into one state and lift its markup. */
  function trigger(theme, drive) {
    document.getElementById("deal-rater-trigger")?.remove();
    const control = mountTriggerButton(() => {});
    drive(control);
    const host = document.getElementById("deal-rater-trigger");
    const markup = host.shadowRoot.querySelector(".dock").outerHTML;
    control.remove();
    return `<div class="panel trigger" data-theme="${theme}">${markup}</div>`;
  }

  const themes = ["light", "dark"];
  const both = (build) => themes.map((theme) => build(theme)).join("");

  // The rules are emitted once, hung on the panel wrapper so each panel carries
  // its own theme. A second copy of just the variable layer goes on :root, so
  // the page's own chrome has values for anything the panel's bare element
  // selectors (h2, ul, a) reach outside a panel.
  // Two stylesheets, because there are two shadow roots in the product. Each
  // is scoped to its own wrapper class here so both can carry a data-theme.
  const css =
    stylesheet(".panel").replace(/:host\s*{\s*all: initial;\s*}/, "") +
    triggerStylesheet(".trigger") +
    EMBED;

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
  :root[data-page="light"] {
    --rv-ground: #eceff2; --rv-raised: #f7f9fa; --rv-ink: #141d26;
    --rv-muted: #5a7183; --rv-hairline: #d3dae1; --rv-key: #2f6f9f;
  }
  :root[data-page="dark"] {
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

  .rv-controls { display: flex; gap: 8px; margin-top: 18px; flex-wrap: wrap; }
  .rv-controls button {
    font: 600 12px/1 system-ui, sans-serif; letter-spacing: .04em; text-transform: uppercase;
    padding: 9px 15px; border-radius: 999px; cursor: pointer;
    border: 1px solid var(--rv-hairline); background: var(--rv-raised); color: var(--rv-muted);
  }
  .rv-controls button[aria-pressed="true"] { color: var(--rv-ink); border-color: var(--rv-key); }

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
    color: var(--text-faint); border-top: 1px dashed var(--border);
  }
${css}
</style>
<div class="rv-shell">
  <p class="rv-eyebrow">Deal Rater · evaluation overlay · spec 7</p>
  <h1 class="rv-title">The panel, in every state it can be in</h1>
  <p class="rv-lede">
    Rendered by <code>renderEvaluation</code> itself and lifted out of the shadow root, so what
    is below is the shipped markup. Collapsed rows are collapsed here exactly as they are in the
    product — open one to check that its summary line already told you the finding. Every panel
    is shown light above dark; the buttons force all of them one way.
  </p>
  <div class="rv-controls">
    <button type="button" data-theme-all="pair" aria-pressed="true">Both</button>
    <button type="button" data-theme-all="light" aria-pressed="false">Force light</button>
    <button type="button" data-theme-all="dark" aria-pressed="false">Force dark</button>
  </div>

  <div class="rv-band">
    <h2>Headline</h2>
    <p>The score, its dial, and the grade tint on the header. The dial is a redundant reading of
       the digits on purpose — the grade should be legible before the number is.</p>
    <hr class="rv-band-rule">
    <div class="rv-cols">
      <div class="rv-col">
        <h3 class="rv-state-name">Confident</h3>
        <p class="rv-condition">31 comps · interval 4% of midpoint</p>
        ${both((t) => header(CONFIDENT, t))}
      </div>
      <div class="rv-col">
        <h3 class="rv-state-name">Unreliable</h3>
        <p class="rv-condition">4 comps · interval 51% of midpoint</p>
        ${both((t) => header(UNRELIABLE, t))}
      </div>
    </div>
  </div>

  <div class="rv-band">
    <h2>Full panel</h2>
    <p>One screen instead of three. Always visible: the headline and the score breakdown.
       Everything else is one click away, summarised on its own row. Open <em>price residual</em>
       for the gauge, and <em>vehicle risk</em> for recalls and complaints.</p>
    <hr class="rv-band-rule">
    <div class="rv-cols">
      <div class="rv-col">
        <h3 class="rv-state-name">Confident</h3>
        <p class="rv-condition">clean title · 3 recall campaigns · strong negotiation</p>
        ${both((t) => panel(CONFIDENT, t))}
      </div>
      <div class="rv-col">
        <h3 class="rv-state-name">Unreliable</h3>
        <p class="rv-condition">4 comps · 2 scam signals · known-issues call not configured</p>
        ${both((t) => panel(UNRELIABLE, t))}
      </div>
    </div>
    <ul class="rv-notes">
      <li><span class="rv-key">5.1</span><span class="rv-note">The price gauge carries <strong>strong offer and walk-away</strong>, which the backend serialized and the panel displayed nowhere.</span></li>
      <li><span class="rv-key">6.2</span><span class="rv-note">Recalls are a stat tile, and <strong>Complaints is a new subsection</strong> — <code>complaint_count</code> and its top components were also never rendered.</span></li>
      <li><span class="rv-key">6.5</span><span class="rv-note">Alternatives are cards built from the structured fields with a price-delta chip, not the backend's pre-formatted line.</span></li>
      <li><span class="rv-key">6.4</span><span class="rv-note">Negotiation gains a <strong>strength meter</strong> and a copyable offer. <code>strength</code> was serialized and unused.</span></li>
    </ul>
  </div>

  <div class="rv-band">
    <h2>Edge cases</h2>
    <p>The two states where the panel departs from its own defaults.</p>
    <hr class="rv-band-rule">
    <div class="rv-cols">
      <div class="rv-col">
        <h3 class="rv-state-name">Scam combination</h3>
        <p class="rv-condition">4 signals · score withheld by the backend</p>
        ${both((t) => panel(SCAM, t))}
      </div>
      <div class="rv-col">
        <h3 class="rv-state-name">Flat breakdown</h3>
        <p class="rv-condition">sub-scores 62–70 · spread 8 points</p>
        ${both((t) => panel(FLAT, t))}
      </div>
    </div>
  </div>

  <div class="rv-band">
    <h2>Trigger button</h2>
    <p>The first thing a user sees, and the only thing on screen while a capture runs. The rail
       marks every earlier step done when a later one arrives, because two of the five steps are
       conditional and a rail that leaves a skipped step pending implies the run went backwards.</p>
    <hr class="rv-band-rule">
    <div class="rv-cols">
      <div class="rv-col">
        <h3 class="rv-state-name">Idle</h3>
        <p class="rv-condition">nothing has been clicked</p>
        ${both((t) => trigger(t, () => {}))}
      </div>
      <div class="rv-col">
        <h3 class="rv-state-name">Reading the listing</h3>
        <p class="rv-condition">step 1 of 5</p>
        ${both((t) =>
          trigger(t, (c) => {
            c.setBusy(true);
            c.setProgress("Reading listing…", "reading");
          }),
        )}
      </div>
      <div class="rv-col">
        <h3 class="rv-state-name">Widening to nearby markets</h3>
        <p class="rv-condition">step 3 of 5 · the slow one</p>
        ${both((t) =>
          trigger(t, (c) => {
            c.setBusy(true);
            c.setProgress("Searching nearby markets…", "widening");
          }),
        )}
      </div>
      <div class="rv-col">
        <h3 class="rv-state-name">Failed</h3>
        <p class="rv-condition">capture saved, evaluation did not load</p>
        ${both((t) =>
          trigger(t, (c) =>
            c.setStatus(
              "Captured with 22 comparable listings. Could not load the evaluation (network error). " +
                "Reopen this listing and click again to retry.",
              "error",
            ),
          ),
        )}
      </div>
    </div>
    <ul class="rv-notes">
      <li><span class="rv-key">retry</span><span class="rv-note">The error state ends in a <strong>button</strong>. The old one left a red bubble on screen and no way forward.</span></li>
      <li><span class="rv-key">tokens</span><span class="rv-note">Both shadow roots emit <code>themeVariables()</code>; the trigger used to carry its own hexes and its own font stack.</span></li>
    </ul>
  </div>
</div>
<script>
  const buttons = [...document.querySelectorAll("[data-theme-all]")];
  const panels = [...document.querySelectorAll(".panel[data-theme]")];
  const original = panels.map((p) => p.dataset.theme);
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const mode = button.dataset.themeAll;
      panels.forEach((p, i) => { p.dataset.theme = mode === "pair" ? original[i] : mode; });
      // The page chrome follows, so a panel is judged against a surface of the
      // same polarity rather than always against light.
      if (mode === "pair") delete document.documentElement.dataset.page;
      else document.documentElement.dataset.page = mode;
      for (const other of buttons) other.setAttribute("aria-pressed", String(other === button));
    });
  }
</script>
`;

  await writeFile(outfile, page, "utf8");
  console.log(`wrote ${outfile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
