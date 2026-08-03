import type { LucideIcon } from "lucide-react";
import { BookOpenIcon, BotIcon, KeyIcon, ServerIcon } from "lucide-react";

import type { RouterOutputs } from "@acme/api";

import type { StatusTone } from "./table-primitives";

/**
 * A *consumer* is anything non-human that has been deployed against company
 * memory: an agent, a group MCP endpoint, a docs site, or an API token. Agent
 * interfaces such as Slack and Widget render as deployments on the Agent row.
 * This module owns the union and its projection into a common row shape.
 *
 * Human principals (members, groups) are deliberately NOT consumers — they live
 * in the Permissions tab, on the folder they were granted.
 */
export type ConsumerKind = "agent" | "mcp" | "token" | "docsite";

export type { StatusTone } from "./table-primitives";

/**
 * Where a consumer is actually reachable from. For an agent these are its
 * interface installs (`AgentConnection`). MCP endpoints and tokens have no
 * deployment target beyond their own URL, so they carry an empty list.
 */
export interface Deployment {
  label: string;
  /** `broken` renders with the warn intensity — an install that needs attention. */
  tone: "ok" | "broken";
}

/**
 * What a consumer can actually *do* against memory, collapsed to the three
 * capability buckets the table shows. Deliberately coarser than the underlying
 * tool names — a row answers "can this thing read / write / build UI", not
 * "which of the eight MCP tools is enabled".
 *
 * - `view`    — read tools: search, get_note, list_sources
 * - `capture` — the capture tool, the only write path into memory today
 * - `artifact`  — create_artifact, get_artifact, set_artifact_access
 */
export const CONSUMER_TOOLS = ["view", "capture", "artifact"] as const;
export type ConsumerTool = (typeof CONSUMER_TOOLS)[number];

export const TOOL_LABEL: Record<ConsumerTool, string> = {
  view: "View",
  capture: "Capture",
  artifact: "Artifacts",
};

export const TOOL_HINT: Record<ConsumerTool, string> = {
  view: "Read memory — search, fetch notes, list sources",
  capture: "Write memory — capture new sources",
  artifact: "Generate and serve artifacts",
};

// Display only, with a raw-value fallback at the call site — a legacy row on a
// platform no longer offered still renders readably.
const PLATFORM_LABEL: Record<string, string> = {
  slack: "Slack",
  teams: "Teams",
  discord: "Discord",
  widget: "Website widget",
};

export interface ConsumerRow {
  id: string;
  kind: ConsumerKind;
  name: string;
  /** Second line under the name — slug, public key, memory scope, etc. */
  subtitle: string | null;
  /** Folder path this consumer is anchored to. "" = workspace root. */
  scope: string;
  /** Capabilities this consumer holds, always a subset of `CONSUMER_TOOLS`. */
  tools: ConsumerTool[];
  statusLabel: string;
  statusTone: StatusTone;
  /** Sort key for the activity column; null sorts last. */
  activityAt: Date | null;
  activityLabel: string;
  deployments: Deployment[];
}

export const KIND_LABEL: Record<ConsumerKind, string> = {
  agent: "Agent",
  mcp: "Group MCP",
  token: "API token",
  docsite: "Docs site",
};

export const KIND_ICON: Record<ConsumerKind, LucideIcon> = {
  agent: BotIcon,
  mcp: ServerIcon,
  token: KeyIcon,
  docsite: BookOpenIcon,
};

/** Folder paths render as `/eng/docs`; the root renders as a word, not `/`. */
export function scopeLabel(path: string): string {
  return path === "" ? "All memory" : `/${path}`;
}

