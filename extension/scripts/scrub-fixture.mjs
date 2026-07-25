#!/usr/bin/env node
/**
 * Scrub a saved Marketplace page so it can be committed as a test fixture.
 *
 *   npm run scrub-fixture -- tests/fixtures/raw/fb-item-123-….html
 *
 * Writes the result to `tests/fixtures/pages/` and prints what it changed.
 *
 * READ THIS: the script reduces the manual work, it does not replace it. A
 * saved Facebook page contains an unbounded amount of other people's data in
 * shapes nobody has enumerated. Everything below is a denylist, and a denylist
 * is never complete. Open the scrubbed file and read it before committing. If
 * you are not willing to do that, do not commit the fixture — the synthetic
 * pages in `tests/helpers/build-page.ts` already cover the cascades, and a real
 * fixture is a convenience, not a requirement.
 *
 * What it does:
 *   - drops every script except the embedded JSON payloads the extractor reads
 *   - blanks image sources, keeping the elements so photo counts still work
 *   - replaces account identifiers with stable synthetic ones
 *   - redacts values under identity-bearing keys in the JSON payloads
 *   - redacts phone numbers and email addresses in every remaining string
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(root, "tests/fixtures/pages");

/** Keys whose values are personal data and are never read by the extractor. */
const IDENTITY_KEYS = [
  "name",
  "first_name",
  "last_name",
  "full_name",
  "short_name",
  "name_with_pronouns",
  "username",
  "profile_picture",
  "profile_pic_uri",
  "profile_photo",
  "profilePicLarge",
  "alternate_name",
  "email",
  "phone",
  "phone_number",
  "contact_email",
];

/** Name-bearing keys, in case the same real name recurs in an unrecognized shape. */
const NAME_KEYS = new Set([
  "name",
  "first_name",
  "last_name",
  "full_name",
  "short_name",
  "alternate_name",
]);

/** Keys whose object value carries an account id that must be swapped out. */
const ACCOUNT_KEYS = new Set([
  "marketplace_listing_seller",
  "seller",
  "story_actor",
  "actor",
  "owner",
]);

/** Keys the extractor depends on. Never touched, even if they look name-like. */
const PRESERVE_KEYS = new Set([
  "marketplace_listing_title",
  "custom_title",
  "display_name",
  "city",
  "state",
  "make_display_name",
  "model_display_name",
  "vehicle_make",
  "vehicle_model",
  "vehicle_trim",
  "subtitle",
]);

const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g;
const PHONE_RE =
  /(?<![\w-])(?:\+?1[\s.\-]*)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.\-]*\d{3}[\s.\-]*\d{4}(?![\w-])/g;

const counters = {
  scriptsDropped: 0,
  imagesBlanked: 0,
  jsonBlobs: 0,
  identityValues: 0,
  contactDetails: 0,
  accountIds: 0,
  profileLinkText: 0,
  globalIdSweep: 0,
  globalNameSweep: 0,
};

/** Stable synthetic replacement, so one account maps to one fake id throughout. */
const accountIds = new Map();
function fakeAccountId(real) {
  if (!accountIds.has(real)) {
    accountIds.set(real, `9${String(accountIds.size + 1).padStart(14, "0")}`);
    counters.accountIds += 1;
  }
  return accountIds.get(real);
}

// Facebook duplicates the seller's name and id inside double-encoded JSON
// strings (e.g. `nfx_story_data`) that scrubJson never parses into, since it
// only recurses into real objects/arrays. Rather than chase every field that
// might carry a second copy, every real id and name discovered anywhere is
// swept out of the whole file as a last pass.
const realNames = new Set();

function redactString(value) {
  const before = value;
  const after = value.replace(EMAIL_RE, "[EMAIL]").replace(PHONE_RE, "[PHONE]");
  if (after !== before) counters.contactDetails += 1;
  return after;
}

