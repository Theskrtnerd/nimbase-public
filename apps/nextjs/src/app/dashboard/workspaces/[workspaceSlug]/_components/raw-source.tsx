"use client";

/** Read-only raw source text with a line-number gutter and soft wrapping. */
export function RawSource({
  body,
  onScroll,
}: {
  body: string;
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
}) {
  const lines = body.split("\n");
  const gutterWidth = `${String(lines.length).length + 1}ch`;

  return (
    <div
      onScroll={onScroll}
      className="app-scrollbar min-h-0 flex-1 overflow-auto"
    >
      <pre className="m-0 p-4 font-mono text-sm leading-relaxed">
        {lines.map((line, i) => (
          <div key={i} className="flex">
            <span
              className="text-muted-foreground/50 mr-4 shrink-0 text-right tabular-nums select-none"
              style={{ minWidth: gutterWidth }}
            >
              {i + 1}
            </span>
            <code className="text-foreground min-w-0 flex-1 break-words whitespace-pre-wrap">
              {line === "" ? "​" : line}
            </code>
          </div>
        ))}
      </pre>
    </div>
  );
}
