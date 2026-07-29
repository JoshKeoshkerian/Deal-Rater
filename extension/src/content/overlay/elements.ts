/**
 * The panel's vocabulary: the handful of shapes every section is built from.
 *
 * Seven of them, and the constraint each one encodes:
 *
 *   callout()    a finding that must be seen without expanding anything
 *   disclosure() a finding that must be REACHABLE, not necessarily visible
 *   rows()       labelled figures, tabular-aligned
 *   chip()       a judgement, always as colour AND glyph AND words
 *   statTile()   one figure that is the whole answer, at a glance
 *   meterRow()   a magnitude that is easier to compare than to read
 *   copyButton() an output the buyer is going to retype otherwise
 *
 * A section that wants to shout picks `callout`. Everything else picks
 * `disclosure`. That is the whole hierarchy, and keeping it to two levels is
 * what stops the panel drifting back into three screens of flat scroll.
 *
 * NOTHING HERE PICKS A SIZE OR A COLOUR. Sizes come off `--fs-*` / `--sp-*` and
 * colours out of a `Tone`, both from `tokens.ts`. A literal in this file is a
 * value that has escaped the design system.
 */

import { TONE_GLYPH, type Tone } from "./tokens";

export function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "n/a";
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/**
 * Whether motion should be suppressed.
 *
 * The stylesheet already zeroes every CSS transition under the same query; this
 * is for the animations JS drives, which a stylesheet cannot reach.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Mark an element as growing to `fraction` of its track once the panel is on
 * screen, and return it.
 *
 * Bars, meters and the price gauge all render at zero width and are grown by
 * `animateFills` in one pass after mount (see `index.ts`). Centralised because
 * the alternative -- each renderer scheduling its own `requestAnimationFrame`
 * -- produces four independent animations that start at four different times
 * and read as jitter rather than one panel arriving.
 */
export function fillsTo(node: HTMLElement, fraction: number): HTMLElement {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  node.dataset["fill"] = `${clamped * 100}%`;
  return node;
}

/** Grow every marked fill to its target. Called once, after the panel mounts. */
export function animateFills(root: ParentNode): void {
  const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-fill]"));
  const apply = () => {
    for (const node of targets) node.style.width = node.dataset["fill"] ?? "0%";
  };
  if (typeof requestAnimationFrame === "function") {
    // Two frames, not one: the first is the frame the elements are painted in
    // at zero width, and a transition from a width the browser has never laid
    // out does not run at all.
    requestAnimationFrame(() => requestAnimationFrame(apply));
  } else {
    apply();
  }
}

/** A tone chip: colour, glyph and words. Never colour alone. */
export function chip(tone: Tone, label: string): HTMLElement {
  const node = el("span", "chip");
  node.dataset["tone"] = tone;
  node.append(el("span", "chip-glyph", TONE_GLYPH[tone]), el("span", undefined, label));
  return node;
}

/**
 * A bordered finding, always visible.
 *
 * Spec 6.2 requires open recalls "surfaced prominently regardless of score
 * weight", and spec 6.3 requires a scam combination to be "a distinct,
 * prominent warning rather than a numerical deduction buried in a composite".
 * A grey bullet in a list satisfies neither.
 */
export function callout(tone: Tone, title: string, body: (string | Node)[]): HTMLElement {
  const node = el("div", "callout");
  node.dataset["tone"] = tone;

  const heading = el("h3");
  heading.append(el("span", "callout-glyph", TONE_GLYPH[tone]), el("span", undefined, title));
  node.append(heading);

  for (const part of body) {
    node.append(typeof part === "string" ? el("p", undefined, part) : part);
  }
  return node;
}

/**
 * A collapsed section with, optionally, a one-line summary of what is inside
 * it.
 *
 * `<details>` rather than a scripted accordion: it is keyboard-operable and
 * screen-reader-announced without any of that being written here, and the
 * browser's find-in-page can open it. Where there is a summary, it is not a
 * label -- it carries the finding, so a user who never expands the row has
 * still been told. An empty string summary renders no summary at all, for a
 * title that is not worth annotating (Recalls, Red flags).
 *
 * `badge` is an optional mark next to the title -- currently only `aiBadge()`,
 * for sections that lean on the model's read rather than the rules alone.
 */
export function disclosure(
  title: string,
  summary: string | Node,
  body: Node[],
  badge?: Node,
): HTMLElement {
  const node = el("details", "disclosure");
  const line = el("summary");

  const heading = el("span", "disclosure-title", title);
  line.append(heading);
  if (badge) line.append(badge);
  if (summary !== "") {
    line.append(typeof summary === "string" ? el("span", "disclosure-summary", summary) : summary);
  }

  const inner = el("div", "disclosure-body");
  inner.append(...body);
  node.append(line, inner);
  return node;
}

