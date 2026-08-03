---
description: Use when generating a fixed-mode artifact — the output contract for one default-exported React TSX component.
---

# Fixed-mode artifact contract

Produce exactly ONE React component as TSX in `/output/artifact.tsx`.

Rules:

- `export default` a single function component. No other exports.
- You may import ONLY from: "react", "recharts", "lucide-react", "clsx",
  "@acme/ui" (cn).
- Use Tailwind utility classes for styling.
- Presentational + client-side interactivity ONLY (useState/useMemo, tabs,
  charts).
- NO data fetching, NO fetch/XHR, NO network, NO server access, NO
  localStorage.
- You MAY render a single `<link rel="stylesheet">` to Google Fonts for
  typography (React hoists it) — this is the only allowed network reference.
- Inline all data as literals.
- For flowcharts, sequence, ER, state, gantt, or mindmap diagrams, write
  mermaid: an element with `className="mermaid"` whose text content is the
  diagram source, put in a template-literal child —
  ``<pre className="mermaid">{`graph TD; A[Start] --> B[End];`}</pre>``. Do NOT
  add a mermaid `<script>` tag or call mermaid yourself; the loader is spliced
  in for you. Prefer a real diagram over an ASCII-art imitation of one, and
  recharts for quantitative charts.
- The file must contain ONLY the .tsx source. No markdown fences, no prose.

## Syntax

The sandbox transpiles by stripping types rather than fully parsing them, so a
few otherwise-valid TSX constructs fail the build with "Unexpected token":

- No generic type parameters on arrow functions (`<T,>(x: T) => x`) — the `<` is
  read as JSX. Use a plain `function` declaration if you need a generic.
- No `enum`, `namespace`, `declare`, decorators, or parameter properties
  (`constructor(private x)`).
- No `satisfies`. Prefer plain literals with no type annotation at all — types
  are erased anyway, and every annotation is a chance to trip the parser.
- Escape `<` and `>` inside JSX text as `{"<"}` / `{">"}`; a bare `<` starts a
  tag.

Keep the file complete. Prefer ~300 lines; if the design would run longer, cut
scope (fewer sections, fewer inline data rows) rather than risk an unfinished
file — a truncated component cannot be rendered at all. Close every JSX tag,
brace, and parenthesis, and re-read the end of the file before you finish.
