/**
 * The design system: two themes, three semantic tones, five headline grades,
 * and the scales every size in the panel comes off.
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
 *
 * WHY TWO THEMES
 * --------------
 * The panel is an overlay on somebody else's page, and that page is light for
 * most people. A fixed dark slab over white Marketplace reads as a foreign
 * object rather than an answer about the listing underneath it. Both themes are
 * authored, not derived: a light tone is not its dark value inverted, because
 * `#f0a5a5` is legible on `#0f171e` and invisible on white. Each theme's text
 * values are picked to clear 4.5:1 against that theme's own surfaces.
 *
 * WHY THE SCALES
 * --------------
 * Sizes used to be written per rule: fourteen font sizes between 10 and 42px,
 * and paddings invented at each call site. Two elements a few pixels apart look
 * like a mistake rather than a hierarchy. Everything now comes off `--fs-*`,
 * `--sp-*`, `--radius-*` and `--dur-*`, so there is a fixed number of answers to
 * "how big is this".
 */

export type Tone = "favorable" | "caution" | "adverse" | "neutral";

export type ThemeName = "light" | "dark";

/** The theme-independent surfaces, text ramp and accents. */
export interface Palette {
  /** The panel itself. */
  sheet: string;
  /** One step up from the sheet: hover fills, inset blocks, neutral callouts. */
  raised: string;
  text: string;
  textMuted: string;
  textDim: string;
  textFaint: string;
  border: string;
  borderFaint: string;
  /** Unfilled bar and meter track. */
  track: string;
  link: string;
  /** Beta badge fill, and the text colour that sits on it. */
  beta: string;
  betaOn: string;
  /** The scrim behind the sheet. */
  scrim: string;
  /** Shadows, which carry almost no weight on a dark sheet and most of the
   *  elevation on a light one -- hence per theme rather than per element. */
  elev1: string;
  elev2: string;
  elev3: string;
}

const PALETTE: Record<ThemeName, Palette> = {
  dark: {
    sheet: "#10181f",
    raised: "#16212b",
    text: "#e8eef4",
    textMuted: "#a9bccb",
    textDim: "#8fa3b4",
    // Lifted from #6c8093, which cleared 4.5:1 on neither surface (4.39 on the
    // sheet, 4.00 on raised). It carries the footer notices and the beta
    // caveats -- the smallest type in the panel and the text most likely to be
    // the one a buyer needed.
    textFaint: "#76899b",
    border: "#24333f",
    borderFaint: "#1b2831",
    track: "#22313d",
    link: "#7fb8e8",
    beta: "#d9b26a",
    betaOn: "#10181f",
    scrim: "rgba(6, 12, 18, 0.55)",
    elev1: "0 1px 2px rgba(0,0,0,.32)",
    elev2: "0 6px 20px rgba(0,0,0,.38)",
    elev3: "-6px 0 32px rgba(0,0,0,.48)",
  },
  light: {
    sheet: "#ffffff",
    raised: "#f3f6f9",
    text: "#0f1a22",
    textMuted: "#41576a",
    textDim: "#566e80",
    // Clears 4.5:1 against BOTH the sheet and the raised surface -- the footer
    // notices sit on raised, which is the harder of the two and the one an
    // eyeballed value misses. The faintest text in the panel is still 11px,
    // and 11px below 4.5:1 is a decoration rather than a sentence.
    textFaint: "#5f7383",
    border: "#d5dee5",
    borderFaint: "#e7edf1",
    track: "#e2e9ef",
    link: "#1e6aa8",
    beta: "#8a5f06",
    betaOn: "#ffffff",
    scrim: "rgba(16, 26, 34, 0.38)",
    elev1: "0 1px 2px rgba(16,26,34,.07)",
    elev2: "0 6px 20px rgba(16,26,34,.10)",
    elev3: "-6px 0 32px rgba(16,26,34,.16)",
  },
};

