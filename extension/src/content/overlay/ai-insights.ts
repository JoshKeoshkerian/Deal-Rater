/**
 * AI Insights: spec 6.6's cached model read, as one section.
 *
 * Used to be two: "Known issues" nested inside the Vehicle Risk bar (summary,
 * failure modes, what to inspect, ownership notes) and "Questions to ask the
 * seller" nested inside the Seller/Scam Risk bar (the `ask` field, on its
 * own). Both read the same `known_issues` object -- it was always one call,
 * rendered in two places -- so merging them loses nothing and reads as one
 * finding instead of a fact split across two unrelated dropdowns.
 *
 * WHY THIS SECTION SOMETIMES FETCHES AND SOMETIMES DOESN'T
 * ----------------------------------------------------------
 * `evaluate_capture` no longer pays for spec 6.6's call on a plain page load
 * (see `known_issues/client.py`'s module docstring on the backend) -- it
 * either already has a cached answer to show for free, already knows why it
 * cannot show one (a gate verdict, or a deployment reason), or has neither and
 * marks `known_issues_pending`. Only the last case is genuinely lazy: opening
 * it for the first time sends `FETCH_KNOWN_ISSUES`, which is the one place in
 * this extension a UI interaction triggers a paid network call. The other two
 * cases render immediately, exactly like every other section in this panel.
 *
 * This is also the first section in the overlay whose content changes after
 * the initial render -- everything else here is built once from an
 * `EvaluationResponse` that never changes underneath it. `bookmark.ts`'s
 * click-send-repaint shape is the only existing precedent, so this follows it:
 * a `<details>` built once, its body replaced in place as the fetch resolves.
 */

import type { KnownIssuesFetchResult } from "../../shared/messages";
import { sendToBackground, type ContentToBackground } from "../../shared/messages";
import type { EvaluationResponse, KnownIssuesReport } from "../../shared/types";
import { aiBadge, copyButton, disclosure, el, list } from "./elements";
import { knownIssuesReasonIsShowable } from "./state";

/**
 * `sendToBackground`, with synchronous throws turned into rejections.
 *
 * Same reason as `bookmark.ts`'s identical helper: `chrome.runtime.sendMessage`
 * throws rather than rejects when the extension context has been invalidated
 * (a reload/update while this overlay is still open), and a bare
 * `.then().catch()` never sees a throw. Duplicated rather than imported --
 * each module that talks to the background worker owns this guard rather than
 * reaching into another section's file for it.
 */
function ask<T>(message: ContentToBackground): Promise<T> {
  try {
    return sendToBackground<T>(message);
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/** The merged content: everything spec 6.6's call produced, in one place. */
function renderReport(known: KnownIssuesReport): HTMLElement[] {
  const nodes: HTMLElement[] = [el("p", "known-summary", known.summary)];

  const groups: Array<[string, string[]]> = [
    ["Known to go wrong", known.failure_modes],
    ["Check on the viewing", known.inspect],
    ["Living with it", known.ownership_notes],
  ];
  for (const [label, items] of groups) {
    const ul = list(items);
    if (!ul) continue;
    nodes.push(el("p", "muted", label), ul);
  }

  const questions = list(known.ask);
  if (questions) {
    // These exist to be sent to a stranger, and a buyer who cannot copy them
    // retypes them into Messenger one at a time or, more likely, asks none of
    // them. Newline-joined rather than bulleted: the destination is a chat box.
    nodes.push(el("p", "muted", "Questions to ask the seller"));
    const actions = el("div", "questions-actions");
    actions.append(copyButton(known.ask.join("\n"), "Copy all"));
    nodes.push(actions, questions);
  } else {
    nodes.push(
      el(
        "p",
        "muted",
        "No vehicle-specific questions -- the standard checklist (title, service " +
          "history, accident history) covers this one.",
      ),
    );
  }

  return nodes;
}

function retryButton(onRetry: () => void): HTMLButtonElement {
  const button = el("button", "ai-insights-retry", "Try again") as HTMLButtonElement;
  button.type = "button";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onRetry();
  });
  return button;
}

