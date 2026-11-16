import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InstallButton } from "@/components/InstallButton";
import { formatPostDate, getAllPosts, getPost } from "@/lib/blog";
import { Markdown } from "@/lib/markdown";

import "../blog.css";

type Params = Promise<{ slug: string }>;

/** Every post is prerendered at build time; an unknown slug is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const post = getPost((await params).slug);
  if (!post) return {};
  const url = `https://curbsidescore.com/blog/${post.slug}`;
  return {
    // Absolute: the site-wide template would append a separator and
    // "Curbside", and a post's title tag should be exactly its title.
    title: { absolute: post.title },
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.description,
      url,
      type: "article",
      publishedTime: post.date,
      siteName: "Curbside",
    },
  };
}

export default async function BlogPostPage({ params }: { params: Params }) {
  const post = getPost((await params).slug);
  if (!post) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    mainEntityOfPage: `https://curbsidescore.com/blog/${post.slug}`,
    publisher: { "@type": "Organization", name: "Curbside" },
  };

  return (
    <main className="wrap page" id="main">
      <article className="article">
        <Link className="article-back" href="/blog">
          &larr; All posts
        </Link>
        <h1 className="page-h1">{post.title}</h1>
        <time className="blog-date" dateTime={post.date}>
          {formatPostDate(post.date)}
        </time>

        <div className="article-body">
          <Markdown source={post.body} />
        </div>

        <aside className="article-cta" aria-labelledby="article-cta-title">
          <h2 id="article-cta-title">The Curbside extension</h2>
          <p>
            Curbside runs in Chrome on a laptop or desktop. Open a Facebook Marketplace car listing,
            click Evaluate, and see how its asking price compares to similar private party listings
            nearby.
          </p>
          <div className="article-cta__actions">
            <InstallButton location="blog-post">Add to Chrome</InstallButton>
            <Link className="btn btn--ghost" href="/#how">
              How it works
            </Link>
          </div>
        </aside>
      </article>

      <script
        type="application/ld+json"
        // JSON, not markup; `<` is escaped so the payload cannot close the tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
    </main>
  );
}
