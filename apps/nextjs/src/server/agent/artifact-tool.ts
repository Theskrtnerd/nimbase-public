import "server-only";

import type { ToolSet } from "ai";
import { tool } from "ai";
import { z } from "zod/v4";

import type { PathScope } from "@acme/db";
import type { ArtifactVisibility } from "@acme/db/schema";

import type { AttachmentSink } from "./attachments";
import type { ArtifactOutput } from "~/server/artifact/output-mode";
import {
  authorArtifact,
  CREATE_ARTIFACT_DESCRIPTION,
  CREATE_ARTIFACT_OUTPUT_DESCRIPTION,
  CREATE_ARTIFACT_PROMPT_DESCRIPTION,
} from "~/server/artifact/authoring";
import { ARTIFACT_OUTPUTS } from "~/server/artifact/output-mode";

// The authoring core (create → poll → chat-ready message) is shared with the
// group MCP endpoint; re-exported here so existing importers and tests keep
// their entry point.
export {
  BARE_LINK_RULE,
  waitForArtifact,
  type ArtifactWaitResult,
} from "~/server/artifact/authoring";

export interface AgentArtifactOptions {
  workspaceId: string;
  // The agent's anchor — where the artifact is filed, mirroring MCP's targetPath.
  targetFolderId: string | null;
  // The agent's own read scopes, snapshotted to fence the generator's KB reads.
  // The artifact can therefore never read more of the wiki than the agent itself.
  readScopes: PathScope[];
  visibility: ArtifactVisibility;
  // Where a rendered file is left for the platform post. Omitted on platforms
  // that cannot upload, which collapses `output` to `link` there.
  attachments?: AttachmentSink;
}

/**
 * The agent's one write tool: build an artifact and return a link that already
 * resolves.
 *
 * Deliberately narrower than the MCP `create_artifact`: no workspace, folder,
 * kind, theme, or visibility arguments. Everything that decides *exposure* is
 * fixed by the agent's admin-set configuration, so a prompt in a Slack channel
 * can choose what the artifact says but never who can see it.
 */
export function agentArtifactTools(opts: AgentArtifactOptions): ToolSet {
  return {
    create_artifact: tool({
      description: CREATE_ARTIFACT_DESCRIPTION,
      inputSchema: z.object({
        prompt: z
          .string()
          .min(1)
          .max(4000)
          .describe(CREATE_ARTIFACT_PROMPT_DESCRIPTION),
        output: z
          .enum(ARTIFACT_OUTPUTS as [string, ...string[]])
          .optional()
          .describe(CREATE_ARTIFACT_OUTPUT_DESCRIPTION),
      }),
      execute: ({ prompt, output }) =>
        authorArtifact(
          prompt,
          {
            workspaceId: opts.workspaceId,
            targetFolderId: opts.targetFolderId,
            readScopes: opts.readScopes,
            visibility: opts.visibility,
            attachments: opts.attachments,
          },
          { output: output as ArtifactOutput | undefined },
        ),
    }),
  };
}