function relative(date: Date | null): string {
  if (!date) return "—";
  const ms = Date.now() - date.getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

type AgentRow = RouterOutputs["agent"]["list"][number];
type McpRow = RouterOutputs["groupMcp"]["list"][number];
type DocSiteListRow = RouterOutputs["docSite"]["list"][number];

export function agentToRow(a: AgentRow): ConsumerRow {
  return {
    id: a.id,
    kind: "agent",
    name: a.name,
    subtitle: null,
    scope: a.targetPath,
    // Agents are the full-surface principal: they read, capture, and build
    // artifactes. There is no per-agent tool allowlist yet — when one lands, read
    // it here instead of asserting the whole set.
    tools: ["view", "capture", "artifact"],
    statusLabel: a.enabled ? "Active" : "Disabled",
    statusTone: a.enabled ? "active" : "idle",
    activityAt: a.updatedAt,
    activityLabel: relative(a.updatedAt),
    deployments: a.deployments.map((d) => ({
      label: PLATFORM_LABEL[d.platform] ?? d.platform,
      tone: d.status === "active" ? ("ok" as const) : ("broken" as const),
    })),
  };
}

export function mcpToRow(m: McpRow): ConsumerRow {
  // Group MCP carries a real allowlist, and it is the whole story: the
  // endpoint registers exactly these tools, so the row reads straight off it.
  const tools: ConsumerTool[] = ["view"];
  if (m.tools.includes("capture")) tools.push("capture");
  if (m.tools.includes("create_artifact")) tools.push("artifact");
  return {
    id: m.id,
    kind: "mcp",
    name: m.name,
    subtitle: m.slug,
    scope: m.folderPath,
    tools,
    statusLabel: m.enabled ? "Enabled" : "Paused",
    statusTone: m.enabled ? "active" : "idle",
    activityAt: null,
    activityLabel: `${m.tools.length} tool${m.tools.length === 1 ? "" : "s"}`,
    deployments: [],
  };
}

export function docSiteToRow(d: DocSiteListRow): ConsumerRow {
  // A docs site is a consumer in the literal sense: it reads a memory slice and
  // republishes it, and its /llms.txt makes the result agent-readable too.
  // Mapped into the existing three-tone vocabulary rather than extending it —
  // StatusTone is shared with the monochrome badges (DESIGN.md §6/§7), so a new
  // tone would ripple through every table.
  const label: Record<
    string,
    { text: string; tone: ConsumerRow["statusTone"] }
  > = {
    live: { text: "Live", tone: "active" },
    building: { text: "Building", tone: "idle" },
    failed: { text: "Failed", tone: "warn" },
    draft: { text: "Not published", tone: "idle" },
  };
  const status = label[d.status] ?? { text: d.status, tone: "idle" as const };

  return {
    id: d.slug,
    kind: "docsite",
    name: d.name,
    subtitle: d.folderPath.length > 0 ? d.folderPath : "Whole KB",
    scope: d.folderPath,
    // Read-only by construction: a published site never writes back to memory.
    tools: ["view"],
    statusLabel: status.text,
    statusTone: status.tone,
    activityAt: d.lastBuiltAt,
    activityLabel: d.lastBuiltAt ? relative(d.lastBuiltAt) : "Never published",
    deployments: [
      {
        label: d.visibility === "public" ? "Public" : "Workspace readers",
        tone: "ok" as const,
      },
    ],
  };
}

interface TokenListRow {
  id: string;
  label: string;
  role: string;
  folderPath: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export function tokenToRow(t: TokenListRow): ConsumerRow {
  const expired = t.expiresAt !== null && t.expiresAt.getTime() < Date.now();
  return {
    id: t.id,
    kind: "token",
    name: t.label,
    subtitle: null,
    scope: t.folderPath,
    // Token roles are clamped to viewer/contributor at mint time, and the
    // shared MCP transport gives a token principal KB tools only — so a token
    // is read, plus capture at contributor. A token bound to a group MCP
    // endpoint can reach that endpoint's artifact tool, but that capability
    // belongs to the endpoint and is shown on its own row.
    tools: expired ? [] : t.role === "viewer" ? ["view"] : ["view", "capture"],
    statusLabel: expired
      ? "Expired"
      : t.expiresAt
        ? `Expires ${t.expiresAt.toLocaleDateString()}`
        : "Active",
    statusTone: expired ? "warn" : "active",
    activityAt: t.lastUsedAt,
    activityLabel: t.lastUsedAt ? relative(t.lastUsedAt) : "never used",
    deployments: [],
  };
}
