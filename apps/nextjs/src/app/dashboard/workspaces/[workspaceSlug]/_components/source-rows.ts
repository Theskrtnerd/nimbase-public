import type { LucideIcon } from "lucide-react";
import {
  FileTextIcon,
  GlobeIcon,
  HighlighterIcon,
  ImageIcon,
  MessageSquareIcon,
  MicIcon,
  VideoIcon,
} from "lucide-react";

import type { RouterOutputs } from "@acme/api";

import type { StatusTone } from "./table-primitives";
import { formatRelativeTime } from "~/lib/format-relative-time";

/**
 * Projection of a captured `Source` into the flat
 * shape the Sources table renders. Same contract as `consumer-rows.ts`: every
 * column reads a precomputed primitive, so the table does zero derivation.
 */
export type ApiSource = RouterOutputs["sources"]["list"][number];

export type SourceKind = ApiSource["kind"];
export type SourceStatus = ApiSource["status"];

/** Statuses still being worked on — drives the live-poll in the view. */
export const ACTIVE_STATUSES = new Set<SourceStatus>([
  "uploading",
  "extracting",
  "queued",
]);

export interface SourceRow {
  id: string;
  kind: SourceKind;
  /** Refined per row — a `chat_export` reads as Gmail/Slack/ChatGPT/etc. */
  kindLabel: string;
  icon: LucideIcon;
  title: string;
  /** Second line under the title — host, message count. */
  subtitle: string | null;
  /** Target folder path this source compiled into. "" = workspace root. */
  scope: string;
  capturedBy: string | null;
  status: SourceStatus;
  statusLabel: string;
  statusTone: StatusTone;
  /** Sort key for the Captured column. */
  capturedAt: Date;
  capturedLabel: string;
  compiledAt: Date | null;
  error: string | null;
  compileReport: string | null;
  /** The auth-gated original; null while the upload is still in flight. */
  rawUrl: string | null;
}

/** Generic per-kind label — the filter chips key off this, not the row label. */
export const KIND_LABEL: Record<SourceKind, string> = {
  web: "Web",
  chat_export: "Chat",
  highlight: "Highlight",
  screenshot: "Screenshot",
  voice: "Voice",
  video: "Video",
  file: "File",
};

export const KIND_ICON: Record<SourceKind, LucideIcon> = {
  web: GlobeIcon,
  chat_export: MessageSquareIcon,
  highlight: HighlighterIcon,
  screenshot: ImageIcon,
  voice: MicIcon,
  video: VideoIcon,
  file: FileTextIcon,
};

const STATUS_LABEL: Record<SourceStatus, string> = {
  uploading: "Uploading",
  extracting: "Extracting",
  queued: "Queued",
  held: "Permission held",
  compiled: "Compiled",
  failed: "Failed",
};

const STATUS_TONE: Record<SourceStatus, StatusTone> = {
  uploading: "idle",
  extracting: "idle",
  queued: "idle",
  held: "warn",
  compiled: "active",
  failed: "warn",
};

/** Folder paths render as `/eng/docs`; the root renders as a word, not `/`. */
export function scopeLabel(path: string): string {
  return path === "" ? "All memory" : `/${path}`;
}

/** Bare hostname (no leading "www.") for display, or null if URL is unusable. */
export function hostFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** `chat_export` provider is derived from the URL; every other kind is fixed. */
function kindLabelFor(kind: SourceKind, sourceUrl: string | null): string {
  if (kind !== "chat_export") return KIND_LABEL[kind];
  const host = hostFromUrl(sourceUrl) ?? "";
  if (isDomain(host, "chatgpt.com") || isDomain(host, "openai.com")) {
    return "ChatGPT";
  }
  if (isDomain(host, "claude.ai")) return "Claude";
  if (isDomain(host, "mail.google.com")) return "Gmail";
  if (isDomain(host, "slack.com")) return "Slack";
  return "Chat";
}

function isDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function sourceToRow(s: ApiSource): SourceRow {
  const host = hostFromUrl(s.sourceUrl);
  const messageCount = s.metadata?.messageCount ?? null;
  const capturedAt = new Date(s.capturedAt ?? s.createdAt);

  const subtitleParts = [
    host,
    s.kind === "highlight"
      ? "highlighted"
      : messageCount !== null
        ? `${String(messageCount)} messages`
        : null,
  ].filter((part): part is string => Boolean(part));

  return {
    id: s.id,
    kind: s.kind,
    kindLabel: kindLabelFor(s.kind, s.sourceUrl),
    icon: KIND_ICON[s.kind],
    title: s.title ?? host ?? s.originalFilename ?? "Untitled source",
    subtitle: subtitleParts.length > 0 ? subtitleParts.join(" · ") : null,
    scope: s.targetPath,
    capturedBy: s.capturedByName,
    status: s.status,
    statusLabel: STATUS_LABEL[s.status],
    statusTone: STATUS_TONE[s.status],
    capturedAt,
    capturedLabel: formatRelativeTime(capturedAt),
    compiledAt: s.compiledAt,
    error: s.error,
    compileReport: s.compileReport,
    rawUrl: s.status === "uploading" ? null : `/api/sources/${s.id}/raw`,
  };
}
