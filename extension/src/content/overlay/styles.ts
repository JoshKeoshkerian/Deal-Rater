/**
 * The shell stylesheet: custom properties, the sheet itself, and the two
 * accessibility rules that apply to everything in it.
 *
 * Section styles live next to the code that renders them and are composed here,
 * so a section cannot be added without its styles arriving with it.
 */

import { BREAKDOWN_STYLES } from "./breakdown";
import { ELEMENT_STYLES } from "./elements";
import { HEADER_STYLES } from "./headline";
import { SECTION_STYLES } from "./sections";
import { BASE, toneVariables } from "./tokens";

const SHELL = `
  :host { all: initial; }

  .backdrop {
    position: fixed; inset: 0; z-index: 2147483646;
    background: rgba(6, 12, 18, 0.55);
    display: flex; justify-content: flex-end;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  .sheet {
    width: min(440px, 100vw);
    height: 100%;
    overflow-y: auto;
    background: var(--sheet);
    color: var(--text);
    box-shadow: -4px 0 24px rgba(0,0,0,.4);
  }

  /* One visible focus ring for every interactive element in the panel. The
     panel is an overlay on somebody else's page; a keyboard user who cannot
     see where they are has no way back out to the close button. */
  :where(button, summary, a, [tabindex]):focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
    border-radius: 4px;
  }

  /* Nothing in this panel animates for effect, but disclosure rows and hover
     transitions are still motion. Honour the system preference rather than
     assuming a 120ms fade is beneath notice. */
  @media (prefers-reduced-motion: reduce) {
    * {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
`;

/** Blocks with no section of their own: the findings holder and the footer. */
const TRAILING = `
  .findings { padding: 16px 20px 6px; border-bottom: 1px solid var(--border-faint); }
  .findings .callout:last-child { margin-bottom: 10px; }
  .notices { padding: 16px 20px 28px; }
  .notices p { margin: 0 0 8px; font-size: 11px; line-height: 1.5; color: var(--text-faint); }
  .notices strong { color: var(--text-dim); font-weight: 700; }
`;

export function stylesheet(): string {
  return `
  :host {
    --sheet: ${BASE.sheet};
    --raised: ${BASE.raised};
    --text: ${BASE.text};
    --text-muted: ${BASE.textMuted};
    --text-dim: ${BASE.textDim};
    --text-faint: ${BASE.textFaint};
    --border: ${BASE.border};
    --border-faint: ${BASE.borderFaint};
    --track: ${BASE.track};
    --link: ${BASE.link};
    --beta: ${BASE.beta};
    --focus: ${BASE.link};
${toneVariables()}
  }
${SHELL}
${ELEMENT_STYLES}
${HEADER_STYLES}
${BREAKDOWN_STYLES}
${SECTION_STYLES}
${TRAILING}
`;
}
