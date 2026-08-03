/**
 * Local demo for the Context.dev Parse integration — the one place that hits
 * the live API on purpose (the vitest suite never does).
 *
 *   infisical run --env dev -- pnpm -F @acme/cloud demo:parse ./some.pdf
 *
 * Prints the markdown the gardener would receive, plus the detected format and
 * credit usage. Exits 1 on failure so it's usable as a smoke check.
 */
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { isParseableMime, parseBytes } from "../parse";

const MIME_FOR_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".html": "text/html",
  ".py": "text/x-python",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
};

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: demo:parse <file>");
    process.exit(1);
  }
  if (!process.env.CONTEXT_DEV_API_KEY) {
    console.error(
      "CONTEXT_DEV_API_KEY is not set — run under `infisical run --env dev --`",
    );
    process.exit(1);
  }

  const ext = extname(path).toLowerCase();
  const mimeType = MIME_FOR_EXT[ext] ?? "application/octet-stream";
  console.error(`→ ${path} (${mimeType})`);
  if (!isParseableMime(mimeType)) {
    console.error(
      `  note: ingest would NOT route this mime to Context.dev — parsing anyway`,
    );
  }

  const data = new Uint8Array(await readFile(path));
  const started = Date.now();
  const result = await parseBytes({
    data,
    mimeType,
    extension: ext.slice(1) || undefined,
  });

  console.error(
    `← ${result.type} in ${Date.now() - started}ms · ${result.markdown.length} chars · ` +
      `${result.creditsConsumed} credit(s), ${result.creditsRemaining} left\n`,
  );
  console.log(result.markdown);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