function scrubJson(node) {
  if (Array.isArray(node)) return node.map(scrubJson);
  if (typeof node === "string") return redactString(node);
  if (typeof node !== "object" || node === null) return node;

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (PRESERVE_KEYS.has(key)) {
      out[key] = scrubJson(value);
      continue;
    }
    // The seller's account id is the strongest link back to a real person, so
    // it is swapped for a synthetic one that stays consistent across the file.
    // `id` and `user_id` commonly carry the same real number under different
    // keys, so both are mapped through the same fake id.
    if (ACCOUNT_KEYS.has(key) && typeof value === "object" && value !== null) {
      const realId = typeof value["id"] === "string" ? value["id"] : null;
      const realUserId = typeof value["user_id"] === "string" ? value["user_id"] : null;
      const scrubbed = scrubJson(value);
      if (realId) scrubbed["id"] = fakeAccountId(realId);
      if (realUserId) scrubbed["user_id"] = fakeAccountId(realUserId);
      out[key] = scrubbed;
      continue;
    }
    if (IDENTITY_KEYS.includes(key)) {
      if (NAME_KEYS.has(key) && typeof value === "string" && value.trim()) {
        realNames.add(value);
      }
      out[key] = typeof value === "object" && value !== null ? null : "[REDACTED]";
      counters.identityValues += 1;
      continue;
    }
    if (/scontent|fbcdn/i.test(String(value))) {
      out[key] = "https://example.invalid/photo.jpg";
      continue;
    }
    out[key] = scrubJson(value);
  }
  return out;
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: npm run scrub-fixture -- <path-to-saved-page.html>");
    process.exit(1);
  }

  const inputPath = resolve(process.cwd(), input);
  let html = await readFile(inputPath, "utf8");

  // Keep the JSON payloads, drop every other script: they are enormous, carry
  // session tokens, and the extractor never reads them.
  html = html.replace(
    /<script(?![^>]*type=["']application\/json["'])[^>]*>[\s\S]*?<\/script>/gi,
    () => {
      counters.scriptsDropped += 1;
      return "";
    },
  );

  html = html.replace(
    /(<script[^>]*type=["']application\/json["'][^>]*>)([\s\S]*?)(<\/script>)/gi,
    (_match, open, body, close) => {
      counters.jsonBlobs += 1;
      try {
        const scrubbed = scrubJson(JSON.parse(body));
        return `${open}${JSON.stringify(scrubbed).replace(/</g, "\\u003c")}${close}`;
      } catch {
        // A blob we cannot parse cannot be scrubbed, so it does not survive.
        return `${open}{}${close}`;
      }
    },
  );

  // Scoped to <img> specifically: an untargeted `src=` replacement also
  // rewrites <iframe src>, and happy-dom then tries to actually navigate the
  // fake URL and crashes (null defaultView) — the element survives so photo
  // counts still work, but only <img> needs a fake photo URL.
  html = html.replace(/<img\b[^>]*>/gi, (imgTag) =>
    imgTag.replace(/\ssrc=(["'])(?:https?:)?\/\/[^"']*\1/i, () => {
      counters.imagesBlanked += 1;
      return ' src="https://example.invalid/photo.jpg"';
    }),
  );

  // iframes carry no photo data the extractor reads, but their src can carry
  // opaque session-scoped tokens (e.g. FB's msgr worker proxy) — drop rather
  // than fake it, so nothing attempts to load it.
  html = html.replace(/<iframe\b[^>]*>/gi, (tag) =>
    tag.replace(/\ssrc=(["'])[^"']*\1/i, ""),
  );

  // Alt text and accessible names routinely contain the seller's name.
  html = html.replace(/\s(alt|aria-label|title)=(["'])[^"']*\2/gi, (_m, attr) =>
    attr.toLowerCase() === "alt" ? ' alt=""' : ` ${attr}="[REDACTED]"`,
  );

  // The text of a link to a profile is, in practice, always a person's name.
  html = html.replace(
    /(<a[^>]*href=["'][^"']*(?:\/marketplace\/profile\/|profile\.php\?id=)[^"']*["'][^>]*>)([\s\S]*?)(<\/a>)/gi,
    (_match, open, _inner, close) => {
      counters.profileLinkText += 1;
      return `${open}[REDACTED]${close}`;
    },
  );

  html = html.replace(/\/marketplace\/profile\/(\d+)/g, (_m, id) =>
    `/marketplace/profile/${fakeAccountId(id)}`,
  );
  html = html.replace(/profile\.php\?id=(\d+)/g, (_m, id) =>
    `profile.php?id=${fakeAccountId(id)}`,
  );

  html = redactString(html);

  // Last pass: any real account id or seller name discovered above, wherever
  // it still appears verbatim — including inside double-encoded JSON strings
  // (e.g. `nfx_story_data`) that the structural scrub above never parses into.
  for (const realId of accountIds.keys()) {
    const before = html;
    html = html.replace(new RegExp(`(?<!\\d)${realId}(?!\\d)`, "g"), fakeAccountId(realId));
    if (html !== before) counters.globalIdSweep += 1;
  }
  for (const name of realNames) {
    const before = html;
    html = html.split(name).join("[REDACTED]");
    if (html !== before) counters.globalNameSweep += 1;
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, basename(inputPath));
  await writeFile(outputPath, html, "utf8");

  console.log(`wrote ${outputPath}`);
  for (const [key, value] of Object.entries(counters)) console.log(`  ${key}: ${value}`);
  console.log("\nNow open that file and read it before committing.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
