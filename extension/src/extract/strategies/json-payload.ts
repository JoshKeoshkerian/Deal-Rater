/**
 * Tier 1: embedded JSON payloads.
 *
 * Facebook server-renders its initial data into `<script type="application/json">`
 * blobs. This is the best source available: the values are already typed, the
 * text is not truncated the way the rendered description is, and key names are
 * data model rather than presentation, so they survive the markup rewrites that
 * break every selector-based approach.
 *
 * Search is by key name over the whole parsed tree. That is deliberately
 * structure-agnostic — the nesting path changes constantly, the key names do
 * not.
 */

/** Traversal budget. Facebook payloads are large; without a cap a malformed
 * page could make extraction hang while the user waits on a click. */
const MAX_NODES = 400_000;
const MAX_DEPTH = 60;

export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse every embedded JSON script on the page. Unparseable blobs are skipped. */
export function collectJsonPayloads(doc: Document): unknown[] {
  const payloads: unknown[] = [];
  const scripts = doc.querySelectorAll('script[type="application/json"]');

  for (const script of Array.from(scripts)) {
    const text = script.textContent;
    if (!text || text.length < 2) continue;
    try {
      payloads.push(JSON.parse(text));
    } catch {
      // A blob we cannot parse is not an error condition; other tiers cover it.
    }
  }

  return payloads;
}

function walk(
  roots: unknown[],
  visit: (node: JsonObject) => boolean | void,
): void {
  const stack: Array<{ node: unknown; depth: number }> = roots.map((node) => ({
    node,
    depth: 0,
  }));
  let seen = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.depth > MAX_DEPTH) continue;
    if ((seen += 1) > MAX_NODES) return;

    const { node, depth } = current;

    if (Array.isArray(node)) {
      for (const child of node) {
        if (typeof child === "object" && child !== null) {
          stack.push({ node: child, depth: depth + 1 });
        }
      }
      continue;
    }

    if (!isJsonObject(node)) continue;

    // `true` from the visitor means "stop": the caller found what it needed.
    if (visit(node) === true) return;

    for (const value of Object.values(node)) {
      if (typeof value === "object" && value !== null) {
        stack.push({ node: value, depth: depth + 1 });
      }
    }
  }
}

/** Every object in the tree matching a predicate, up to `limit`. */
export function findObjects(
  roots: unknown[],
  predicate: (node: JsonObject) => boolean,
  limit = 200,
): JsonObject[] {
  const found: JsonObject[] = [];
  walk(roots, (node) => {
    if (predicate(node)) {
      found.push(node);
      if (found.length >= limit) return true;
    }
  });
  return found;
}

/** The first object in the tree matching a predicate. */
export function findObject(
  roots: unknown[],
  predicate: (node: JsonObject) => boolean,
): JsonObject | null {
  return findObjects(roots, predicate, 1)[0] ?? null;
}

/**
 * The first defined value stored under any of `keys`, anywhere in the tree.
 *
 * Use sparingly and prefer `findObject` + `pick`: a bare key search can pull
 * `amount` out of an unrelated object. It is safe when the key is specific
 * enough to be unambiguous (`marketplace_listing_title`) and dangerous when it
 * is not (`id`, `text`).
 */
export function findValueByKey(roots: unknown[], keys: readonly string[]): unknown {
  let result: unknown;
  walk(roots, (node) => {
    for (const key of keys) {
      const value = node[key];
      if (value !== undefined && value !== null) {
        result = value;
        return true;
      }
    }
  });
  return result;
}

/** First present value among `keys` on a single object. No traversal. */
export function pick(node: JsonObject | null | undefined, keys: readonly string[]): unknown {
  if (!node) return undefined;
  for (const key of keys) {
    const value = node[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/** `pick`, narrowed to an object result. */
export function pickObject(
  node: JsonObject | null | undefined,
  keys: readonly string[],
): JsonObject | null {
  const value = pick(node, keys);
  return isJsonObject(value) ? value : null;
}

/** `pick`, narrowed to a non-empty string. */
export function pickString(
  node: JsonObject | null | undefined,
  keys: readonly string[],
): string | null {
  const value = pick(node, keys);
  if (typeof value === "string" && value.trim() !== "") return value;
  if (typeof value === "number") return String(value);
  return null;
}

/** `pick`, narrowed to a finite number (accepting numeric strings). */
export function pickNumber(
  node: JsonObject | null | undefined,
  keys: readonly string[],
): number | null {
  const value = pick(node, keys);
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) ? numeric : null;
}

/** `pick`, narrowed to an array. */
export function pickArray(
  node: JsonObject | null | undefined,
  keys: readonly string[],
): unknown[] | null {
  const value = pick(node, keys);
  return Array.isArray(value) ? value : null;
}
