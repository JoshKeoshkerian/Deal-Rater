/**
 * The claim `tokens.ts` makes about itself, checked rather than asserted.
 *
 * Its docstring says each theme's text values "are picked to clear 4.5:1
 * against that theme's own surfaces". That was true of the dark palette by
 * inspection and false in two places by measurement -- `textFaint` cleared
 * neither surface (4.39 and 4.00), and it is the colour on the beta caveats
 * and the liability notice, which is the smallest type in the panel and the
 * text a buyer is most likely to have needed.
 *
 * Eyeballing a hex against a background does not work, and a second theme
 * doubles the number of pairs to get wrong. So the rule is a test.
 *
 * WCAG 2.1: 4.5:1 for body text, 3:1 for large text (>= 24px, or >= 18.66px
 * bold). The headline score is 32-42px, so the five grades are checked at the
 * large-text threshold and everything else at the body one.
 */

import { describe, expect, it } from "vitest";

import { GRADES, TONES, themeVariables, type ThemeName } from "../src/content/overlay/tokens";

const BODY_TEXT = 4.5;
const LARGE_TEXT = 3;

function channels(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  return [r!, g!, b!];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [
    relativeLuminance(foreground),
    relativeLuminance(background),
  ].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

/**
 * Read a custom property back out of the emitted stylesheet.
 *
 * Deliberately parsed from `themeVariables()` rather than imported from the
 * `PALETTE` constant: what ships is the CSS, and a value that never reaches a
 * custom property is not the one on screen. This also catches a variable that
 * is simply missing from one of the two themes.
 */
function tokensFor(theme: ThemeName): Record<string, string> {
  const css = themeVariables(":host");
  const block =
    theme === "dark"
      ? css.slice(css.indexOf(':host([data-theme="dark"])'))
      : css.slice(
          css.indexOf(':host([data-theme="light"])'),
          css.indexOf(':host([data-theme="dark"])'),
        );

  const found: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{3,8});/gi)) {
    found[name!] = value!;
  }
  return found;
}

const THEMES: ThemeName[] = ["light", "dark"];

describe.each(THEMES)("%s theme contrast", (theme) => {
  const token = tokensFor(theme);
  const surfaces = [
    ["the sheet", "--sheet"],
    // The footer notices and the offer card sit on `raised`, which is the
    // harder of the two backgrounds and the one an eyeballed value misses.
    ["the raised surface", "--raised"],
  ] as const;

  it("emits every colour it is asked about", () => {
    for (const name of ["--sheet", "--raised", "--text", "--text-muted", "--text-dim", "--text-faint", "--link", "--beta", "--beta-on"]) {
      expect(token[name], `${name} missing from the ${theme} block`).toBeDefined();
    }
  });

  for (const [surfaceName, surfaceToken] of surfaces) {
    for (const ink of ["--text", "--text-muted", "--text-dim", "--text-faint", "--link"]) {
      it(`${ink} clears ${BODY_TEXT}:1 on ${surfaceName}`, () => {
        expect(contrast(token[ink]!, token[surfaceToken]!)).toBeGreaterThanOrEqual(BODY_TEXT);
      });
    }
  }

  it("the beta badge's own text clears its fill", () => {
    expect(contrast(token["--beta-on"]!, token["--beta"]!)).toBeGreaterThanOrEqual(BODY_TEXT);
  });

  for (const tone of Object.keys(TONES).filter((name) => name !== "neutral")) {
    it(`the ${tone} tone is legible on the sheet and inside its own callout`, () => {
      const text = token[`--tone-${tone}-text`]!;
      const surface = token[`--tone-${tone}-surface`]!;
      const body = token[`--tone-${tone}-on-surface`]!;

      // A chip on the panel, the same chip's heading inside a tinted callout,
      // and that callout's body copy: three different pairings, all shipped.
      expect(contrast(text, token["--sheet"]!)).toBeGreaterThanOrEqual(BODY_TEXT);
      expect(contrast(text, surface)).toBeGreaterThanOrEqual(BODY_TEXT);
      expect(contrast(body, surface)).toBeGreaterThanOrEqual(BODY_TEXT);
    });
  }

  for (const grade of Object.keys(GRADES)) {
    it(`the ${grade} grade clears ${LARGE_TEXT}:1 as large text`, () => {
      expect(
        contrast(token[`--grade-${grade}-text`]!, token["--sheet"]!),
      ).toBeGreaterThanOrEqual(LARGE_TEXT);
    });
  }
});
