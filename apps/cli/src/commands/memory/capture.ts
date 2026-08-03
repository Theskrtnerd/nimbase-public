import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { Command } from "commander";

import type { SourceDetail } from "@acme/validators/cli";
import {
  finalizeResponseSchema,
  presignResponseSchema,
  sourceDetailSchema,
} from "@acme/validators/cli";

import type { ApiClient } from "../../client";
import { CliError, notFound, usageError } from "../../errors";
import { printJson, printLine } from "../../output";
import { readStdin } from "../../stdin";
import { sleep } from "../../wait";
import { workspaceScope } from "../../workspace";

interface CaptureResult {
  sourceId: string;
  status: string;
}

const KINDS = ["web", "chat_export", "highlight"];
const TERMINAL = new Set(["compiled", "failed", "held"]);
const POLL_MS = 2000;
const WAIT_TIMEOUT_MS = 60_000;

// --file support is scoped to text-native formats — these decode straight to
// raw.md server-side with no AI call. Must match ingest-binary.ts's
// FILE_MIME_ALLOWLIST.
const MIME_FOR_EXT: Record<string, string> = {
  ".txt": "text/plain",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
};

interface CaptureOptions {
  kind?: string;
  url?: string;
  title?: string;
  folder?: string;
  wait?: boolean;
  file?: string;
}

export function registerMemoryCapture(program: Command): void {
  program
    .command("capture")
    .description(
      "Capture text or a file into your knowledge base (compiles asynchronously)",
    )
    .argument(
      "[text]",
      "text to capture; if omitted (and --file isn't set), reads stdin",
    )
    // No commander default: defaulting in code below is what lets --file tell
    // "the user asked for a kind" apart from "nobody said anything".
    .option(
      "--kind <kind>",
      "web | chat_export | highlight (text captures only; defaults to web)",
    )
    .option("--url <url>", "origin URL")
    .option("--title <title>", "title")
    .option("--folder <uuid>", "target folder id (omit for root)")
    .option(
      "--file <path>",
      "capture a text-native file (.txt/.md/.csv/.json/.log) instead of text",
    )
    .option("--wait", "block until compilation finishes")
    .action(
      async (
        textArg: string | undefined,
        options: CaptureOptions,
        command: Command,
      ) => {
        const { ctx, workspaceId } = await workspaceScope(command);

        const result = options.file
          ? await captureFile(ctx.client, workspaceId, options)
          : await captureText(ctx.client, workspaceId, textArg, options);

        if (!options.wait) {
          if (ctx.globals.json) printJson(result);
          else {
            printLine(
              `Captured (${result.status}). id ${result.sourceId} — check with \`nimbase memory captures get ${result.sourceId}\`.`,
            );
          }
          return;
        }

        const final = await waitForCompile(
          ctx.client,
          workspaceId,
          result.sourceId,
        );
        if (ctx.globals.json) printJson(final);
        else printLine(`Source ${final.status}. id ${final.id}`);
        if (final.status === "failed") {
          throw new CliError(final.error ?? "compilation failed", 1);
        }
      },
    );
}

function assertValidKind(kind: string): void {
  if (!KINDS.includes(kind)) {
    throw usageError(`--kind must be one of: ${KINDS.join(", ")}`);
  }
}

async function captureText(
  client: ApiClient,
  workspaceId: string,
  textArg: string | undefined,
  options: CaptureOptions,
): Promise<CaptureResult> {
  const text = (textArg ?? "").trim() || (await readStdin()).trim();
  if (!text) {
    throw usageError("Nothing to capture (pass text or pipe stdin)");
  }
  const kind = options.kind ?? "web";
  assertValidKind(kind);

  return client.request<CaptureResult>("POST", "/api/ingest", {
    body: {
      workspaceId,
      kind,
      sourceUrl: options.url,
      title: options.title,
      text,
      targetFolderId: options.folder,
    },
  });
}

// Presigned three-phase upload — mirrors the extension's ingestBinaryArtifact:
// presign → PUT the bytes straight to S3 → finalize (enqueues extraction).
async function captureFile(
  client: ApiClient,
  workspaceId: string,
  options: CaptureOptions,
): Promise<CaptureResult> {
  const path = options.file;
  if (!path) throw new CliError("Internal error: missing --file path", 1);
  // A file's kind is derived from its MIME type server-side, so `--kind` cannot
  // take effect here. Say so rather than accepting the flag and dropping it.
  if (options.kind !== undefined) {
    throw usageError(
      "--kind does not apply to --file captures; the kind is derived from the file type.",
    );
  }
  const filename = basename(path);
  const mimeType = MIME_FOR_EXT[extname(path).toLowerCase()];
  if (!mimeType) {
    throw usageError(
      `Unsupported file type "${extname(path)}" — capture only supports text-native files (.txt/.md/.csv/.json/.log).`,
    );
  }
  const bytes = await readFileOrExplain(path);

  const presign = await client.request("POST", "/api/ingest/presign", {
    body: {
      workspaceId,
      kind: "file",
      mimeType,
      title: options.title ?? filename,
      sourceUrl: options.url,
      sizeBytes: bytes.byteLength,
      targetFolderId: options.folder,
      originalFilename: filename,
    },
    schema: presignResponseSchema,
  });

  const putRes = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: { "content-type": mimeType },
    body: bytes,
  });
  if (!putRes.ok) throw new CliError(`Upload failed (${putRes.status}).`, 1);

  return client.request("POST", "/api/ingest/finalize", {
    body: { workspaceId, sourceId: presign.sourceId },
    schema: finalizeResponseSchema,
  });
}

/**
 * Turn a filesystem failure into something a user can act on. Node's raw
 * `ENOENT: no such file or directory, open '...'` was reaching the terminal.
 */
async function readFileOrExplain(path: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code === "ENOENT") throw notFound(`No such file: ${path}`);
    if (code === "EACCES")
      throw usageError(`Permission denied reading ${path}`);
    if (code === "EISDIR") {
      throw usageError(`${path} is a directory, not a file`);
    }
    throw error;
  }
}

/**
 * Poll the single source by id rather than scanning `GET /api/sources`: that
 * list is paginated, so a busy workspace could push a fresh capture off the
 * first page and time this out even though compilation had finished.
 */
async function waitForCompile(
  client: ApiClient,
  workspaceId: string,
  sourceId: string,
): Promise<SourceDetail> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    const source = await client.request("GET", `/api/sources/${sourceId}`, {
      query: { workspaceId },
      schema: sourceDetailSchema,
      notFound: `Capture ${sourceId} disappeared while waiting for it to compile.`,
    });
    if (TERMINAL.has(source.status)) return source;
    if (Date.now() > deadline) {
      throw new CliError("Timed out waiting for compilation", 1);
    }
    await sleep(POLL_MS);
  }
}
