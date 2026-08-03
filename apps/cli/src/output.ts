// Output primitives. Human output goes to stdout; the `--json` paths print the
// raw API payload. There is no color in v1, so NO_COLOR is honoured by default.

export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

export function printLine(line = ""): void {
  process.stdout.write(line + "\n");
}

export interface Column {
  key: string;
  header: string;
}

type Row = Record<string, string | number | boolean | null | undefined>;

function cell(value: Row[string]): string {
  return value === null || value === undefined ? "" : String(value);
}

/** Minimal fixed-width table for human output. */
export function renderTable(rows: Row[], columns: Column[]): string {
  const widths = columns.map((col) =>
    Math.max(col.header.length, ...rows.map((r) => cell(r[col.key]).length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ");
  const header = line(columns.map((c) => c.header));
  const body = rows.map((r) => line(columns.map((c) => cell(r[c.key]))));
  return [header, ...body].join("\n");
}
