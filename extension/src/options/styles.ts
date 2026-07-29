/**
 * The options page stylesheet.
 *
 * A module rather than a `<style>` block in `options.html` so it draws on the
 * same tokens as the panel and the trigger button. The page was the last thing
 * in the extension carrying its own hexes, which is how it ended up looking
 * like a different product from the overlay it configures -- and why it had no
 * dark mode while the rest of the extension was dark-only.
 *
 * `build.mjs` writes this to `dist/options.css` and the page links it, rather
 * than `options.ts` injecting it at runtime: a settings page that paints
 * unstyled and then restyles itself looks broken during the frame it takes.
 *
 * `:root` rather than `:host` -- an ordinary document, with no shadow boundary
 * to hang the custom properties on.
 */

import { themeVariables } from "../content/overlay/tokens";

export function optionsStylesheet(): string {
  return `${themeVariables(":root")}

  body {
    font-family: var(--font-sans);
    font-size: var(--fs-md); line-height: 1.55;
    max-width: 680px; margin: 0 auto; padding: var(--sp-7) var(--sp-6) 64px;
    color: var(--text); background: var(--sheet);
    -webkit-font-smoothing: antialiased;
  }

  header { margin-bottom: var(--sp-7); }
  h1 {
    font-size: var(--fs-xl); font-weight: 700; letter-spacing: -.02em; margin: 0 0 var(--sp-2);
  }
  h2 {
    font-size: var(--fs-xs); font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
    color: var(--text-dim); margin: var(--sp-7) 0 var(--sp-4);
    padding-bottom: var(--sp-2); border-bottom: 1px solid var(--border-faint);
  }
  p { margin: var(--sp-3) 0; }
  .muted { color: var(--text-dim); font-size: var(--fs-base); }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em;
    background: var(--raised); border: 1px solid var(--border-faint);
    border-radius: var(--radius-sm); padding: 1px 5px;
  }

  /* The disclosure in spec 8.3 is the most important thing on this page, so it
     is the panel's own caution callout rather than a grey box. */
  .notice {
    border: 1px solid var(--tone-caution-border); border-left-width: 3px;
    background: var(--tone-caution-surface); color: var(--tone-caution-on-surface);
    border-radius: var(--radius-md);
    padding: var(--sp-5); margin: var(--sp-5) 0;
    font-size: var(--fs-base);
  }
  .notice strong {
    display: block; margin-bottom: var(--sp-2);
    color: var(--tone-caution-text); font-size: var(--fs-md);
  }
  .notice p { margin: var(--sp-3) 0 0; }

  .field { margin: var(--sp-5) 0; }
  label {
    display: block; margin-bottom: var(--sp-2);
    font-weight: 650; font-size: var(--fs-base);
  }
  input[type="url"], textarea, select {
    width: 100%; box-sizing: border-box;
    font: inherit; font-size: var(--fs-base);
    padding: var(--sp-3) var(--sp-4);
    color: var(--text); background: var(--raised);
    border: 1px solid var(--border); border-radius: var(--radius-md);
    transition: border-color var(--dur-fast) var(--ease-out);
  }
  input[type="url"]:focus, textarea:focus, select:focus {
    outline: none; border-color: var(--focus);
  }
  textarea { resize: vertical; min-height: 88px; font-family: ui-monospace, Menlo, monospace; }
  select { max-width: 220px; }

  .row {
    display: flex; align-items: flex-start; gap: var(--sp-3);
    margin: var(--sp-4) 0; padding: var(--sp-4);
    border: 1px solid var(--border-faint); border-radius: var(--radius-md);
  }
  .row input[type="checkbox"] { margin: 2px 0 0; accent-color: var(--link); }
  .row label { margin: 0; font-weight: 500; font-size: var(--fs-base); }

  .actions { display: flex; align-items: center; gap: var(--sp-4); margin-top: var(--sp-6); }
  button {
    font: 650 var(--fs-base)/1 var(--font-sans);
    padding: var(--sp-4) var(--sp-6); border: 0; border-radius: var(--radius-pill);
    background: var(--link); color: var(--sheet); cursor: pointer;
    transition: filter var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
  }
  button:hover { filter: brightness(1.12); }
  button:active { transform: scale(.97); }
  :where(button, input, select, textarea, a):focus-visible {
    outline: 2px solid var(--focus); outline-offset: 2px;
  }
  #saved { color: var(--tone-favorable-text); font-size: var(--fs-base); font-weight: 650; }
  #saved[hidden] { display: none; }

  @media (prefers-reduced-motion: reduce) {
    * { transition-duration: 0.01ms !important; }
  }
`;
}
