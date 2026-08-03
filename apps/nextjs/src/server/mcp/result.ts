export interface ToolResult {
  [x: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export function jsonResult(summary: string, data: unknown): ToolResult {
  return {
    content: [
      { type: "text", text: `${summary}\n\n${JSON.stringify(data, null, 2)}` },
    ],
  };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

// Map known internal errors to agent-actionable messages.
export function toErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : "Unknown error";
  if (msg === "Workspace not found") {
    return "Workspace not found or not owned by you. Call list_workspaces to see valid workspace IDs.";
  }
  if (msg === "Note not found" || msg === "Note version not found") {
    return "Note not found in this workspace. Use search to find a valid nodeId.";
  }
  return msg;
}
