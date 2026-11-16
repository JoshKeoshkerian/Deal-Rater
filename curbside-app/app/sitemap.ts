import type { MetadataRoute } from "next";

import { getAllPosts } from "@/lib/blog";

/**
 * Public, indexable routes only. `/saved` and `/account` carry their own
 * `robots: { index: false }` (see their `layout.tsx` files) and stay out of
 * this list for the same reason — a signed-in list of somebody's saved cars,
 * or their plan and balance, has no business in a search index or a sitemap
 * that points crawlers at it.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://curbsidescore.com";
  const routes = ["/", "/pricing", "/privacy", "/blog"];

  const pages: MetadataRoute.Sitemap = routes.map((route) => ({
    url: `${base}${route}`,
    lastModified: new Date(),
  }));
  // Each post from `content/blog/`, dated by its frontmatter.
  const posts: MetadataRoute.Sitemap = getAllPosts().map((post) => ({
    url: `${base}/blog/${post.slug}`,
    lastModified: new Date(`${post.date}T00:00:00Z`),
  }));
  return [...pages, ...posts];
}
