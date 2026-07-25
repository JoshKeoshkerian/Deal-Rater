/**
 * Tier 2: Open Graph and meta tags.
 *
 * Coarse — og:title carries the vehicle title and og:description a truncated
 * description, and that is about all. But these tags exist because other
 * systems consume them, so Facebook has an external reason not to churn them,
 * which makes this tier a useful floor when the payload search comes up empty.
 */

export function metaContent(doc: Document, property: string): string | null {
  const node =
    doc.querySelector(`meta[property="${property}"]`) ??
    doc.querySelector(`meta[name="${property}"]`);
  const content = node?.getAttribute("content");
  return content && content.trim() !== "" ? content.trim() : null;
}

export function ogTitle(doc: Document): string | null {
  return metaContent(doc, "og:title");
}

export function ogDescription(doc: Document): string | null {
  return metaContent(doc, "og:description");
}

export function ogUrl(doc: Document): string | null {
  return metaContent(doc, "og:url");
}

export function canonicalUrl(doc: Document): string | null {
  const href = doc.querySelector('link[rel="canonical"]')?.getAttribute("href");
  return href && href.trim() !== "" ? href.trim() : null;
}
