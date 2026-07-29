/**
 * Which theme the panel is in, and what the toggle does next.
 *
 * Three stored values, not two. "auto" is the default and it is not the same as
 * whichever theme it currently resolves to: a user on auto who moves from a
 * light desk to a dark one gets a panel that follows, and a user who has picked
 * `light` keeps light on a machine set to dark. Collapsing auto into its
 * current resolution at the moment of first render would quietly convert every
 * user into a manual one.
 *
 * Pure functions, for the same reason as `state.ts`: the interesting part is
 * the precedence between a stored preference and the system, and that should be
 * testable without a browser or a `chrome.storage` stub.
 */

import type { ThemeName } from "./tokens";

export type ThemePreference = "auto" | "light" | "dark";

export const THEME_PREFERENCES: ThemePreference[] = ["auto", "light", "dark"];

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as string[]).includes(value);
}

/** What the panel actually renders as. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ThemeName {
  if (preference === "auto") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/**
 * The `data-theme` attribute for a preference, or null to leave it off.
 *
 * Absent is meaningful: with no attribute the stylesheet's own
 * `prefers-color-scheme` query decides, which is what "auto" means and what
 * keeps it live rather than a snapshot (see the module docstring).
 */
export function themeAttribute(preference: ThemePreference): ThemeName | null {
  return preference === "auto" ? null : preference;
}

/** auto -> light -> dark -> auto. */
export function nextTheme(preference: ThemePreference): ThemePreference {
  const index = THEME_PREFERENCES.indexOf(preference);
  return THEME_PREFERENCES[(index + 1) % THEME_PREFERENCES.length]!;
}

/**
 * The toggle's glyph and label.
 *
 * The glyph shows what is on screen NOW, not what the next click will do -- a
 * control that displays its own future state has to be understood before it can
 * be read. The label carries the destination instead, where a screen reader and
 * a tooltip will find it.
 */
export function themeControlText(
  preference: ThemePreference,
  resolved: ThemeName,
): { glyph: string; label: string } {
  const glyph = preference === "auto" ? "◐" : resolved === "dark" ? "☾" : "☀";
  const current =
    preference === "auto" ? `following your system (${resolved})` : `${preference} theme`;
  return { glyph, label: `Theme: ${current}. Switch to ${nextTheme(preference)}.` };
}

/** True when the environment prefers dark. Safe in a non-browser test run. */
export function systemPrefersDark(): boolean {
  return (
    typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
  );
}
