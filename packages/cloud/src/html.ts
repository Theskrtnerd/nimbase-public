function isTagBoundary(char: string | undefined): boolean {
  return (
    char === undefined ||
    char === ">" ||
    char === "/" ||
    char === " " ||
    char === "\t" ||
    char === "\r" ||
    char === "\n"
  );
}

function tagEnd(html: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let index = start; index < html.length; index++) {
    const char = html[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return index + 1;
  }
  return html.length;
}

interface ParsedTag {
  closing: boolean;
  end: number;
  name: string;
}

function parsedTagAt(html: string, start: number): ParsedTag | null {
  let cursor = start + 1;
  const closing = html[cursor] === "/";
  if (closing) cursor++;

  const nameStart = cursor;
  while (cursor < html.length) {
    const code = html.charCodeAt(cursor);
    const asciiLetter =
      (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    const digit = code >= 48 && code <= 57;
    if (!asciiLetter && !digit) break;
    cursor++;
  }
  if (cursor === nameStart) {
    const marker = html[nameStart];
    if (marker !== "!" && marker !== "?") return null;
  }

  const end = tagEnd(html, cursor);
  if (end === html.length && !html.endsWith(">")) return null;
  return {
    closing,
    end,
    name: html.slice(nameStart, cursor).toLowerCase(),
  };
}

function tagStart(
  lowerHtml: string,
  tagName: string,
  from: number,
  closing: boolean,
): number {
  const needle = closing ? `</${tagName}` : `<${tagName}`;
  let index = lowerHtml.indexOf(needle, from);
  while (index !== -1) {
    if (isTagBoundary(lowerHtml[index + needle.length])) return index;
    index = lowerHtml.indexOf(needle, index + 1);
  }
  return -1;
}

/**
 * Removes complete HTML elements, including their contents, without relying on
 * backtracking regular expressions. Intended for reducing untrusted HTML to
 * plain text before the remaining tags are discarded.
 */
export function removeHtmlElementContents(
  html: string,
  tagNames: readonly string[],
): string {
  let output = html;
  for (const rawTagName of tagNames) {
    const tagName = rawTagName.toLowerCase();
    const lowerHtml = output.toLowerCase();
    let cursor = 0;
    let next = "";

    while (cursor < output.length) {
      const open = tagStart(lowerHtml, tagName, cursor, false);
      if (open === -1) {
        next += output.slice(cursor);
        break;
      }
      next += output.slice(cursor, open);

      const openEnd = tagEnd(output, open);
      const close = tagStart(lowerHtml, tagName, openEnd, true);
      if (close === -1) {
        next += " ";
        break;
      }

      next += " ";
      cursor = tagEnd(output, close);
    }

    output = next;
  }
  return output;
}

/**
 * Converts remaining HTML markup to separators in one linear pass. Block
 * closers become newlines and list-item openers become bullets when requested.
 */
export function htmlMarkupToText(
  html: string,
  options: {
    blockTags?: readonly string[];
    listItemTags?: readonly string[];
  } = {},
): string {
  const blockTags = new Set(options.blockTags ?? []);
  const listItemTags = new Set(options.listItemTags ?? []);
  let output = "";
  let cursor = 0;

  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start === -1) {
      output += html.slice(cursor);
      break;
    }
    output += html.slice(cursor, start);

    const tag = parsedTagAt(html, start);
    if (!tag) {
      output += "<";
      cursor = start + 1;
      continue;
    }

    if (tag.name === "br" || (tag.closing && blockTags.has(tag.name))) {
      output += "\n";
    } else if (!tag.closing && listItemTags.has(tag.name)) {
      output += "- ";
    } else {
      output += " ";
    }
    cursor = tag.end;
  }

  return output;
}
