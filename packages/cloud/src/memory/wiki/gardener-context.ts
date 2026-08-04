// The per-compile context blocks appended to the gardener's standing
// instructions: standing company context and the fence notice.

export interface GardenerContextArgs {
  // The workspace's own overview (company.md), when one exists.
  companyContext?: string | null;
  // The compile fence. "" = workspace root, i.e. no fence notice at all.
  fencePrefix: string;
  // Path prefix the agent sees in the mounted harness filesystem.
  mountPrefix?: string;
}

/**
 * Build the context blocks in order, omitting the ones that do not apply.
 * Returns an array for the harness runner's `instructionsExtra`.
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
