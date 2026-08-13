#!/usr/bin/env node
/**
 * Every raster of the Curbside mark in this repo, rendered from one SVG.
 *
 *     node assets/brand/render.mjs
 *
 * Run it after editing `curbside-mark.svg` and commit what it writes. It is not
 * wired into any build: these files change roughly never, and making a Vercel
 * deploy or an extension build depend on a headless browser being installed
 * would be a fragile trade for regenerating four identical PNGs.
 *
 * WHY HEADLESS CHROME AND NOT A LIBRARY
 * --------------------------------------
 * The alternatives are a native rasteriser (`rsvg-convert`, ImageMagick --
 * neither installed, both a brew dependency for a once-a-year script) or an npm
 * one (`sharp`, a compiled dependency this repo does not otherwise have; the
 * extension builds with esbuild alone and the site is stock Next). Chrome is
 * already on the machine because the product is a Chrome extension, and it is
 * the exact renderer that will draw the SVG favicon anyway.
 *
 * The SVG is inlined into the page rather than loaded as an <img src="data:">.
 * The data-URI form renders the mark at its intrinsic 64px inside whatever box
 * it is given, so every icon came out a quarter-size mark on a transparent
 * field. Inlining lets the width/height attributes be rewritten per size, which
 * is what actually scales the vectors.
 *
 * `--default-background-color=00000000` is what makes the PNGs transparent
 * outside the mark's rounded corners. It is new-headless only, hence
 * `--headless=new`.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const source = resolve(here, "curbside-mark.svg");

const CHROME =
  process.env["CHROME_PATH"] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Brand colours, restated here for the OG card's background only. */
const NAVY = "#081D36";
const LIME = "#C2E85C";

const work = mkdtempSync(resolve(tmpdir(), "curbside-brand-"));

/** The mark's markup, without the explanatory comment and sized to `px`. */
function mark(px) {
  const svg = readFileSync(source, "utf8");
  return svg
    .slice(svg.indexOf("<svg"))
    .replace('width="64" height="64"', `width="${px}" height="${px}"`);
}

/**
 * The mark as a standalone .svg, for the two places one is served as a file.
 *
 * The comment is dropped rather than the source file being copied verbatim.
 * Next's metadata-image loader reads `app/icon.svg` with `image-size`, which
 * parses from the first bytes of the file and fails outright on a document that
 * opens with a comment -- "not a valid image file. The image may be corrupted",
 * which is a misleading way to say "there is prose above your root element".
 * The prose belongs with the source anyway; these are build output.
 */
