/**
 * The shell stylesheet: the variable layer, the sheet itself, and the rules
 * that apply to everything in it.
 *
 * Section styles live next to the code that renders them and are composed here,
 * so a section cannot be added without its styles arriving with it.
 */

import { BREAKDOWN_STYLES } from "./breakdown";
import { ELEMENT_STYLES } from "./elements";
import { HEADER_STYLES } from "./headline";
import { SECTION_STYLES } from "./sections";
import { themeVariables } from "./tokens";

const SHELL = `
  :host { all: initial; }

  .backdrop {
    position: fixed; inset: 0; z-index: 2147483646;
    background: var(--scrim);
    display: flex; justify-content: flex-end;
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-out);
  }
  .sheet {
    width: min(444px, 100vw);
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--sheet);
    color: var(--text);
    box-shadow: var(--elev-3);
    transform: translateX(20px);
    transition: transform var(--dur-slow) var(--ease-out);
  }

  /* Entry and exit are the same two properties in opposite directions. The
     class is added a frame after mount and removed on close (see index.ts),
     which is what lets the panel animate OUT as well -- an overlay that snaps
     out of existence reads as a crash rather than a dismissal. */
  .backdrop[data-open="true"] { opacity: 1; }
  .backdrop[data-open="true"] .sheet { transform: translateX(0); }

  .sheet::-webkit-scrollbar { width: 10px; }
  .sheet::-webkit-scrollbar-track { background: transparent; }
  .sheet::-webkit-scrollbar-thumb {
    background: var(--border); border-radius: var(--radius-pill);
    border: 3px solid var(--sheet);
  }
  .sheet::-webkit-scrollbar-thumb:hover { background: var(--text-faint); }

  /* One visible focus ring for every interactive element in the panel. The
     panel is an overlay on somebody else's page; a keyboard user who cannot
     see where they are has no way back out to the close button. */
  :where(button, summary, a, [tabindex]):focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  /* Nothing in this panel animates for effect, but the entry transition,
     the growing bars and the disclosure rows are all motion. Honour the system
     preference rather than assuming a 200ms fade is beneath notice. The JS
     animations check the same query and jump to their final value. */
  @media (prefers-reduced-motion: reduce) {
    * {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
`;

/** The footer: liability and beta notices, with no section of its own. */
const TRAILING = `
  .notices {
    padding: var(--sp-5) var(--sp-6) var(--sp-7);
    background: var(--raised);
    border-top: 1px solid var(--border-faint);
  }
  .notices p {
    margin: 0 0 var(--sp-3); font-size: var(--fs-xs); line-height: 1.55;
    color: var(--text-faint);
  }
  .notices p:last-child { margin-bottom: 0; }
  .notices strong { color: var(--text-dim); font-weight: 700; }
`;

/**
 * `selector` is where the custom properties hang. The panel passes nothing and
 * gets `:host`; the preview harness passes `.panel`, because it renders several
 * panels on one page and each has to be able to carry its own theme.
 */
export function stylesheet(selector = ":host"): string {
  return `
${themeVariables(selector)}
${SHELL}
${ELEMENT_STYLES}
${HEADER_STYLES}
${BREAKDOWN_STYLES}
${SECTION_STYLES}
${TRAILING}
`;
}
