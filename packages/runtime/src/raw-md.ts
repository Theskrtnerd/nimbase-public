import type { SourceKind, SourceMetadata } from "@acme/db/schema";

// The single canonical raw.md shape, used for every SourceKind so the
// gardener always sees the same frontmatter regardless of how a source was
// captured. Bulky/structured metadata (full page HTML, schema.org data, meta
// tags) is appended as trailing sections instead of frontmatter scalars, so
// the frontmatter block stays scannable.
export interface BuildRawMdInput {
  kind: SourceKind;
  title: string | null;
  body: string;
  metadata?: SourceMetadata | null;
  originalFilename?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  contentHash?: string | null;
  capturedAt?: Date | null;
}

function frontmatterLine(key: string, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const scalar =
    typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : JSON.stringify(value);
  return `${key}: ${scalar}`;
}

export function buildRawMd(input: BuildRawMdInput): string {
  const { fullHtml, schemaOrgData, metaTags, ...scalarMeta } =
    input.metadata ?? {};

  const lines = [
    frontmatterLine("kind", input.kind),
    frontmatterLine("title", input.title),
    frontmatterLine("originalFilename", input.originalFilename),
    frontmatterLine("mimeType", input.mimeType),
    frontmatterLine("sizeBytes", input.sizeBytes),
    frontmatterLine("contentHash", input.contentHash),
    frontmatterLine("capturedAt", input.capturedAt?.toISOString()),
    ...Object.entries(scalarMeta).map(([key, value]) =>
      frontmatterLine(key, value),
    ),
  ].filter((line): line is string => line !== null);
  const frontmatter = lines.length ? `---\n${lines.join("\n")}\n---\n\n` : "";

  const contextSections: string[] = [];
  if (metaTags?.length) {
    contextSections.push(
      `## Meta Tags\n\n${metaTags
        .map(
          (tag) => `- ${tag.name ?? tag.property ?? ""}: ${tag.content ?? ""}`,
        )
        .join("\n")}`,
    );
  }
  if (schemaOrgData !== undefined) {
    contextSections.push(
      `## Schema.org Data\n\n\`\`\`json\n${JSON.stringify(schemaOrgData, null, 2)}\n\`\`\``,
    );
  }
  if (fullHtml) {
    contextSections.push(
      `## Full Page HTML\n\n\`\`\`html\n${fullHtml}\n\`\`\``,
    );
  }
  const context = contextSections.length
    ? `\n\n${contextSections.join("\n\n")}`
    : "";

  return `${frontmatter}${input.body}${context}`;
}