/**
 * One tone, in the five roles the panel needs: text on the sheet, a bar or
 * meter fill, a callout background, that callout's border, and the body text
 * inside the callout.
 *
 * `onSurface` used to be a hex literal sitting in `elements.ts` next to the
 * callout rules -- the one place colour was picked rather than asked for, and
 * the one place a second theme would have silently broken.
 */
export interface ToneColors {
  text: string;
  fill: string;
  surface: string;
  border: string;
  onSurface: string;
}

export const TONES: Record<Tone, Record<ThemeName, ToneColors>> = {
  favorable: {
    dark: {
      text: "#7fd1a8",
      fill: "#4f9e78",
      surface: "#12291f",
      border: "#245c40",
      onSurface: "#cfe7db",
    },
    light: {
      text: "#0e6a41",
      fill: "#2f9e6a",
      surface: "#eaf6f0",
      border: "#b4dcc8",
      onSurface: "#0c4c30",
    },
  },
  caution: {
    dark: {
      text: "#e2b877",
      fill: "#c99a4e",
      surface: "#2b2113",
      border: "#5f4620",
      onSurface: "#ecdcc0",
    },
    light: {
      text: "#8a5806",
      fill: "#cf9a3a",
      surface: "#fdf4e4",
      border: "#ecd2a4",
      onSurface: "#5c3c05",
    },
  },
  adverse: {
    dark: {
      text: "#f0a5a5",
      fill: "#c2685f",
      surface: "#3a1719",
      border: "#7a2f2f",
      onSurface: "#f2d5d5",
    },
    light: {
      text: "#b02a23",
      fill: "#d3544a",
      surface: "#fdeeed",
      border: "#f1c3bf",
      onSurface: "#6d1f1a",
    },
  },
  neutral: {
    dark: {
      text: PALETTE.dark.textDim,
      fill: "#5c9ecf",
      surface: PALETTE.dark.raised,
      border: PALETTE.dark.border,
      onSurface: PALETTE.dark.textMuted,
    },
    light: {
      text: PALETTE.light.textDim,
      fill: "#3d84bd",
      surface: PALETTE.light.raised,
      border: PALETTE.light.border,
      onSurface: PALETTE.light.textMuted,
    },
  },
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
  text: Record<ThemeName, string>;
  /** Headline size, as a reference into the display scale below. */
  size: string;
}

/**
 * Red-to-green, five stops. Deliberately not evenly spaced against 0-100:
 * everything under 55 collapses into one "poor" band because the size of a
 * bad score's shortfall matters less than the fact that it is bad, while the
 * 55-100 range -- where a buyer actually has to decide how good "good" is --
 * gets four times the resolution.
 *
 * The light values are darker and more saturated than their dark counterparts
 * rather than the same hues: a yellow that reads clearly at 36px on `#10181f`
 * is nearly white on paper, so `fair` moves to an olive on light.
 */
export const GRADES: Record<Grade, GradeStyle> = {
  poor: { text: { dark: "#e35c58", light: "#c22f28" }, size: "var(--fs-d1)" },
  weak: { text: { dark: "#e0904a", light: "#a9600c" }, size: "var(--fs-d2)" },
  fair: { text: { dark: "#dcc257", light: "#7d6a06" }, size: "var(--fs-d3)" },
  good: { text: { dark: "#8ecb6b", light: "#3d7f2a" }, size: "var(--fs-d4)" },
  excellent: { text: { dark: "#3fab5e", light: "#166b38" }, size: "var(--fs-d5)" },
};

/**
 * Everything that is the same in both themes: type, space, radius, motion.
 *
 * The display steps (`--fs-d1`..`--fs-d5`) are the headline score's five grade
 * sizes and exist only for `GRADES`. They are part of this block rather than
 * loose numbers in `GRADES` so that there is exactly one place where a size in
 * this panel is decided.
 */
