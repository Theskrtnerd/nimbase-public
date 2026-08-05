// Heading-aware markdown chunker. Splits on markdown headings, packs each
// section's body to ~500 tokens (~2000 chars, estimate — no tokenizer), and
// prefixes every chunk with its heading breadcrumb so the embedding and the
// keyword index both see the section context. Pure: no IO, no deps.

const MAX_CHARS = 2000;

export interface Chunk {
  ord: number;
  text: string;
}

interface Section {
  breadcrumb: string;
  body: string;
}

function parseHeading(line: string): { level: number; title: string } | null {
  let level = 0;
  while (line[level] === "#" && level < 6) level++;
  if (
    level === 0 ||
    line[level] === "#" ||
    (line[level] !== " " && line[level] !== "\t")
  ) {
    return null;
  }
  return { level, title: line.slice(level + 1).trim() };
}

function splitIntoSections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  const stack: { level: number; title: string }[] = [];
  let buf: string[] = [];
  let breadcrumb = "";

  function flush(): void {
    const body = buf.join("\n").trim();
    if (body) sections.push({ breadcrumb, body });
    buf = [];
  }

  for (const line of lines) {
    const heading = parseHeading(line);
    if (heading) {
      flush();
      let top = stack[stack.length - 1];
      while (top !== undefined && top.level >= heading.level) {
        stack.pop();
        top = stack[stack.length - 1];
      }
      stack.push(heading);
      breadcrumb = stack.map((s) => s.title).join(" > ");
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

function packBody(body: string): string[] {
  if (body.length <= MAX_CHARS) return [body];
  const paragraphs = body.split(/\n\n+/);
  const pieces: string[] = [];
  let cur = "";
  for (const p of paragraphs) {
    if (cur && cur.length + 2 + p.length > MAX_CHARS) {
      pieces.push(cur);
      cur = "";
    }
    if (p.length > MAX_CHARS) {
      if (cur) {
        pieces.push(cur);
        cur = "";
      }
      for (let i = 0; i < p.length; i += MAX_CHARS) {
        pieces.push(p.slice(i, i + MAX_CHARS));
      }
      continue;
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) pieces.push(cur);
  return pieces;
}

export function chunkMarkdown(markdown: string): Chunk[] {
  const chunks: Chunk[] = [];
  let ord = 0;
  for (const section of splitIntoSections(markdown)) {
    for (const piece of packBody(section.body)) {
      const text = section.breadcrumb
        ? `${section.breadcrumb}\n\n${piece}`
        : piece;
      chunks.push({ ord: ord++, text });
    }
  }
  return chunks;
}