/**
 * A caveat about the DATA, not a judgement about the vehicle -- so it gets
 * neither a `Tone` nor a `TONE_GLYPH` entry, just a soft neutral capsule that
 * reads as "context" rather than a finding sitting in the middle of a list of
 * findings. Used where a number needs an asterisk it can't outrun, e.g. NHTSA
 * complaint counts that are not adjusted for how many of the model sold.
 */
export function notePill(text: string, source?: string): HTMLElement {
  const node = el("div", "note-pill");
  const body = el("div", "note-pill-body");
  body.append(el("span", undefined, text));
  if (source) body.append(el("span", "note-pill-source", source));
  node.append(el("span", "note-pill-glyph", "ⓘ"), body);
  return node;
}

/**
 * A quality mark for the one section the model writes (spec 6.6), not a
 * disclaimer -- the disclaimers already live in the footer notices. This is
 * the panel taking credit for it.
 */
export function aiBadge(): HTMLElement {
  const node = el("span", "ai-badge");
  node.title = "Written by Claude for this model and mileage.";
  node.append(el("span", "ai-badge-glyph", "✦"), el("span", undefined, "AI"));
  return node;
}

/**
 * A plain always-visible section with a heading.
 *
 * `badge` is the same mark `disclosure()` accepts, and `action` is a control
 * that belongs to the section as a whole (currently only the breakdown's
 * expand-all), pinned to the right of its heading.
 */
export function section(
  title: string,
  body: Node[],
  badge?: Node,
  action?: Node,
): HTMLElement | null {
  if (body.length === 0) return null;
  const node = el("section");
  const heading = el("h2", undefined, title);
  if (badge || action) {
    const row = el("div", "section-heading-row");
    row.append(heading);
    if (badge) row.append(badge);
    if (action) row.append(action);
    node.append(row, ...body);
  } else {
    node.append(heading, ...body);
  }
  return node;
}

export function list(items: string[], className?: string): HTMLElement | null {
  if (items.length === 0) return null;
  const ul = el("ul", className);
  for (const item of items) ul.append(el("li", undefined, item));
  return ul;
}

export type Row = [label: string, value: string, options?: { big?: boolean; tone?: Tone }];

export function rows(pairs: Row[]): HTMLElement {
  const dl = el("dl", "rows");
  for (const [label, value, options] of pairs) {
    const dd = el("dd", options?.big ? "big" : undefined);
    if (options?.tone) {
      dd.dataset["tone"] = options.tone;
      dd.append(el("span", "row-glyph", TONE_GLYPH[options.tone]), el("span", undefined, value));
    } else {
      dd.textContent = value;
    }
    dl.append(el("dt", undefined, label), dd);
  }
  return dl;
}

/**
 * One figure, sized so it is read before the sentence next to it.
 *
 * For the answers that are a number and nothing else -- how many open recall
 * campaigns, how many complaints. As a `rows()` entry those read as one line
 * item among several; the whole point of "3 open recall campaigns" is that it
 * should stop someone.
 */
export function statTile(
  label: string,
  value: string,
  tone: Tone = "neutral",
  note?: string,
): HTMLElement {
  const node = el("div", "stat");
  node.dataset["tone"] = tone;

  const figure = el("div", "stat-figure");
  // The glyph is the tone's second carrier, so it only exists where there is a
  // tone to carry. A neutral tile is a figure with no judgement attached, and
  // prefixing it with the neutral middle dot puts a stray mark in front of a
  // number for no reason (tokens.ts, rule 2).
  if (tone !== "neutral") figure.append(el("span", "stat-glyph", TONE_GLYPH[tone]));
  figure.append(el("span", "stat-value", value));
  node.append(figure, el("div", "stat-label", label));
  if (note) node.append(el("p", "stat-note", note));
  return node;
}

/**
 * A labelled magnitude, drawn as well as written.
 *
 * `fraction` is 0-1 of the row's own track. Used where the comparison between
 * rows is the finding -- which components people complain about, how much
 * leverage there is -- and never as the only carrier: the value is printed at
 * the end of the row, so the bar is a second reading of a number that is
 * already there.
 */
export function meterRow(
  label: string,
  value: string,
  fraction: number,
  tone: Tone = "neutral",
): HTMLElement {
  const node = el("div", "meter-row");

  const head = el("div", "meter-head");
  head.append(el("span", "meter-label", label), el("span", "meter-value", value));

  const track = el("div", "meter");
  const fill = el("i");
  fill.dataset["tone"] = tone;
  track.append(fillsTo(fill, fraction));

  node.append(head, track);
  return node;
}

