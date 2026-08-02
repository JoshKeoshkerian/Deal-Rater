/** Display helpers. Matched to the overlay's, so the same number reads the
 *  same way in both places. */

export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "n/a";
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

export function miles(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return `${value.toLocaleString("en-US")} mi`;
}

/**
 * A date a person reads, not a timestamp.
 *
 * The saved list's whole honesty rests on this being visible: every figure on
 * a card is what the tool said on this date, not what it would say now.
 */
export function checkedOn(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "an unknown date";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The composite score arrives as an unrounded float (a weighted sum of
 * component scores, see `backend/app/evaluation/score.py`), so rendering it
 * raw prints full floating-point precision. One decimal place.
 */
export function formatScore(value: number): string {
  return value.toFixed(1);
}

/** 0-100 -> the overlay's five grade bands, for the score chip's colour. */
export function scoreGrade(score: number): "poor" | "weak" | "fair" | "good" | "excellent" {
  if (score < 35) return "poor";
  if (score < 50) return "weak";
  if (score < 65) return "fair";
  if (score < 80) return "good";
  return "excellent";
}
