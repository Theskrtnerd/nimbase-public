---
description: Use when generating a freeform-mode artifact — the output contract for one self-contained HTML document.
---

# Freeform-mode artifact contract

Produce a single self-contained HTML document in `/output/artifact.html`.

Rules:

- Use Tailwind via CDN (`<script src="https://cdn.tailwindcss.com"></script>`).
- Inline all data. No other `<script>` tags, no external JS, no React.
- For flowcharts, sequence, ER, state, gantt, or mindmap diagrams, write
  mermaid: an element with `class="mermaid"` whose text content is the diagram
  source — `<pre class="mermaid">graph TD; A[Start] --> B[End];</pre>`. Do NOT
  add a mermaid `<script>` tag or call mermaid yourself; the loader is spliced
  in for you. Prefer a real diagram over an ASCII-art imitation of one.
- The file must contain ONLY the HTML document starting with `<!doctype html>`.
