import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { formatPostDate, getAllPosts, parsePost } from "@/lib/blog";
import { parseBlocks, renderInline } from "@/lib/markdown";

const post = (front: string, body = "Hello.") => `---\n${front}\n---\n\n${body}\n`;
const FRONT = 'title: "A: title"\ndescription: "D"\ndate: "2026-11-16"\nslug: "a-post"';

describe("parsePost", () => {
  it("reads frontmatter and body", () => {
    expect(parsePost(post(FRONT))).toEqual({
      title: "A: title",
      description: "D",
      date: "2026-11-16",
      slug: "a-post",
      body: "Hello.",
    });
  });

  it("fails loudly on a missing field or bad slug", () => {
    expect(() => parsePost(post('title: "T"'))).toThrow(/missing "description"/);
    expect(() => parsePost(post(FRONT.replace("a-post", "A Post")))).toThrow(/slug/);
    expect(() => parsePost("no frontmatter")).toThrow(/frontmatter/);
  });
});

describe("markdown", () => {
  it("splits headings, paragraphs and lists", () => {
    const blocks = parseBlocks("## 1. Heading\n\nOne line\nsame paragraph.\n\n- a\n- b\n");
    expect(blocks).toEqual([
      { kind: "heading", level: 2, text: "1. Heading" },
      { kind: "paragraph", text: "One line same paragraph." },
      { kind: "list", ordered: false, items: ["a", "b"] },
    ]);
  });

  it("links bare URLs with the query string intact", () => {
    const url = "https://curbsidescore.com/?utm_source=blog&utm_medium=organic&utm_campaign=seo-blog-posts";
    const [, anchor] = renderInline(`install it here: ${url}`) as [string, { props: { href: string } }];
    expect(anchor.props.href).toBe(url);
  });
});

describe("the posts in content/blog", () => {
  const posts = getAllPosts();

  it("load, newest first, with unique slugs", () => {
    expect(posts.length).toBeGreaterThan(0);
    const dates = posts.map((p) => p.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("contain no em or en dashes", () => {
    const dir = path.join(process.cwd(), "content", "blog");
    for (const name of fs.readdirSync(dir)) {
      expect(fs.readFileSync(path.join(dir, name), "utf8"), name).not.toMatch(/[–—]/);
    }
  });

  it("formats dates without time-zone drift", () => {
    expect(formatPostDate("2026-11-16")).toBe("November 16, 2026");
  });
});
