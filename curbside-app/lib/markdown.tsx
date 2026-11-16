/**
 * A deliberately small Markdown renderer for blog posts (`lib/blog.ts`).
 *
 * Supports what a post needs and nothing more: `##` / `###` headings,
 * paragraphs, `-` and `1.` lists, `**bold**`, `*italic*`, `[text](url)` links
 * and bare `https://` URLs. It returns React elements, never an HTML string,
 * so nothing in a post file can inject markup or script. Anything it does not
 * recognise is shown as plain text rather than dropped.
 */

import type { ReactNode } from "react";

type Block =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] };

const HEADING = /^(#{2,3})\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^\d+\.\s+(.*)$/;

export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (!line) {
      i++;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1]!.length as 2 | 3, text: heading[2]! });
      i++;
      continue;
    }

    // "## 1. The price is far below..." is a heading (matched above), not a
    // list. A list is one or more consecutive item lines.
    const listPattern = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null;
    if (listPattern) {
      const items: string[] = [];
      while (i < lines.length && listPattern.exec(lines[i]!.trim())) {
        items.push(listPattern.exec(lines[i]!.trim())![1]!);
        i++;
      }
      blocks.push({ kind: "list", ordered: listPattern === NUMBERED, items });
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length) {
      const next = lines[i]!.trim();
      if (!next || HEADING.test(next) || BULLET.test(next) || NUMBERED.test(next)) break;
      paragraph.push(next);
      i++;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }
  return blocks;
}

const INLINE = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)|(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g;

function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href) && !/^https:\/\/curbsidescore\.com(\/|$)/.test(href);
}

function link(href: string, text: ReactNode, key: number): ReactNode {
  return isExternal(href) ? (
    <a key={key} href={href} target="_blank" rel="noopener noreferrer">
      {text}
    </a>
  ) : (
    <a key={key} href={href}>
      {text}
    </a>
  );
}

export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={key++}>{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<em key={key++}>{m[2]}</em>);
    else if (m[3] !== undefined) out.push(link(m[4]!, m[3], key++));
    else out.push(link(m[5]!, m[5], key++));
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  return (
    <>
      {parseBlocks(source).map((block, i) => {
        if (block.kind === "heading") {
          const Tag = block.level === 2 ? "h2" : "h3";
          return <Tag key={i}>{renderInline(block.text)}</Tag>;
        }
        if (block.kind === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return (
            <Tag key={i}>
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </Tag>
          );
        }
        return <p key={i}>{renderInline(block.text)}</p>;
      })}
    </>
  );
}
