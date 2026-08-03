/**
 * Remark plugin that transforms [[page]] note-link syntax into
 * markdown links with a `note:` URL scheme. Supports folder paths and
 * an optional display-text alias.
 *
 * `[[my-page]]`            → `<a href="note:my-page">my-page</a>`
 * `[[folder/my-page]]`     → `<a href="note:folder/my-page">folder/my-page</a>`
 * `[[folder/page|Display]]`→ `<a href="note:folder/page">Display</a>`
 */

interface TextNode {
  type: "text";
  value: string;
}

interface LinkNode {
  type: "link";
  url: string;
  children: TextNode[];
}

interface ParentNode {
  type: string;
  children: (TextNode | LinkNode | ParentNode)[];
}

const NOTE_LINK_RE = /\[\[([^\]]+)\]\]/g;

function transformChildren(node: ParentNode): void {
  const next: (TextNode | LinkNode | ParentNode)[] = [];

  for (const child of node.children) {
    if (child.type === "text") {
      const text = (child as TextNode).value;
      let lastIndex = 0;
      NOTE_LINK_RE.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = NOTE_LINK_RE.exec(text))) {
        const before = text.slice(lastIndex, match.index);
        if (before) next.push({ type: "text", value: before });

        const raw = match[1] ?? "";
        const pipe = raw.indexOf("|");
        const target = (pipe === -1 ? raw : raw.slice(0, pipe)).trim();
        const display = (pipe === -1 ? raw : raw.slice(pipe + 1)).trim();
        next.push({
          type: "link",
          url: `note:${target}`,
          children: [{ type: "text", value: display || target }],
        });
        lastIndex = NOTE_LINK_RE.lastIndex;
      }

      const after = text.slice(lastIndex);
      if (after) next.push({ type: "text", value: after });
    } else {
      if ("children" in child && Array.isArray(child.children)) {
        transformChildren(child as ParentNode);
      }
      next.push(child);
    }
  }

  node.children = next;
}

export function remarkNoteLink() {
  return (tree: ParentNode) => {
    transformChildren(tree);
  };
}
