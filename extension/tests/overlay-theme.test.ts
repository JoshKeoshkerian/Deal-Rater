/**
 * Theme precedence, and the token layer's own promise about it.
 *
 * The interesting part is not that there are two themes -- it is that "auto" is
 * a third state rather than a snapshot of whichever one it currently resolves
 * to, and that an explicit choice has to beat the system in BOTH directions. A
 * media query alone can only override the default, so "light, on a machine set
 * to dark" is the case that catches a wrong implementation.
 */

import { describe, expect, it } from "vitest";

import {
  isThemePreference,
  nextTheme,
  resolveTheme,
  themeAttribute,
  themeControlText,
  THEME_PREFERENCES,
} from "../src/content/overlay/theme";
import { themeVariables } from "../src/content/overlay/tokens";

describe("theme resolution", () => {
  it("follows the system when the user has not chosen", () => {
    expect(resolveTheme("auto", true)).toBe("dark");
    expect(resolveTheme("auto", false)).toBe("light");
  });

  it("lets an explicit choice beat the system in both directions", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("leaves the attribute off for auto, so the media query decides", () => {
    // Absent is meaningful: with no attribute the stylesheet's own
    // prefers-color-scheme rule applies, which is what keeps auto live rather
    // than frozen at whatever it resolved to on first render.
    expect(themeAttribute("auto")).toBeNull();
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
  });

  it("cycles through every preference and returns to the start", () => {
    let preference = THEME_PREFERENCES[0]!;
    const seen = [preference];
    for (let i = 0; i < THEME_PREFERENCES.length - 1; i++) {
      preference = nextTheme(preference);
      seen.push(preference);
    }
    expect(new Set(seen).size).toBe(THEME_PREFERENCES.length);
    expect(nextTheme(preference)).toBe(THEME_PREFERENCES[0]);
  });

  it("rejects a stored value neither side can resolve", () => {
    expect(isThemePreference("auto")).toBe(true);
    expect(isThemePreference("sepia")).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
  });
});

describe("theme control text", () => {
  it("shows what is on screen now and says where the click goes", () => {
    // A control that displays its own future state has to be understood before
    // it can be read.
    const auto = themeControlText("auto", "dark");
    expect(auto.label).toContain("system");
    expect(auto.label).toContain("Switch to light");

    const light = themeControlText("light", "light");
    expect(light.glyph).toBe("☀");
    expect(light.label).toContain("Switch to dark");
  });
});

describe("the emitted variable layer", () => {
  it("uses the functional attribute form for :host and the plain one elsewhere", () => {
    // `:host[data-theme]` and `.panel([data-theme])` are both rules the parser
    // drops silently, which shows up as a toggle that does nothing.
    expect(themeVariables(":host")).toContain(':host([data-theme="dark"])');
    expect(themeVariables(":root")).toContain(':root[data-theme="dark"]');
    expect(themeVariables(".panel")).toContain('.panel[data-theme="dark"]');
    expect(themeVariables(".panel")).not.toContain(".panel([data-theme");
  });

  it("puts the explicit rules after the media query, so a choice wins", () => {
    const css = themeVariables(":host");
    expect(css.indexOf("prefers-color-scheme")).toBeLessThan(
      css.indexOf(':host([data-theme="light"])'),
    );
  });

  it("defines every tone and grade in both themes", () => {
    const css = themeVariables(":host");
    for (const tone of ["favorable", "caution", "adverse", "neutral"]) {
      for (const role of ["text", "fill", "surface", "border", "on-surface"]) {
        // Twice over: once in the light base, once in the dark override.
        expect(css.split(`--tone-${tone}-${role}:`).length).toBeGreaterThanOrEqual(4);
      }
    }
    for (const grade of ["poor", "weak", "fair", "good", "excellent"]) {
      expect(css).toContain(`--grade-${grade}-text:`);
      expect(css).toContain(`--grade-${grade}-size:`);
    }
  });

  it("carries the scales exactly once, since they do not vary by theme", () => {
    const css = themeVariables(":host");
    expect(css.split("--fs-base:").length - 1).toBe(1);
    expect(css.split("--sp-4:").length - 1).toBe(1);
  });
});
