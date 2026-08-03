import "server-only";

import { generateText, isStepCount } from "ai";
import { z } from "zod/v4";

import type { PathScope } from "@acme/db";
import type { GroupMcpTool } from "@acme/db/schema";
import { resolveModels, traceGeneration } from "@acme/cloud";
import { readTools, WikiReadFs } from "@acme/cloud/memory/wiki";
import { GROUP_MCP_TOOLS } from "@acme/db/schema";
import { slugifyName } from "@acme/db/slug";

// Turns an admin's free-text prompt into a pre-filled group-MCP `create`
// payload by running the same agentic read-only KB loop as the Artifact
// generator (`~/server/artifact/generate.ts`), fenced to the admin's own viewer
// scopes. Synchronous — no job queue, this is a quick exploratory pass capped
// at MAX_STEPS.
const PROPOSAL_SCHEMA = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(120),
  instructions: z.string().min(1).max(4000),
  folderPath: z.string().max(512),
  tools: z.array(z.enum(GROUP_MCP_TOOLS)).min(1),
});

const MAX_STEPS = 10;

export async function proposeGroupMcpFromPrompt(args: {
  workspaceId: string;
  prompt: string;
  readScopes: PathScope[] | null;
}): Promise<{
  slug: string;
  name: string;
  instructions: string;
  folderPath: string;
  tools: GroupMcpTool[];
}> {
  const fs = new WikiReadFs(args.workspaceId, args.readScopes);
  const tools = readTools(fs, {
    workspaceId: args.workspaceId,
    scopes: args.readScopes ?? undefined,
  });
  const { chat } = await resolveModels(args.workspaceId);

  const instructions = [
    "You configure a scoped MCP endpoint over a company knowledge base.",
    "Explore the KB with the read tools to find the folder that best matches",
    "the admin's described use-case. Then output ONLY a JSON object with keys:",
    'name, slug, instructions, folderPath, tools. "folderPath" must be an',
    'existing folder path you saw in the tree (or "" for the whole workspace).',
    '"instructions" explains this endpoint\'s purpose and expected behavior.',
    `"tools" is a subset of ${JSON.stringify(GROUP_MCP_TOOLS)}; default to`,
    '["search","get_note","list_sources"] unless the prompt implies writing.',
    "Output the JSON only, no prose.",
  ].join(" ");

  const result = await traceGeneration(
    {
      name: "group-mcp-propose",
      workspaceId: args.workspaceId,
      role: "chat",
      modelId: chat.id,
      input: args.prompt,
      metadata: {},
    },
    () =>
      generateText({
        model: chat.model,
        instructions,
        prompt: args.prompt,
        tools,
        maxOutputTokens: 4000,
        stopWhen: [isStepCount(MAX_STEPS)],
      }),
  );

  const jsonText = extractJson(result.text);
  const parsed = PROPOSAL_SCHEMA.parse(JSON.parse(jsonText));
  const slug = slugifyName(parsed.slug) || slugifyName(parsed.name) || "group";
  return {
    slug,
    name: parsed.name,
    instructions: parsed.instructions,
    folderPath: parsed.folderPath.trim(),
    tools: parsed.tools,
  };
}

// The model may fence the JSON in ```; take the outermost {...}.
function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("model did not return a JSON object");
  }
  return text.slice(start, end + 1);
}
