/**
 * Frontmatter parsing for MDX/markdown content. Backed by gray-matter.
 */

import matter from "gray-matter";

export interface Frontmatter {
  title?: string;
  source?: string;
  date?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface ParsedFrontmatter {
  data: Frontmatter;
  content: string;
  raw: string;
}

function extractRawBlock(source: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---/.exec(source);
  return match ? match[0] : "";
}

export function parseFrontmatter(source: string): ParsedFrontmatter {
  const parsed = matter(source);
  return {
    data: parsed.data as Frontmatter,
    content: parsed.content.replace(/^\r?\n/, ""),
    raw: extractRawBlock(source),
  };
}

/**
 * Set (or clear) the `tags` key of a document's YAML frontmatter, preserving
 * the prose body and any other frontmatter keys. Pass an empty array to remove
 * the tags key; if no frontmatter keys remain, the block is dropped entirely so
 * untagged notes stay plain markdown. Serialized deterministically server-side
 * (gray-matter) rather than hand-written by a model.
 */
export function setFrontmatterTags(source: string, tags: string[]): string {
  const parsed = matter(source);
  const data: Frontmatter = { ...(parsed.data as Frontmatter) };
  if (tags.length === 0) {
    delete data.tags;
  } else {
    data.tags = tags;
  }
  const content = parsed.content.replace(/^\r?\n/, "");
  if (Object.keys(data).length === 0) return content;
  return matter.stringify(content, data);
}

/**
 * Set (or clear) the `title` key of a document's YAML frontmatter, preserving
 * the prose body and any other frontmatter keys. Pass null (or an empty
 * string) to remove the title key; if no frontmatter keys remain, the block
 * is dropped entirely so untitled notes stay plain markdown. Serialized
 * deterministically server-side (gray-matter) rather than hand-written by a
 * model.
 */
export function setFrontmatterTitle(
  source: string,
  title: string | null,
): string {
  const parsed = matter(source);
  const data: Frontmatter = { ...(parsed.data as Frontmatter) };
  if (title === null || title === "") {
    delete data.title;
  } else {
    data.title = title;
  }
  const content = parsed.content.replace(/^\r?\n/, "");
  if (Object.keys(data).length === 0) return content;
  return matter.stringify(content, data);
}