const SCALES = `
    --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    --font-num: var(--font-sans);

    --fs-2xs: 10px;
    --fs-xs: 11px;
    --fs-sm: 12px;
    --fs-base: 13px;
    --fs-md: 15px;
    --fs-lg: 19px;
    --fs-xl: 24px;

    --fs-d1: 32px;
    --fs-d2: 34px;
    --fs-d3: 36px;
    --fs-d4: 39px;
    --fs-d5: 42px;

    --sp-1: 4px;
    --sp-2: 6px;
    --sp-3: 8px;
    --sp-4: 12px;
    --sp-5: 16px;
    --sp-6: 20px;
    --sp-7: 28px;

    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --radius-pill: 999px;

    --dur-fast: 110ms;
    --dur-base: 200ms;
    --dur-slow: 320ms;
    --ease-out: cubic-bezier(.16, .84, .44, 1);
    --ease-spring: cubic-bezier(.34, 1.28, .64, 1);
`;

/** The custom properties one theme sets, indented to sit inside a rule. */
function themeBlock(theme: ThemeName): string {
  const palette = PALETTE[theme];
  const lines = [
    `--sheet: ${palette.sheet};`,
    `--raised: ${palette.raised};`,
    `--text: ${palette.text};`,
    `--text-muted: ${palette.textMuted};`,
    `--text-dim: ${palette.textDim};`,
    `--text-faint: ${palette.textFaint};`,
    `--border: ${palette.border};`,
    `--border-faint: ${palette.borderFaint};`,
    `--track: ${palette.track};`,
    `--link: ${palette.link};`,
    `--focus: ${palette.link};`,
    `--beta: ${palette.beta};`,
    `--beta-on: ${palette.betaOn};`,
    `--scrim: ${palette.scrim};`,
    `--elev-1: ${palette.elev1};`,
    `--elev-2: ${palette.elev2};`,
    `--elev-3: ${palette.elev3};`,
    `color-scheme: ${theme};`,
  ];

  for (const [name, byTheme] of Object.entries(TONES)) {
    const colors = byTheme[theme];
    lines.push(
      `--tone-${name}-text: ${colors.text};`,
      `--tone-${name}-fill: ${colors.fill};`,
      `--tone-${name}-surface: ${colors.surface};`,
      `--tone-${name}-border: ${colors.border};`,
      `--tone-${name}-on-surface: ${colors.onSurface};`,
    );
  }

  for (const [name, style] of Object.entries(GRADES)) {
    lines.push(`--grade-${name}-text: ${style.text[theme]};`, `--grade-${name}-size: ${style.size};`);
  }

  return lines.map((line) => `    ${line}`).join("\n");
}

/**
 * The whole variable layer, for one root.
 *
 * Emitted four times over, and the order matters: light is the base, the media
 * query flips it for anyone whose system is dark, and the two explicit
 * `[data-theme]` rules come last so a user who has picked a theme in the panel
 * beats the system in BOTH directions. A single media query cannot do that --
 * it can only override the default, so "light, on a machine set to dark" would
 * have no way to win.
 *
 * `selector` is `:host` for the two shadow roots, `:root` for the options page
 * (an ordinary document with no shadow boundary to hang the properties on), and
 * a class for the preview harness, which renders several panels on one page and
 * needs each to carry its own theme.
 *
 * `:host` takes its attribute in the functional form -- `:host([data-theme])`,
 * not `:host[data-theme]` -- and every other selector takes the ordinary one.
 * Getting that backwards produces a rule the parser drops silently, which shows
 * up as a theme toggle that does nothing.
 */
export function themeVariables(selector = ":host"): string {
  const scoped = (attr: ThemeName) =>
    selector.startsWith(":host")
      ? `${selector}([data-theme="${attr}"])`
      : `${selector}[data-theme="${attr}"]`;

  return `
  ${selector} {
${SCALES}
${themeBlock("light")}
  }

  @media (prefers-color-scheme: dark) {
    ${selector} {
${themeBlock("dark")}
    }
  }

  ${scoped("light")} {
${themeBlock("light")}
  }

  ${scoped("dark")} {
${themeBlock("dark")}
  }
`;
}
