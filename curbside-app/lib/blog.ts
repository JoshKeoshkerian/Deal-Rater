/**
 * The blog: Markdown files in `content/blog/`, read at build time.
 *
 * Each file starts with a frontmatter block:
 *
 *   ---
 *   title: "..."
 *   description: "..."   (the meta description)
 *   date: "YYYY-MM-DD"
 *   slug: "..."          (the URL: /blog/<slug>)
 *   ---
 *
 * No CMS and no external service: adding a post is adding a file and
 * deploying. Every post is prerendered (`generateStaticParams`), so nothing
 * here runs per request.
 */

import fs from "node:fs";
import path from "node:path";

export type PostMeta = {
  title: string;
  description: string;
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  slug: string;
};

export type Post = PostMeta & { body: string };

const BLOG_DIR = path.join(process.cwd(), "content", "blog");
const REQUIRED = ["title", "description", "date", "slug"] as const;

/** Split a file into its frontmatter fields and Markdown body. Throws on a
 * missing or malformed field, so a broken post fails the build instead of
 * shipping with an empty title. */
export function parsePost(source: string, file = "post"): Post {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) throw new Error(`${file}: missing frontmatter block`);
  const [, front, body] = match;

  const fields: Record<string, string> = {};
  for (const line of front!.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) throw new Error(`${file}: cannot read frontmatter line "${line}"`);
    let value = kv[2]!.trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    fields[kv[1]!] = value;
  }
  for (const key of REQUIRED) {
    if (!fields[key]) throw new Error(`${file}: frontmatter is missing "${key}"`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields["date"]!)) {
    throw new Error(`${file}: date must be YYYY-MM-DD`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields["slug"]!)) {
    throw new Error(`${file}: slug must be lowercase words joined by hyphens`);
  }
  return {
    title: fields["title"]!,
    description: fields["description"]!,
    date: fields["date"]!,
    slug: fields["slug"]!,
    body: body!.trim(),
  };
}

export function getAllPosts(): Post[] {
  if (!fs.existsSync(BLOG_DIR)) return [];
  const posts = fs
    .readdirSync(BLOG_DIR)
    .filter((name) => name.endsWith(".md"))
    .map((name) => parsePost(fs.readFileSync(path.join(BLOG_DIR, name), "utf8"), name));

  const seen = new Set<string>();
  for (const post of posts) {
    if (seen.has(post.slug)) throw new Error(`Two blog posts share the slug "${post.slug}"`);
    seen.add(post.slug);
  }
  // Newest first; same-day posts by title so the order is stable.
  return posts.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}

export function getPost(slug: string): Post | undefined {
  return getAllPosts().find((post) => post.slug === slug);
}

/** "November 16, 2026". UTC, so a date never shifts a day by time zone. */
export function formatPostDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
