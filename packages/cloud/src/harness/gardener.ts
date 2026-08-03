import "server-only";

import type { PathScope } from "@acme/db";

import type { GardenerResult } from "../memory/wiki/gardener";
import { GardenerError } from "../memory/wiki/gardener";
import { gardenerContextBlocks } from "../memory/wiki/gardener-context";
import { GardenerFs } from "../memory/wiki/vfs";
import { kbSearchTool, resolveHarnessModel, runHarnessAgent } from "./bindings";
import { buildHarnessMounts } from "./run";
import { gardenerDomainTools } from "./tools";
import { WikiFileSystem } from "./wiki-file-system";

const GARDENER_TIMEOUT_MS = 240_000;

// Harness twin of runGardener (same inputs minus the pre-resolved model, same
// GardenerResult contract including recorded ops), selected by the
// NIMBASE_HARNESS_SURFACES=gardener flag in wiki-pg-provider.reconcile. The
// wiki is the sandbox filesystem, so Pi's built-in file tools (and bash) edit
// notes directly through the fenced GardenerFs; domain metadata stays on
// custom tools.
export async function runGardenerHarness(args: {
  workspaceId: string;
  sourceId: string;
  jobId: string;
  sourceKind: string;
  sourceTitle: string | null;
  rawText: string;
  fence: PathScope;
  // Standing company context (company.md, tended by the Biographer) — same
  // injection as the legacy runner; null for workspaces without one.
  companyContext?: string | null;
}): Promise<GardenerResult> {
  const gardenerFs = new GardenerFs(
    args.workspaceId,
    args.sourceId,
    args.jobId,
    [args.fence],
  );
  const wikiFs = WikiFileSystem.readWrite(gardenerFs);
  await wikiFs.prime();
  const { fs } = buildHarnessMounts(wikiFs);

  const model = await resolveHarnessModel(args.workspaceId);
  const prompt = `<source kind="${args.sourceKind}" title="${args.sourceTitle ?? ""}">\n${args.rawText}\n</source>\n\nIntegrate this source into the wiki at /wiki.`;

  try {
    const result = await runHarnessAgent({
      agent: "gardener",
      fs,
      model,
      tools: {
        ...kbSearchTool({
          workspaceId: args.workspaceId,
          scopes: [args.fence],
        }),
        ...gardenerDomainTools(gardenerFs),
      },
      instructionsExtra: gardenerContextBlocks({
        companyContext: args.companyContext,
        fencePrefix: args.fence.prefix,
        // Pi mounts the wiki here, so the fence notice must name the same
        // paths the agent's own filesystem tools report.
        mountPrefix: "/wiki/",
      }),
      prompt,
      timeoutMs: GARDENER_TIMEOUT_MS,
      trace: {
        name: "compile-gardener",
        workspaceId: args.workspaceId,
        metadata: {
          sourceId: args.sourceId,
          jobId: args.jobId,
        },
      },
    });

    return {
      report: result.text,
      usage: result.usage,
      ops: gardenerFs.ops(),
    };
  } catch (err) {
    // No per-step text is observable through the harness, so the partial
    // report is empty — the ops the FS recorded before the failure still
    // stand in the wiki's version history.
    throw new GardenerError(
      err instanceof Error ? err.message : String(err),
      "",
    );
  }
}