/**
 * The clickable, not-yet-generated state: a `<details>` whose body is filled
 * in the first time it is opened, never before and never again after.
 */
function buildPending(captureId: number): HTMLElement {
  const node = disclosure(
    "AI Insights",
    "",
    [
      el(
        "p",
        "muted",
        "Open this to ask Claude what's documented to go wrong with this vehicle, " +
          "what to check on the viewing, and what to ask the seller.",
      ),
    ],
    aiBadge(),
  ) as HTMLDetailsElement;
  const body = node.querySelector(".disclosure-body") as HTMLElement;

  type State = "idle" | "loading" | "settled";
  let state: State = "idle";

  const paint = (children: Node[]) => body.replaceChildren(...children);

  const load = () => {
    if (state !== "idle") return;
    state = "loading";
    paint([el("p", "muted", "Generating…")]);

    void ask<KnownIssuesFetchResult>({ type: "FETCH_KNOWN_ISSUES", captureId })
      .then((message) => {
        state = "settled";
        if (!message.ok) {
          paint([el("p", "muted", message.error), retryButton(retry)]);
          return;
        }
        const fetched = message.result;
        if (fetched.known_issues) {
          paint(renderReport(fetched.known_issues));
          return;
        }
        if (
          fetched.known_issues_unavailable_reason &&
          knownIssuesReasonIsShowable(fetched.known_issues_unavailable_code)
        ) {
          paint([el("p", "muted", fetched.known_issues_unavailable_reason)]);
          return;
        }
        paint([el("p", "muted", "No known-issue data available for this vehicle.")]);
      })
      .catch(() => {
        state = "settled";
        paint([el("p", "muted", "Could not reach the server."), retryButton(retry)]);
      });
  };

  const retry = () => {
    state = "idle";
    load();
  };

  // The native `<details>` toggle IS the click that opens AI Insights -- no
  // separate button, so opening this section behaves exactly like opening any
  // other in the panel. Fires on close too; `load`'s own `state !== "idle"`
  // guard is what keeps a collapse-then-reopen from firing a second request.
  node.addEventListener("toggle", () => {
    if (node.open) load();
  });

  return node;
}

/**
 * Spec 6.6's section, in whichever of three states the eager evaluation left
 * it in. Null when there is nothing to show and nothing to fetch -- a
 * deployment reason that stays hidden from the buyer (`knownIssuesReasonIsShowable`).
 */
export function buildAiInsights(data: EvaluationResponse): HTMLElement | null {
  if (data.known_issues) {
    return disclosure("AI Insights", "", renderReport(data.known_issues), aiBadge());
  }
  if (
    data.known_issues_unavailable_reason &&
    knownIssuesReasonIsShowable(data.known_issues_unavailable_code)
  ) {
    return disclosure("AI Insights", "", [el("p", "muted", data.known_issues_unavailable_reason)]);
  }
  if (!data.known_issues_pending) return null;
  return buildPending(data.capture_id);
}

export const AI_INSIGHTS_STYLES = `
  .known-summary {
    margin: 0 0 var(--sp-2); font-size: var(--fs-base); line-height: 1.55; color: var(--text-muted);
  }
  .questions-actions { display: flex; justify-content: flex-end; margin-bottom: var(--sp-1); }

  .ai-insights-retry {
    margin-top: var(--sp-3);
    display: inline-flex; align-items: center;
    font: 600 var(--fs-xs)/1 var(--font-sans);
    padding: var(--sp-2) var(--sp-4); border-radius: var(--radius-pill);
    border: 1px solid var(--border); background: var(--raised); color: var(--text-dim);
    cursor: pointer;
    transition: color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
  }
  .ai-insights-retry:hover { color: var(--text); border-color: var(--text-faint); }
`;
