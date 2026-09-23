import type { MetadataRoute } from "next";

/**
 * Public, indexable routes only. `/saved` and `/account` carry their own
 * `robots: { index: false }` (see their `layout.tsx` files) and stay out of
 * this list for the same reason — a signed-in list of somebody's saved cars,
 * or their plan and balance, has no business in a search index or a sitemap
 * that points crawlers at it.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://curbsidescore.com";
  const routes = ["/", "/pricing", "/privacy"];

  return routes.map((route) => ({
    url: `${base}${route}`,
    lastModified: new Date(),
  }));
}
