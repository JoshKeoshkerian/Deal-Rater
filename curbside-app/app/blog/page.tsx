import type { Metadata } from "next";
import Link from "next/link";

import { formatPostDate, getAllPosts } from "@/lib/blog";

import "./blog.css";

export const metadata: Metadata = {
  title: { absolute: "Curbside Blog: Buying a Used Car on Facebook Marketplace" },
  description:
    "Practical guides for buying a used car on Facebook Marketplace: pricing, red flags, titles, VINs and negotiating.",
  alternates: { canonical: "/blog" },
  openGraph: {
    title: "Curbside Blog",
    description:
      "Practical guides for buying a used car on Facebook Marketplace: pricing, red flags, titles, VINs and negotiating.",
    url: "https://curbsidescore.com/blog",
    type: "website",
  },
};

export default function BlogIndexPage() {
  const posts = getAllPosts();

  return (
    <main className="wrap page" id="main">
      <header className="page-head">
        <h1 className="page-h1">Blog</h1>
        <p className="page-lede">Guides for buying a used car on Facebook Marketplace.</p>
      </header>

      {posts.length === 0 ? (
        <p className="blog-empty">No posts yet.</p>
      ) : (
        <ul className="blog-list">
          {posts.map((post) => (
            <li key={post.slug}>
              <time className="blog-date" dateTime={post.date}>
                {formatPostDate(post.date)}
              </time>
              <h2>
                <Link href={`/blog/${post.slug}`}>{post.title}</Link>
              </h2>
              <p>{post.description}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
