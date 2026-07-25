/**
 * Shared state for one extraction pass.
 *
 * Exists mostly so that the JSON payloads are parsed once rather than once per
 * field: they are the largest thing on the page and every field cascade starts
 * by consulting them.
 */

import { listingIdFromUrl } from "../shared/parse";
import { mainRegion } from "./strategies/aria-dom";
import { collectJsonPayloads } from "./strategies/json-payload";

export class ExtractionContext {
  readonly doc: Document;
  readonly url: string;
  readonly now: Date;
  readonly listingId: string | null;

  private cachedPayloads: unknown[] | null = null;
  private cachedMain: Element | null = null;
  private cachedSignature: string | null = null;

  constructor(doc: Document, url: string, now: Date = new Date()) {
    this.doc = doc;
    this.url = url;
    this.now = now;
    this.listingId = listingIdFromUrl(url);
  }

  get payloads(): unknown[] {
    if (this.cachedPayloads === null) {
      this.cachedPayloads = collectJsonPayloads(this.doc);
    }
    return this.cachedPayloads;
  }

  get main(): Element {
    if (this.cachedMain === null) {
      this.cachedMain = mainRegion(this.doc);
    }
    return this.cachedMain;
  }

  /**
   * Coarse structural fingerprint of the page.
   *
   * Attached to every extraction issue so a spike in reports can be traced to
   * one specific Facebook layout, rather than being an undifferentiated rise in
   * failures. Deliberately built from counts and presence flags only: it must
   * be identical across two different listings rendered by the same layout, and
   * it must contain nothing about the listing or the user.
   */
  get pageSignature(): string {
    if (this.cachedSignature !== null) return this.cachedSignature;

    const parts = [
      `p:${bucket(this.doc.querySelectorAll('script[type="application/json"]').length)}`,
      `m:${this.doc.querySelector('[role="main"]') ? 1 : 0}`,
      `h:${this.doc.querySelectorAll('h1, [role="heading"]').length > 0 ? 1 : 0}`,
      `og:${this.doc.querySelectorAll('meta[property^="og:"]').length}`,
      `il:${bucket(this.doc.querySelectorAll('a[href*="/marketplace/item/"]').length)}`,
    ];

    this.cachedSignature = fnv1a(parts.join("|"));
    return this.cachedSignature;
  }
}

/** Counts vary listing to listing; buckets do not. */
function bucket(value: number): number {
  if (value === 0) return 0;
  if (value <= 5) return 1;
  if (value <= 20) return 2;
  if (value <= 60) return 3;
  return 4;
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
