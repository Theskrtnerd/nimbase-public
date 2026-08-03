import "server-only";

import type { PathScope } from "@acme/db";
import type { ArtifactVisibility } from "@acme/db/schema";
import { s3 } from "@acme/cloud";
import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { Artifact } from "@acme/db/schema";

import type { ArtifactOutput } from "./output-mode";
import type { AttachmentSink } from "~/server/agent/attachments";
import { createArtifact } from "./create-artifact";
import {
  attachmentFilename,
  attachmentMimeType,
  decideArtifactAttachment,
  explainRefusal,
} from "./output-mode";
import { renderArtifactArtifact, rendererAvailable } from "./render-client";

// `/s/<slug>` serves a "still building" placeholder while a artifact generates
// (app/s/[slug]/route.ts), so the link is never dead and authoring does not
// have to block for a whole generation to hand it back.
//
// What remains is a short grace wait: if the artifact lands within it, the model
// gets to say "ready" instead of "on its way". Missing it costs nothing but a
// slightly weaker sentence.
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 12_000;

// Attachments are the exception: a file needs the artifact's actual bytes, so
// that path really does have to wait for generation. Only reachable when the
// caller asked for a file *and* the artifact is public (see decideArtifactAttachment),
// and still sits under the caller's turn budget.
const ARTIFACT_POLL_TIMEOUT_MS = 90_000;

// Chat platforms autolink a bare URL themselves. Wrapping one in markdown
// emphasis breaks that: Slack's mrkdwn conversion leaves the `**` literal
// around the autolinked span, so the user sees `** <link> **`. Repeated in
// every tool result because the model reliably reaches for bold otherwise.
export const BARE_LINK_RULE =
  "Post the URL bare — no bold, italics, backticks, or markdown link syntax around it. The chat platform links it on its own.";

export interface ArtifactWaitResult {
  status: "draft" | "failed" | "timeout";
  error: string | null;
}

/**
 * Block until a artifact leaves `generating`. Split out from the tool bodies so
 * the terminal-state logic is testable without an AI SDK loop; `sleep` is
 * injected for the same reason.
 */
