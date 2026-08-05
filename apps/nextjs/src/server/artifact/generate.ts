import "server-only";

import { generateText } from "ai";

import type { ArtifactGenerateJobData } from "@acme/runtime/queue";
import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { Artifact, SpendLedger } from "@acme/db/schema";
import { costFor, resolveModels, traceGeneration } from "@acme/runtime/ai";
import {
  buildHarnessMounts,
  kbSearchTool,
  resolveHarnessModel,
  runHarnessAgent,
  WikiFileSystem,
} from "@acme/runtime/harness";
import { WikiReadFs } from "@acme/runtime/memory/wiki";
import * as s3 from "@acme/runtime/s3";

import type { BuiltArtifact } from "./build-artifact";
import {
  ARTIFACT_FIXED_SYSTEM,
  ARTIFACT_FREEFORM_SYSTEM,
  ARTIFACT_KB_GUIDANCE,
  themeInstruction,
} from "~/server/share/artifact-prompts";
import { stripCodeFence } from "~/server/share/sanitize";
import {
  ArtifactArtifactError,
  artifactRepairPrompt,
  buildArtifactArtifact,
} from "./build-artifact";

// A repaired artifact can still run 400+ lines. Keep enough room to replace a
// truncated first attempt without cutting the repair off at the same seam.
const ARTIFACT_REPAIR_MAX_OUTPUT_TOKENS = 16_000;
// How many times the model gets to see its own build error and try again. Two
// is enough for a syntax slip or a truncation retry; beyond that the prompt is
// usually asking for something the sandbox can't express.
const ARTIFACT_MAX_REPAIR_ATTEMPTS = 2;
// Harness runs are capped by wall clock instead (Pi owns its inner loop),
// inside the route's 300s ceiling.
const ARTIFACT_HARNESS_TIMEOUT_MS = 240_000;

/**
 * The artifact generation job: run the artifact harness with a read-only KB
 * fenced to the creator/deployment's snapshotted read scopes, read its output
 * file (or final message fallback), build/upload it, then flip the Artifact row
 * to "draft". On any failure the row is marked "failed" (keeping a previous
 * artifact, if one exists, intact) and the error is rethrown so QStash retries.
 */
export async function processArtifactGenerateJob(
  data: ArtifactGenerateJobData,
): Promise<void> {
  const { artifactId, workspaceId } = data;
  try {
    const readScopes = data.readScopes ?? null;
    // "app" theme, or "custom" with a blank description, uses the app's design
    // tokens. Resolve it once so the prompt and the sandbox agree.
    const useAppTheme =
      data.themeMode === "app" || !data.themeDescription?.trim();
    const instructions = `${
      data.kind === "fixed" ? ARTIFACT_FIXED_SYSTEM : ARTIFACT_FREEFORM_SYSTEM
    }\n\n${ARTIFACT_KB_GUIDANCE}`;
    const userPrompt = `${data.prompt ?? "Create a clean interface."}\n\n${themeInstruction(data.themeMode, data.themeDescription)}`;

    // Pi-harness runner: the KB is the sandbox filesystem (read-only at /wiki)
    // and the artifact is a file the agent writes to /output, read back after
    // the turn (final message text as fallback).
    const wikiFs = WikiFileSystem.readOnly(
      new WikiReadFs(workspaceId, readScopes),
    );
    await wikiFs.prime();
    const mounts = buildHarnessMounts(wikiFs);
    const model = await resolveHarnessModel(workspaceId);
    const outputPath =
      data.kind === "fixed" ? "/output/artifact.tsx" : "/output/artifact.html";
    const run = await runHarnessAgent({
      agent: "artifact",
      fs: mounts.fs,
      model,
      tools: kbSearchTool({
        workspaceId,
        scopes: readScopes ?? undefined,
      }),
      prompt: `Output mode: ${data.kind} — write the artifact to ${outputPath}.\n\n${userPrompt}`,
      timeoutMs: ARTIFACT_HARNESS_TIMEOUT_MS,
      trace: {
        name: "artifact-generate",
        workspaceId,
        metadata: { artifactId, kind: data.kind },
      },
    });
    let raw = stripCodeFence((await mounts.readOutput(outputPath)) ?? run.text);
    const modelIdForCost = model.modelId;
    const usage = run.usage;
    // Pi does not expose a first-turn finish reason through the harness result.
    // Repair calls below do, so subsequent attempts can distinguish truncation
    // from a syntax error at the seam.
    let truncated = false;

    if (!raw.trim()) {
      throw new Error(
        "empty_output: model finished without producing an artifact",
      );
    }

    // Build, and on a failure the model could plausibly fix, hand it the error
    // and let it try again. Repair turns are deliberately tool-free: the model
    // already gathered its KB context on the first pass, and re-running the
    // agentic loop to fix a stray brace would cost more than the artifact did.
    let built: BuiltArtifact | null = null;
    let repairCents = 0;
    for (let attempt = 0; ; attempt++) {
      try {
        built = buildArtifactArtifact(raw, { kind: data.kind, useAppTheme });
        break;
      } catch (err) {
        if (
          !(err instanceof ArtifactArtifactError) ||
          attempt >= ARTIFACT_MAX_REPAIR_ATTEMPTS
        ) {
          throw err;
        }
        const { chat } = await resolveModels(workspaceId);
        const repair = await traceGeneration(
          {
            name: "artifact-repair",
            workspaceId,
            role: "chat",
            modelId: chat.id,
            input: err.message,
            metadata: { artifactId, kind: data.kind, attempt: attempt + 1 },
          },
          () =>
            generateText({
              model: chat.model,
              instructions,
              prompt: artifactRepairPrompt({
                kind: data.kind,
                source: raw,
                error: err,
                truncated,
              }),
              maxOutputTokens: ARTIFACT_REPAIR_MAX_OUTPUT_TOKENS,
            }),
        );
        raw = stripCodeFence(repair.text);
        truncated = repair.finishReason === "length";
        repairCents += costFor(chat.id, {
          inputTokens: repair.totalUsage.inputTokens ?? 0,
          outputTokens: repair.totalUsage.outputTokens ?? 0,
        });
        if (!raw.trim()) {
          throw err;
        }
      }
    }
    const { html, source } = built;

    const htmlKey = s3.s3KeyFor.artifactHtml(workspaceId, artifactId);
    const sourceKey =
      source !== null
        ? s3.s3KeyFor.artifactSource(workspaceId, artifactId)
        : null;
    await Promise.all([
      s3.putObject(htmlKey, html, "text/html"),
      source !== null && sourceKey
        ? s3.putObject(sourceKey, source, "text/plain")
        : Promise.resolve(),
    ]);

    await db
      .update(Artifact)
      .set({
        status: "draft",
        error: null,
        s3KeyHtml: htmlKey,
        s3KeySource: sourceKey,
        updatedAt: new Date(),
      })
      .where(
        and(eq(Artifact.id, artifactId), eq(Artifact.workspaceId, workspaceId)),
      );

    const cents = costFor(modelIdForCost, usage) + repairCents;
    await db
      .insert(SpendLedger)
      .values({ workspaceId, kind: "artifact", cents });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(Artifact)
      .set({ status: "failed", error: message, updatedAt: new Date() })
      .where(
        and(eq(Artifact.id, artifactId), eq(Artifact.workspaceId, workspaceId)),
      );
    throw err;
  }
}
