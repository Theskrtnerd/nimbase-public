// Renders a legacy JSON dataset body as OKF markdown content: tabular data as
// a markdown table (the spec's structural-markdown preference), everything
// else as a fenced json block. Used by the one-off dataset migration
// (scripts/migrate-okf-datasets.ts).

function isFlatRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(
    (v) => v === null || ["string", "number", "boolean"].includes(typeof v),
  );
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function datasetToMarkdown(json: unknown): string {
  if (Array.isArray(json) && json.length > 0 && json.every(isFlatRecord)) {
    const keys: string[] = [];
    for (const record of json) {
      for (const key of Object.keys(record)) {
        if (!keys.includes(key)) keys.push(key);
      }
    }
    const header = `| ${keys.join(" | ")} |`;
    const divider = `|${keys.map(() => "---").join("|")}|`;
    const rows = json.map(
      (record) => `| ${keys.map((k) => cell(record[k])).join(" | ")} |`,
    );
    return [header, divider, ...rows].join("\n") + "\n";
  }
  return "```json\n" + JSON.stringify(json, null, 2) + "\n```\n";
}
