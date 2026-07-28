/**
 * The panel's vocabulary: the handful of shapes every section is built from.
 *
 * Four of them, and the constraint each one encodes:
 *
 *   callout()    a finding that must be seen without expanding anything
 *   disclosure() a finding that must be REACHABLE, not necessarily visible
 *   rows()       labelled figures, tabular-aligned
 *   chip()       a judgement, always as colour AND glyph AND words
 *
 * A section that wants to shout picks `callout`. Everything else picks
 * `disclosure`. That is the whole hierarchy, and keeping it to two levels is
 * what stops the panel drifting back into three screens of flat scroll.
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
 * A collapsed section with a one-line summary of what is inside it.
 *
 * `<details>` rather than a scripted accordion: it is keyboard-operable and
 * screen-reader-announced without any of that being written here, and the
 * browser's find-in-page can open it. The summary line is not a label -- it
 * carries the finding, so a user who never expands the row has still been told.
 *
 * `badge` is an optional mark next to the title -- currently only `aiBadge()`,
 * for the one section (spec 6.6) written by the model rather than the rules.
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
  const detail = typeof summary === "string" ? el("span", "disclosure-summary", summary) : summary;
  line.append(heading);
  if (badge) line.append(badge);
  line.append(detail);

  const inner = el("div", "disclosure-body");
  inner.append(...body);
  node.append(line, inner);
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

/** A plain always-visible section with a heading. */
export function section(title: string, body: Node[]): HTMLElement | null {
  if (body.length === 0) return null;
  const node = el("section");
  node.append(el("h2", undefined, title), ...body);
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

/** A link out to a Marketplace listing. */
export function listingLink(url: string, label = "Open listing"): HTMLAnchorElement {
  const link = el("a") as HTMLAnchorElement;
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  return link;
}

export const ELEMENT_STYLES = `
  section { padding: 16px 20px; border-bottom: 1px solid var(--border-faint); }
  h2 {
    margin: 0 0 10px; font-size: 11px; font-weight: 700;
    letter-spacing: .08em; text-transform: uppercase; color: var(--text-dim);
  }

  .rows { display: grid; grid-template-columns: auto 1fr; gap: 5px 14px; font-size: 13px; }
  .rows dt { color: var(--text-dim); }
  .rows dd { margin: 0; font-variant-numeric: tabular-nums; }
  .rows dd.big { font-size: 17px; font-weight: 600; }
  .rows dd[data-tone] { display: flex; align-items: baseline; gap: 6px; }
  .rows dd[data-tone="favorable"] { color: var(--tone-favorable-text); }
  .rows dd[data-tone="caution"]   { color: var(--tone-caution-text); }
  .rows dd[data-tone="adverse"]   { color: var(--tone-adverse-text); }
  .row-glyph { font-size: 11px; }

  ul { margin: 8px 0 0; padding-left: 18px; font-size: 12.5px; line-height: 1.55; color: var(--text-muted); }
  li { margin-bottom: 5px; }
  .muted { color: var(--text-dim); font-size: 12px; line-height: 1.5; margin: 8px 0 0; }

  .callout {
    border: 1px solid; border-radius: 8px;
    padding: 12px 14px; margin: 0 0 10px;
  }
  .callout h3 {
    margin: 0 0 6px; font-size: 13px; font-weight: 650;
    display: flex; align-items: baseline; gap: 7px;
  }
  .callout p { margin: 0; font-size: 12.5px; line-height: 1.5; }
  .callout p + p { margin-top: 6px; }
  .callout ul { color: inherit; }
  .callout-glyph { font-size: 12px; }
  .callout[data-tone="adverse"] {
    background: var(--tone-adverse-surface); border-color: var(--tone-adverse-border); color: #f2d5d5;
  }
  .callout[data-tone="adverse"] h3 { color: var(--tone-adverse-text); }
  .callout[data-tone="caution"] {
    background: var(--tone-caution-surface); border-color: var(--tone-caution-border); color: #ecdcc0;
  }
  .callout[data-tone="caution"] h3 { color: var(--tone-caution-text); }
  .callout[data-tone="favorable"] {
    background: var(--tone-favorable-surface); border-color: var(--tone-favorable-border); color: #cfe7db;
  }
  .callout[data-tone="favorable"] h3 { color: var(--tone-favorable-text); }
  .callout[data-tone="neutral"] {
    background: var(--raised); border-color: var(--border); color: var(--text-muted);
  }

  .disclosure { border-bottom: 1px solid var(--border-faint); }
  .disclosure > summary {
    display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
    padding: 13px 20px; cursor: pointer; list-style: none;
  }
  .disclosure > summary::-webkit-details-marker { display: none; }
  .disclosure > summary::after {
    content: "+"; margin-left: auto; color: var(--text-faint); font-size: 14px; line-height: 1;
  }
  .disclosure[open] > summary::after { content: "−"; }
  .disclosure > summary:hover { background: var(--raised); }
  .disclosure-title {
    font-size: 11px; font-weight: 700; letter-spacing: .08em;
    text-transform: uppercase; color: var(--text-dim); flex: none;
  }
  .disclosure-summary { font-size: 12.5px; color: var(--text-muted); }
  .disclosure-body { padding: 2px 20px 16px; }

  .ai-badge {
    display: inline-flex; align-items: center; gap: 4px; flex: none;
    font-size: 10px; font-weight: 700; letter-spacing: .03em;
    padding: 2px 7px; border-radius: 999px; color: #fff;
    background: linear-gradient(135deg, #7c5cff, #4f9eff 55%, #34d8c9);
    box-shadow: 0 0 0 1px rgba(255,255,255,.12) inset;
  }
  .ai-badge-glyph { font-size: 9.5px; }

  a { color: var(--link); text-decoration: none; word-break: break-word; }
  a:hover { text-decoration: underline; }
`;
