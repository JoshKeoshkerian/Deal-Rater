/**
 * The panel's palette, and the three-state semantic colour on top of it.
 *
 * WHY COLOUR IS A TYPE AND NOT A STYLE
 * ------------------------------------
 * The panel was monochrome blue, so finding the problems in an evaluation meant
 * reading every word of it. Colour here is not decoration: a tone is a JUDGEMENT
 * the evaluation already made, and the only way to get one is to ask a function
 * in `state.ts` for it. Nothing renders a colour by picking a hex value.
 *
 * TWO RULES
 * ---------
 * 1. COLOUR IS NEVER THE ONLY CARRIER. Every toned element ships with a glyph
 *    and a text label. Roughly 1 in 12 men has some red-green deficiency, and a
 *    buyer who cannot see the difference between the recall row and the clean
 *    one must still be told there is a recall. `TONE_GLYPH` exists so that
 *    pairing is impossible to forget.
 *
 * 2. NO JUDGEMENT MEANS NO COLOUR. `neutral` is the default, and most of the
 *    panel stays neutral. If everything is coloured, nothing is flagged.
 */

export type Tone = "favorable" | "caution" | "adverse" | "neutral";

/** Base palette, unchanged from the panel this replaces. */
export const BASE = {
  sheet: "#10181f",
  raised: "#16212b",
  text: "#e8eef4",
  textMuted: "#a9bccb",
  textDim: "#8fa3b4",
  textFaint: "#6c8093",
  border: "#24333f",
  borderFaint: "#1b2831",
  track: "#22313d",
  link: "#7fb8e8",
  beta: "#d9b26a",
} as const;

/**
 * One tone, in the four roles the panel needs: text on the sheet, a bar or
 * meter fill, a callout background, and that callout's border.
 *
 * All four sit on `BASE.sheet`, and the text values clear 4.5:1 against it.
 */
export interface ToneColors {
  text: string;
  fill: string;
  surface: string;
  border: string;
}

export const TONES: Record<Tone, ToneColors> = {
  favorable: { text: "#7fd1a8", fill: "#4f9e78", surface: "#12291f", border: "#245c40" },
  caution: { text: "#e2b877", fill: "#c99a4e", surface: "#2b2113", border: "#5f4620" },
  adverse: { text: "#f0a5a5", fill: "#c2685f", surface: "#3a1719", border: "#7a2f2f" },
  neutral: { text: BASE.textDim, fill: "#5c9ecf", surface: BASE.raised, border: BASE.border },
};

/**
 * The glyph that travels with each tone. Plain characters rather than emoji:
 * emoji render at wildly different sizes across platforms and are announced by
 * screen readers as their CLDR names ("heavy check mark"), which is noise in
 * front of a label that already says what happened.
 */
export const TONE_GLYPH: Record<Tone, string> = {
  favorable: "✓", // check
  caution: "⚠", // warning triangle
  adverse: "✕", // cross
  neutral: "·", // middle dot
};

/** CSS custom properties for every tone, emitted once into the shadow root. */
export function toneVariables(): string {
  const lines: string[] = [];
  for (const [name, colors] of Object.entries(TONES)) {
    lines.push(
      `    --tone-${name}-text: ${colors.text};`,
      `    --tone-${name}-fill: ${colors.fill};`,
      `    --tone-${name}-surface: ${colors.surface};`,
      `    --tone-${name}-border: ${colors.border};`,
    );
  }
  return lines.join("\n");
}

/**
 * Five-way grade for the headline "x / 100" number specifically.
 *
 * `Tone` stays a three-state judgement everywhere else in the panel -- that is
 * a deliberate constraint (see the module docstring) so a reader is never
 * asked to distinguish more shades of red than a glance can tell apart. The
 * headline score is the one place a finer scale earns its keep: it is the
 * single most-looked-at number in the panel, shown once, in isolation, next
 * to nothing else that could disambiguate a middling reading from a bad one.
 */
export type Grade = "poor" | "weak" | "fair" | "good" | "excellent";

export interface GradeStyle {
  text: string;
  /** Headline font size, in px, at this grade. */
  size: number;
}

/**
 * Red-to-green, five stops. Deliberately not evenly spaced against 0-100:
 * everything under 55 collapses into one "poor" band because the size of a
 * bad score's shortfall matters less than the fact that it is bad, while the
 * 55-100 range -- where a buyer actually has to decide how good "good" is --
 * gets four times the resolution.
 */
export const GRADES: Record<Grade, GradeStyle> = {
  poor: { text: "#e35c58", size: 32 },
  weak: { text: "#e0904a", size: 34 },
  fair: { text: "#dcc257", size: 36 },
  good: { text: "#8ecb6b", size: 39 },
  excellent: { text: "#3fab5e", size: 42 },
};

/** CSS custom properties for every grade, emitted alongside the tone ones. */
export function gradeVariables(): string {
  const lines: string[] = [];
  for (const [name, style] of Object.entries(GRADES)) {
    lines.push(`    --grade-${name}-text: ${style.text};`, `    --grade-${name}-size: ${style.size}px;`);
  }
  return lines.join("\n");
}