/**
 * Copy something the buyer would otherwise retype.
 *
 * The two outputs this is on -- the suggested offer and the seller questions --
 * are the panel's only outputs meant to leave it and go into a message to a
 * stranger. Everything else here is for reading.
 *
 * `navigator.clipboard.writeText` needs transient activation, which the click
 * supplies. A rejection (a page that has denied clipboard permission) is
 * reported in the button rather than swallowed, because a "Copied" that did not
 * copy is worse than a visible failure.
 */
export function copyButton(text: string, label = "Copy"): HTMLButtonElement {
  const button = el("button", "copy") as HTMLButtonElement;
  button.type = "button";

  const glyph = el("span", "copy-glyph", "⧉");
  const wording = el("span", undefined, label);
  button.append(glyph, wording);

  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  const flash = (state: "done" | "failed", word: string, mark: string) => {
    button.dataset["state"] = state;
    glyph.textContent = mark;
    wording.textContent = word;
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      delete button.dataset["state"];
      glyph.textContent = "⧉";
      wording.textContent = label;
    }, 1600);
  };

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void navigator.clipboard
      ?.writeText(text)
      .then(() => flash("done", "Copied", TONE_GLYPH.favorable))
      .catch(() => flash("failed", "Press ⌘C", TONE_GLYPH.caution));
  });

  return button;
}

/** A link out to a Marketplace listing. */
export function listingLink(url: string, label = "Open listing"): HTMLAnchorElement {
  const link = el("a") as HTMLAnchorElement;
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  link.append(el("span", "link-arrow", "→"));
  return link;
}