export async function waitForArtifact(
  artifactId: string,
  opts: {
    timeoutMs?: number;
    intervalMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<ArtifactWaitResult> {
  const timeoutMs = opts.timeoutMs ?? POLL_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
  const now = opts.now ?? (() => Date.now());
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const deadline = now() + timeoutMs;
  for (;;) {
    const [row] = await db
      .select({ status: Artifact.status, error: Artifact.error })
      .from(Artifact)
      .where(eq(Artifact.id, artifactId))
      .limit(1);
    if (!row) return { status: "failed", error: "artifact disappeared" };
    if (row.status === "draft") return { status: "draft", error: null };
    if (row.status === "failed") {
      return { status: "failed", error: row.error ?? "generation failed" };
    }
    if (now() >= deadline) return { status: "timeout", error: null };
    await sleep(intervalMs);
  }
}

/**
 * Everything that decides a artifact's *exposure*, fixed by admin configuration
 * rather than by the calling model. Shared by the two chat-side authoring
 * surfaces: the deployed agent (anchored to Agent.targetFolderId) and a group
 * MCP endpoint (anchored to its deployment folder).
 */
export interface ArtifactAuthoringConfig {
  workspaceId: string;
  // Where the artifact is filed — its permission anchor.
  targetFolderId: string | null;
  // Read fence for the person/agent/deployment path, snapshotted at enqueue.
  readScopes: PathScope[];
  visibility: ArtifactVisibility;
  /**
   * Where a rendered file is deposited for the platform post. Absent on
   * surfaces that cannot upload (Linear, and MCP callers that only take text),
   * which makes `link` the only reachable output there.
   */
  attachments?: AttachmentSink;
}

/**
 * Produce the requested file for a finished artifact and hand it to the sink.
 *
 * Returns a line for the model when the file could not be produced, so a
 * failed render degrades into "here's the link" rather than a silent omission
 * the model then lies about. Never throws: an attachment is a nicety on top of
 * a link that already works.
 */
async function attachArtifactFile(
  artifactId: string,
  title: string,
  output: ArtifactOutput,
  visibility: ArtifactVisibility,
  sink: AttachmentSink | undefined,
): Promise<string | null> {
  if (!sink) return null;

  const decision = decideArtifactAttachment({
    output,
    visibility,
    rendererAvailable: rendererAvailable(),
  });
  if (!decision.attach) return explainRefusal(decision.refusal);

  const [row] = await db
    .select({ s3KeyHtml: Artifact.s3KeyHtml })
    .from(Artifact)
    .where(eq(Artifact.id, artifactId))
    .limit(1);
  if (!row?.s3KeyHtml) {
    return "The file could not be produced. Share the link instead.";
  }

  try {
    const html = await s3.getObjectText(row.s3KeyHtml);
    const data =
      decision.format === "html"
        ? Buffer.from(html, "utf8")
        : await renderArtifactArtifact(html, decision.format);
    sink.add({
      data,
      filename: attachmentFilename(title, decision.format),
      mimeType: attachmentMimeType(decision.format),
    });
    return `The ${decision.format.toUpperCase()} is attached to this message. Mention it alongside the link.`;
  } catch (err) {
    console.error("[artifact] attachment failed:", err);
    return "The file could not be rendered. Share the link instead and say the file was not available.";
  }
}

/**
 * Create a artifact, block until it resolves, and return the chat-ready message.
 * Returns a string in every case — plan limits and generation failures are
 * something the model can say something useful about, so they are tool results
 * rather than throws.
 */
export async function authorArtifact(
  prompt: string,
  config: ArtifactAuthoringConfig,
  opts: { waitTimeoutMs?: number; output?: ArtifactOutput } = {},
): Promise<string> {
  const output = opts.output ?? "link";
  let created;
  try {
    created = await createArtifact(
      { prompt, visibility: config.visibility },
      {
        workspaceId: config.workspaceId,
        targetFolderId: config.targetFolderId,
        readScopes: config.readScopes,
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `error: could not start the artifact (${message}). Answer in the chat instead.`;
  }

  // Only a file needs the finished bytes; a link is useful immediately.
  const wantsFile =
    output !== "link" &&
    decideArtifactAttachment({
      output,
      visibility: config.visibility,
      rendererAvailable: rendererAvailable(),
    }).attach;

  const outcome = await waitForArtifact(created.id, {
    timeoutMs:
      opts.waitTimeoutMs ?? (wantsFile ? ARTIFACT_POLL_TIMEOUT_MS : undefined),
  });
  if (outcome.status === "failed") {
    return `error: the artifact failed to build (${outcome.error ?? "unknown"}). Answer in the chat instead.`;
  }
  if (outcome.status === "timeout") {
    // The link already resolves — it shows a "still building" page until the
    // artifact lands — so this is a real answer, not a dead end.
    return [
      `Artifact started: "${created.title}"`,
      `Link: ${created.url}`,
      "It is still rendering; the link shows a progress page and becomes the finished artifact on its own.",
      "Share the link now and say it will be ready in about a minute.",
      BARE_LINK_RULE,
    ]
      .filter(Boolean)
      .join("\n");
  }

  // Only after the artifact is `draft` — the artifact does not exist before then.
  const attachmentNote = await attachArtifactFile(
    created.id,
    created.title,
    output,
    config.visibility,
    config.attachments,
  );

  return [
    `Artifact ready: "${created.title}"`,
    `Link: ${created.url}`,
    config.visibility === "public"
      ? "Anyone with this link can open it."
      : "Only workspace members with access to this folder can open it.",
    attachmentNote,
    "Reply with the link.",
    BARE_LINK_RULE,
  ]
    .filter(Boolean)
    .join("\n");
}

// The one description both surfaces show the model. Kept here so the agent and
// the group MCP endpoint cannot drift into describing the same tool differently.
export const CREATE_ARTIFACT_DESCRIPTION =
  "Build a shareable visual page (charts, tables, dashboards) from the wiki and return its link. Use for requests like an analysis, report, breakdown, or dashboard — anything better seen than described. Research with the read tools first, then put the findings you want shown in the prompt. Takes ~30 seconds. After it returns, reply with the link.";

// Only offered on surfaces that can actually upload. Phrased around what the
// user asked for rather than what the platform supports, because the model
// cannot see which platform it is on.
export const CREATE_ARTIFACT_OUTPUT_DESCRIPTION =
  "How to deliver it. 'link' (default) posts a link that checks the reader's access — prefer it. Use 'html', 'png', or 'pdf' only when the user explicitly asked for a file or image. Non-public artifactes are always delivered as a link regardless.";

export const CREATE_ARTIFACT_PROMPT_DESCRIPTION =
  "What the page should show, including the concrete facts and figures you gathered from the wiki. Self-contained: the builder cannot see this conversation.";
