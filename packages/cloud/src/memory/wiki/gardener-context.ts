// The per-compile context blocks appended to the gardener's standing
// instructions: standing company context and the fence notice. Shared by both
// runners — the legacy AI SDK loop (./gardener.ts) and the Pi harness twin
// (../../harness/gardener.ts) — because a compile must mean the same thing on
// either path.
//
// The one legitimate difference is where paths appear to live: the legacy
// runner's tools are wiki-relative, while the harness mounts the wiki at
// /wiki. That is the `mountPrefix` argument, not a reason to fork the text.

export interface GardenerContextArgs {
  // The workspace's own overview (company.md), when one exists.
  companyContext?: string | null;
  // The compile fence. "" = workspace root, i.e. no fence notice at all.
  fencePrefix: string;
  // Path prefix the agent sees. "" for the legacy runner, "/wiki/" for the
  // harness, whose filesystem mounts the wiki there.
  mountPrefix?: string;
}

/**
 * Build the context blocks in order, omitting the ones that do not apply.
 * Returns an array so each caller can join it the way its runner expects
 * (the legacy path concatenates onto the system prompt; the harness passes
 * them as `instructionsExtra`).
 */
export function gardenerContextBlocks(args: GardenerContextArgs): string[] {
  const mountPrefix = args.mountPrefix ?? "";
  return [
    args.companyContext
      ? `Standing company context — the workspace's own overview (company.md). Background for interpreting sources; do not restate it in notes you write:\n<company-context>\n${args.companyContext}\n</company-context>`
      : null,
    args.fencePrefix === ""
      ? null
      : `You are working inside the "${mountPrefix}${args.fencePrefix}/" section of the wiki. Every path you read or write lives under it; paths outside it do not exist for this task.`,
  ].filter((block): block is string => block !== null);
}