export const ELEMENT_STYLES = `
  section { padding: var(--sp-5) var(--sp-6); border-bottom: 1px solid var(--border-faint); }
  h2 {
    margin: 0 0 var(--sp-4); font-size: var(--fs-xs); font-weight: 700;
    letter-spacing: .08em; text-transform: uppercase; color: var(--text-dim);
  }
  .section-heading-row {
    display: flex; align-items: center; gap: var(--sp-3); margin: 0 0 var(--sp-4);
  }
  .section-heading-row h2 { margin: 0; }

  /* rows -------------------------------------------------------------- */
  .rows {
    display: grid; grid-template-columns: auto 1fr;
    gap: var(--sp-2) var(--sp-5); font-size: var(--fs-base);
    align-items: baseline;
  }
  .rows dt { color: var(--text-dim); }
  .rows dd {
    margin: 0; font-family: var(--font-num);
    font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1;
  }
  .rows dd.big {
    font-size: var(--fs-md); font-weight: 650; letter-spacing: -.01em; color: var(--text);
  }
  .rows dd[data-tone] { display: flex; align-items: baseline; gap: var(--sp-2); }
  .rows dd[data-tone="favorable"] { color: var(--tone-favorable-text); }
  .rows dd[data-tone="caution"]   { color: var(--tone-caution-text); }
  .rows dd[data-tone="adverse"]   { color: var(--tone-adverse-text); }
  .row-glyph { font-size: var(--fs-xs); }

  ul {
    margin: var(--sp-3) 0 0; padding-left: var(--sp-5);
    font-size: var(--fs-sm); line-height: 1.55; color: var(--text-muted);
  }
  li { margin-bottom: var(--sp-1); }
  li::marker { color: var(--text-faint); }
  .muted {
    color: var(--text-dim); font-size: var(--fs-sm); line-height: 1.5; margin: var(--sp-3) 0 0;
  }

  /* callout ----------------------------------------------------------- */
  .callout {
    position: relative; overflow: hidden;
    border: 1px solid; border-radius: var(--radius-md);
    padding: var(--sp-4) var(--sp-4) var(--sp-4) var(--sp-5);
    margin: 0 0 var(--sp-4);
  }
  /* A left rail as well as a tint. On light the tint alone is a very pale
     wash, and a pale wash is not a warning. */
  .callout::before {
    content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
    background: currentColor; opacity: .85;
  }
  .callout h3 {
    margin: 0 0 var(--sp-2); font-size: var(--fs-base); font-weight: 650;
    display: flex; align-items: baseline; gap: var(--sp-2);
  }
  .callout p { margin: 0; font-size: var(--fs-sm); line-height: 1.5; }
  .callout p + p { margin-top: var(--sp-2); }
  .callout ul { color: inherit; }
  .callout-glyph { font-size: var(--fs-sm); }
  .callout[data-tone="adverse"] {
    background: var(--tone-adverse-surface); border-color: var(--tone-adverse-border);
    color: var(--tone-adverse-on-surface);
  }
  .callout[data-tone="adverse"] h3, .callout[data-tone="adverse"]::before {
    color: var(--tone-adverse-text);
  }
  .callout[data-tone="caution"] {
    background: var(--tone-caution-surface); border-color: var(--tone-caution-border);
    color: var(--tone-caution-on-surface);
  }
  .callout[data-tone="caution"] h3, .callout[data-tone="caution"]::before {
    color: var(--tone-caution-text);
  }
  .callout[data-tone="favorable"] {
    background: var(--tone-favorable-surface); border-color: var(--tone-favorable-border);
    color: var(--tone-favorable-on-surface);
  }
  .callout[data-tone="favorable"] h3, .callout[data-tone="favorable"]::before {
    color: var(--tone-favorable-text);
  }
  .callout[data-tone="neutral"] {
    background: var(--raised); border-color: var(--border); color: var(--text-muted);
  }
  .callout[data-tone="neutral"]::before { color: var(--border); }

  /* disclosure -------------------------------------------------------- */
  .disclosure { border-bottom: 1px solid var(--border-faint); }
  .disclosure > summary {
    display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap;
    padding: var(--sp-4) var(--sp-6); cursor: pointer; list-style: none;
    transition: background var(--dur-fast) var(--ease-out);
  }
  .disclosure > summary::-webkit-details-marker { display: none; }
  /* A chevron rather than +/-: it rotates, so opening and closing is one
     continuous motion instead of a glyph swap. */
  .disclosure > summary::after {
    content: ""; margin-left: auto; flex: none;
    width: 6px; height: 6px; margin-right: 2px;
    border-right: 1.5px solid var(--text-faint);
    border-bottom: 1.5px solid var(--text-faint);
    transform: translateY(-2px) rotate(45deg);
    transition: transform var(--dur-base) var(--ease-out), border-color var(--dur-fast);
  }
  .disclosure[open] > summary::after { transform: translateY(1px) rotate(-135deg); }
  .disclosure > summary:hover { background: var(--raised); }
  .disclosure > summary:hover::after { border-color: var(--text-dim); }
  .disclosure-title {
    font-size: var(--fs-xs); font-weight: 700; letter-spacing: .08em;
    text-transform: uppercase; color: var(--text-dim); flex: none;
    transition: color var(--dur-fast) var(--ease-out);
  }
  .disclosure > summary:hover .disclosure-title { color: var(--text); }
  .disclosure-summary { font-size: var(--fs-sm); color: var(--text-muted); }
  .disclosure-body { padding: var(--sp-1) var(--sp-6) var(--sp-5); }

  /* Chrome 131+ animates a <details> through ::details-content; everything
     older ignores both rules and opens instantly, which is the same behaviour
     the panel has today. Progressive, so the manifest's minimum stays put. */
  @supports (interpolate-size: allow-keywords) {
    .disclosure, .component { interpolate-size: allow-keywords; }
    .disclosure::details-content, .component::details-content {
      block-size: 0; opacity: 0; overflow: clip;
      transition: block-size var(--dur-base) var(--ease-out),
                  content-visibility var(--dur-base) allow-discrete,
                  opacity var(--dur-fast) var(--ease-out);
    }
    .disclosure[open]::details-content, .component[open]::details-content {
      block-size: auto; opacity: 1;
    }
  }

  /* stat tile --------------------------------------------------------- */
  .stat {
    display: inline-flex; flex-direction: column; gap: 2px;
    padding: var(--sp-3) var(--sp-4); border-radius: var(--radius-md);
    border: 1px solid var(--border); background: var(--raised);
    min-width: 104px;
  }
  .stat-figure { display: flex; align-items: baseline; gap: var(--sp-2); }
  .stat-value {
    font-family: var(--font-num); font-variant-numeric: tabular-nums;
    font-size: var(--fs-lg); font-weight: 650; line-height: 1.1; letter-spacing: -.02em;
    color: var(--text);
  }
  .stat-glyph { font-size: var(--fs-sm); }
  .stat-label {
    font-size: var(--fs-xs); letter-spacing: .04em; text-transform: uppercase;
    color: var(--text-dim);
  }
  .stat-note {
    margin: var(--sp-2) 0 0; font-size: var(--fs-sm); line-height: 1.45; color: var(--text-muted);
  }
  .stat[data-tone="favorable"] {
    border-color: var(--tone-favorable-border); background: var(--tone-favorable-surface);
  }
  .stat[data-tone="favorable"] .stat-value,
  .stat[data-tone="favorable"] .stat-glyph { color: var(--tone-favorable-text); }
  .stat[data-tone="caution"] {
    border-color: var(--tone-caution-border); background: var(--tone-caution-surface);
  }
  .stat[data-tone="caution"] .stat-value,
  .stat[data-tone="caution"] .stat-glyph { color: var(--tone-caution-text); }
  .stat[data-tone="adverse"] {
    border-color: var(--tone-adverse-border); background: var(--tone-adverse-surface);
  }
  .stat[data-tone="adverse"] .stat-value,
  .stat[data-tone="adverse"] .stat-glyph { color: var(--tone-adverse-text); }

  /* meter ------------------------------------------------------------- */
  .meter-row { margin-top: var(--sp-3); }
  .meter-row:first-child { margin-top: 0; }
  .meter-head {
    display: flex; justify-content: space-between; align-items: baseline; gap: var(--sp-4);
    font-size: var(--fs-sm); color: var(--text-muted); margin-bottom: var(--sp-1);
  }
  .meter-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meter-value {
    flex: none; font-family: var(--font-num); font-variant-numeric: tabular-nums;
    color: var(--text-dim);
  }
  .meter {
    height: 6px; border-radius: var(--radius-pill); background: var(--track); overflow: hidden;
  }
  .meter > i {
    display: block; height: 100%; width: 0; border-radius: inherit;
    background: var(--tone-neutral-fill);
    transition: width var(--dur-slow) var(--ease-out);
  }
  .meter > i[data-tone="favorable"] { background: var(--tone-favorable-fill); }
  .meter > i[data-tone="caution"]   { background: var(--tone-caution-fill); }
  .meter > i[data-tone="adverse"]   { background: var(--tone-adverse-fill); }

  /* copy button ------------------------------------------------------- */
  .copy {
    display: inline-flex; align-items: center; gap: var(--sp-1);
    font: 600 var(--fs-xs)/1 var(--font-sans);
    padding: var(--sp-1) var(--sp-3); border-radius: var(--radius-pill);
    border: 1px solid var(--border); background: var(--raised); color: var(--text-dim);
    cursor: pointer;
    transition: color var(--dur-fast) var(--ease-out),
                border-color var(--dur-fast) var(--ease-out),
                transform var(--dur-fast) var(--ease-out);
  }
  .copy:hover { color: var(--text); border-color: var(--text-faint); }
  .copy:active { transform: scale(.96); }
  .copy-glyph { font-size: var(--fs-2xs); }
  .copy[data-state="done"] {
    color: var(--tone-favorable-text); border-color: var(--tone-favorable-border);
    background: var(--tone-favorable-surface);
  }
  .copy[data-state="failed"] {
    color: var(--tone-caution-text); border-color: var(--tone-caution-border);
    background: var(--tone-caution-surface);
  }

  /* note pill ----------------------------------------------------------- */
  .note-pill {
    display: flex; align-items: flex-start; gap: var(--sp-3);
    margin-top: var(--sp-4);
    padding: var(--sp-4) var(--sp-5);
    border-radius: var(--radius-lg);
    background: var(--tone-neutral-surface);
    border: 1px solid var(--tone-neutral-border);
    color: var(--tone-neutral-on-surface);
    font-size: var(--fs-xs);
    line-height: 1.55;
  }
  .note-pill-glyph {
    flex: none; font-size: var(--fs-sm); line-height: 1.55; color: var(--tone-neutral-text);
  }
  .note-pill-body { display: flex; flex-direction: column; gap: var(--sp-2); }
  .note-pill-source { color: var(--text-faint); font-size: var(--fs-2xs); }

  /* badges and links -------------------------------------------------- */
  .ai-badge {
    display: inline-flex; align-items: center; gap: var(--sp-1); flex: none;
    font-size: var(--fs-2xs); font-weight: 700; letter-spacing: .03em;
    padding: 2px 7px; border-radius: var(--radius-pill); color: #fff;
    background: linear-gradient(135deg, #7c5cff, #4f9eff 55%, #34d8c9);
    box-shadow: 0 0 0 1px rgba(255,255,255,.14) inset;
  }
  .ai-badge-glyph { font-size: 9.5px; }

  a {
    color: var(--link); text-decoration: none; word-break: break-word;
    font-size: var(--fs-sm); font-weight: 600;
    display: inline-flex; align-items: baseline; gap: var(--sp-1);
  }
  a:hover { text-decoration: underline; }
  .link-arrow {
    font-size: .9em; transition: transform var(--dur-fast) var(--ease-out);
  }
  a:hover .link-arrow { transform: translateX(2px); }
`;