function markFile(out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${mark(64)}\n`, "utf8");
  return out;
}

/**
 * Screenshot one page at an exact pixel size.
 *
 * `line-height:0` on the body: an inline <svg> sits on a text baseline, and the
 * descender space under it pushes the mark up by a pixel or two at 128px and
 * clips it at 16px.
 */
function shot(html, { width, height, out, transparent = true }) {
  const page = resolve(work, `page-${width}x${height}-${Math.random().toString(36).slice(2)}.html`);
  writeFileSync(page, html, "utf8");

  execFileSync(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      ...(transparent ? ["--default-background-color=00000000"] : []),
      // Lets webfonts on the OG card finish loading before the shutter. Ignored
      // by the icon renders, which fetch nothing.
      "--virtual-time-budget=3000",
      `--window-size=${width},${height}`,
      `--screenshot=${out}`,
      page,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
}

function icon(size, out) {
  mkdirSync(dirname(out), { recursive: true });
  shot(
    `<!doctype html><html style="margin:0"><body style="margin:0;line-height:0">${mark(size)}</body></html>`,
    { width: size, height: size, out },
  );
  return out;
}

/**
 * An .ico wrapping PNGs, which is what every browser released this century
 * reads. The legacy BMP-in-ICO encoding is not worth writing by hand.
 *
 * Layout: a 6-byte ICONDIR, then one 16-byte ICONDIRENTRY per size, then the
 * PNG payloads. A dimension of 256 is stored as 0, which does not arise here.
 */
function ico(pngPaths, out) {
  const images = pngPaths.map((path) => ({ path, data: readFileSync(path) }));

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;

  images.forEach((image, index) => {
    // The PNG's own IHDR is the size of truth, so a renamed file cannot lie
    // about its dimensions in the directory.
    const width = image.data.readUInt32BE(16);
    const height = image.data.readUInt32BE(20);
    const at = index * 16;

    directory.writeUInt8(width >= 256 ? 0 : width, at);
    directory.writeUInt8(height >= 256 ? 0 : height, at + 1);
    directory.writeUInt8(0, at + 2); // palette size, 0 for true colour
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(image.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += image.data.length;
  });

  writeFileSync(out, Buffer.concat([header, directory, ...images.map((i) => i.data)]));
  return out;
}

/**
 * The link-preview card (1200x630). Not an icon, but it is where the mark shows
 * up when somebody pastes the URL into a message, which is the one place an
 * icon's absence reads as "this link might be junk".
 *
 * Archivo is fetched because the site's headings use it; the fallback stack is
 * there so a machine with no network still produces a usable card rather than
 * failing the whole run.
 */
function ogCard(out) {
  const html = `<!doctype html>
<html style="margin:0">
  <head>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&display=swap" rel="stylesheet">
  </head>
  <body style="margin:0;width:1200px;height:630px;background:${NAVY};
               font-family:Archivo,-apple-system,'Helvetica Neue',Arial,sans-serif;
               display:flex;flex-direction:column;justify-content:center;gap:36px;padding:0 96px;
               box-sizing:border-box">
    <div style="display:flex;align-items:center;gap:28px;line-height:0">
      ${mark(112)}
      <span style="font-size:88px;font-weight:800;letter-spacing:-.02em;color:#fff;line-height:1">Curbside</span>
    </div>
    <p style="margin:0;font-size:44px;font-weight:600;line-height:1.25;color:#fff;max-width:22ch">
      Is it the right car?
    </p>
    <p style="margin:0;font-size:30px;font-weight:500;line-height:1.4;color:${LIME};max-width:34ch">
      Check any Facebook Marketplace car listing in one click.
    </p>
  </body>
</html>`;
  shot(html, { width: 1200, height: 630, out, transparent: false });
  return out;
}

// --- what gets written -------------------------------------------------------

const written = [];

// The extension. 16/48/128 are what the manifest declares; 32 is what Windows
// actually asks for on the toolbar, and Chrome downscales 48 badly without it.
for (const size of [16, 32, 48, 128]) {
  written.push(icon(size, resolve(root, `extension/icons/icon${size}.png`)));
}

// The website. Next's file conventions: app/icon.svg is the tab icon, app/
// favicon.ico is the legacy fallback, app/apple-icon.png is the iOS home
// screen, app/opengraph-image.png is the link preview. No <link> tags needed --
// Next emits them from the filenames.
const app = resolve(root, "curbside-app/app");
written.push(markFile(resolve(app, "icon.svg")));
written.push(icon(180, resolve(app, "apple-icon.png")));
written.push(ogCard(resolve(app, "opengraph-image.png")));

// The .ico is assembled from throwaway renders rather than from the extension's
// icons, so the two never become coupled by a shared file.
const icoParts = [16, 32, 48].map((size) => icon(size, resolve(work, `ico-${size}.png`)));
written.push(ico(icoParts, resolve(app, "favicon.ico")));

// The old static landing page, which still serves the apex until the domains
// move (see curbside-site/README.md). Plain files, linked by hand in its <head>.
const site = resolve(root, "curbside-site");
written.push(markFile(resolve(site, "icon.svg")));
written.push(icon(180, resolve(site, "apple-touch-icon.png")));
written.push(ico(icoParts, resolve(site, "favicon.ico")));

rmSync(work, { recursive: true, force: true });

for (const path of written) console.log(path.replace(`${root}/`, ""));
console.log(`\n${written.length} files written from ${source.replace(`${root}/`, "")}`);
