/**
 * The steps one capture goes through, and what to call them on screen.
 *
 * `run-capture.ts` already announced every one of these as a sentence; the
 * strings went into a bubble that showed one at a time and gave no sense of
 * where in the run they were. A capture can take a while -- the widening pass
 * is several sequential searches -- and "Searching nearby markets…" sitting
 * unchanged for fifteen seconds is indistinguishable from a hang.
 *
 * TWO OF THE FIVE ARE CONDITIONAL. The re-fetch that `reading` covers happens
 * only when the page's payload describes a different listing, and `widening`
 * only when the home metro did not yield enough comps. The rail handles that by
 * marking every earlier step done when a later one arrives, rather than
 * assuming the run walks all five.
 */

export type CaptureStage = "reading" | "comps" | "widening" | "saving" | "evaluating";

export interface CaptureStep {
  key: CaptureStage;
  /** Short enough for a rail; the full sentence is still shown beneath it. */
  label: string;
}

export const CAPTURE_STEPS: CaptureStep[] = [
  { key: "reading", label: "Listing" },
  { key: "comps", label: "Comps" },
  { key: "widening", label: "Nearby" },
  { key: "saving", label: "Saving" },
  { key: "evaluating", label: "Scoring" },
];

export function stageIndex(stage: CaptureStage): number {
  return CAPTURE_STEPS.findIndex((step) => step.key === stage);
}
