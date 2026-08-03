import "server-only";

import { generateText, isStepCount } from "ai";

import type { ArtifactGenerateJobData } from "@acme/cloud";
import { costFor, resolveModels, s3, traceGeneration } from "@acme/cloud";
import {
  buildHarnessMounts,
  harnessEnabledFor,
  kbSearchTool,
  resolveHarnessModel,
  runHarnessAgent,
  WikiFileSystem,
} from "@acme/cloud/harness";
import { readTools, WikiReadFs } from "@acme/cloud/memory/wiki";
import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { Artifact, SpendLedger } from "@acme/db/schema";

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

// Bound the agentic exploration. The Claude call dominates; these caps sit well
// inside the route's 300s ceiling.
const ARTIFACT_MAX_STEPS = 12;
const ARTIFACT_MAX_TOTAL_TOKENS = 100_000;
// A full artifact component routinely runs 400+ lines. At 8k the model was
// hitting the ceiling mid-expression and the truncated file failed to parse as
// a bogus "transpile_failed" syntax error.
const ARTIFACT_MAX_OUTPUT_TOKENS = 16_000;
// How many times the model gets to see its own build error and try again. Two
// is enough for a syntax slip or a truncation retry; beyond that the prompt is
// usually asking for something the sandbox can't express.
const ARTIFACT_MAX_REPAIR_ATTEMPTS = 2;
// Harness runs are capped by wall clock instead (Pi owns its inner loop),
// inside the route's 300s ceiling.
const ARTIFACT_HARNESS_TIMEOUT_MS = 240_000;

/**
 * The artifact generation job: run an agentic loop with read-only KB tools fenced
 * to the creator/deployment's snapshotted read scopes, take the final message as the artifact,
 * build/upload it, then flip the Artifact row to "draft". On any failure the row
 * is marked "failed" (keeping a previous artifact, if one exists, intact) and
 * the error is rethrown so QStash retries.
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

    let raw: string;
    let modelIdForCost: string;
    let usage: { inputTokens: number; outputTokens: number };
    // Whether the first attempt ran out of output budget rather than finishing.
    // The repair turn needs to know: a truncated file needs to be made shorter,
    // not syntactically patched at the seam.
    let truncated = false;

    if (harnessEnabledFor("artifact")) {
      // Pi-harness runner: the KB is the sandbox filesystem (read-only at
      // /wiki) and the artifact is a file the agent writes to /output, read
      // back after the turn (final message text as fallback).
      const wikiFs = WikiFileSystem.readOnly(
        new WikiReadFs(workspaceId, readScopes),
      );
      await wikiFs.prime();
      const mounts = buildHarnessMounts(wikiFs);
      const model = await resolveHarnessModel(workspaceId);
      const outputPath =
        data.kind === "fixed"
          ? "/output/artifact.tsx"
          : "/output/artifact.html";
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
      raw = stripCodeFence((await mounts.readOutput(outputPath)) ?? run.text);
      modelIdForCost = model.modelId;
      usage = run.usage;
    } else {
      const fs = new WikiReadFs(workspaceId, readScopes);
      const tools = readTools(fs, {
        workspaceId,
        scopes: readScopes ?? undefined,
      });
      const { chat } = await resolveModels(workspaceId);
      const result = await traceGeneration(
        {
          name: "artifact-generate",
          workspaceId,
          role: "chat",
          modelId: chat.id,
          input: userPrompt,
          metadata: { artifactId, kind: data.kind },
        },
        () =>
          generateText({
            model: chat.model,
            instructions,
            prompt: userPrompt,
            tools,
            maxOutputTokens: ARTIFACT_MAX_OUTPUT_TOKENS,
            stopWhen: [
              isStepCount(ARTIFACT_MAX_STEPS),
              ({ steps }) =>
                steps.reduce((n, s) => n + (s.usage.totalTokens ?? 0), 0) >
                ARTIFACT_MAX_TOTAL_TOKENS,
            ],
          }),
      );
      raw = stripCodeFence(result.text);
      truncated = result.finishReason === "length";
      modelIdForCost = chat.id;
      usage = {
        inputTokens: result.totalUsage.inputTokens ?? 0,
        outputTokens: result.totalUsage.outputTokens ?? 0,
      };
    }

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
              maxOutputTokens: ARTIFACT_MAX_OUTPUT_TOKENS,
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
