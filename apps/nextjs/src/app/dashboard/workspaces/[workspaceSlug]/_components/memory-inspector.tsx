"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ClockIcon,
  FileTextIcon,
  FolderIcon,
  PanelRightCloseIcon,
  TagIcon,
  WaypointsIcon,
} from "lucide-react";

import type { RouterOutputs } from "@acme/api";

import { formatDate } from "~/lib/format-date";
import { formatRelativeTime } from "~/lib/format-relative-time";
import { useTRPC } from "~/trpc/react";
import { AccessBadge } from "./memory-status";

type Grant = RouterOutputs["access"]["listFolderAccess"]["grants"][number];
type NoteSource = RouterOutputs["kb"]["getNode"]["sources"][number];

const ROLE_LABEL: Record<Grant["role"], string> = {
  viewer: "Viewer",
  contributor: "Contributor",
  manager: "Manager",
};

interface RelatedMemory {
  nodeId: string;
  title: string;
}

/**
 * The memory inspector (DESIGN.md §9) — the right rail that turns a note from
 * a document into an inspectable, governed memory object. It surfaces where the
 * memory lives, how fresh it is, who is allowed to reach it (real folder grants
 * + the restricted boundary), and what it connects to. Every field is live
 * data; nothing is invented.
 */
export function MemoryInspector({
  workspaceId,
  path,
  updatedAt,
  summary,
  tags,
  sources,
  onSelectNote,
  onClose,
}: {
  workspaceId: string;
  path: string;
  updatedAt: Date | null;
  summary: string | null;
  tags: string[];
  sources: NoteSource[];
  onSelectNote: (nodeId: string) => void;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const segments = path.split("/").filter(Boolean);
  const folderPath = segments.slice(0, -1).join("/");

  const accessQ = useQuery(
    trpc.access.listFolderAccess.queryOptions({
      workspaceId,
      path: folderPath,
    }),
  );
  const graphQ = useQuery(trpc.kb.graph.queryOptions({ workspaceId }));

  const related = useMemo<RelatedMemory[]>(() => {
    const graph = graphQ.data;
    if (!graph) return [];
    const neighborPaths = new Set<string>();
    for (const link of graph.links) {
      if (link.source === path) neighborPaths.add(link.target);
      else if (link.target === path) neighborPaths.add(link.source);
    }
    const out: RelatedMemory[] = [];
    for (const node of graph.nodes) {
      if (node.nodeId !== null && neighborPaths.has(node.id)) {
        out.push({ nodeId: node.nodeId, title: node.title });
        if (out.length >= 8) break;
      }
    }
    return out;
  }, [graphQ.data, path]);

  const restricted = accessQ.data?.restricted ?? false;
  const grants = accessQ.data?.grants ?? [];

  return (
    <aside className="border-sidebar-border bg-background flex w-72 shrink-0 flex-col overflow-y-auto border-l">
      {/* h-10 matches the note pane's title bar, so "Inspector" sits on the
          same baseline as the breadcrumb across the divider. */}
      <header className="border-border flex h-10 shrink-0 items-center justify-between border-b px-4">
        <span className="text-muted-foreground font-mono text-[10px] font-semibold tracking-wide uppercase">
          Inspector
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] -mr-1 flex size-7 cursor-pointer items-center justify-center rounded-[7px] transition-colors"
        >
          <PanelRightCloseIcon className="size-[15px]" strokeWidth={1.9} />
        </button>
      </header>

      <div className="flex flex-col gap-5 px-4 py-4">
        <InspectorSection icon={FolderIcon} label="Location">
          <p className="text-foreground font-mono text-[12px] break-words">
            {folderPath || "Root"}
          </p>
        </InspectorSection>

        <InspectorSection icon={ClockIcon} label="Freshness">
          {updatedAt ? (
            <p className="text-foreground text-[13px]">
              Updated {formatRelativeTime(updatedAt)}
              <span className="text-muted-foreground">
                {" "}
                · {formatDate(updatedAt)}
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground text-[13px]">
              Not yet compiled.
            </p>
          )}
        </InspectorSection>

        <InspectorSection label="Access">
          {accessQ.isLoading ? (
            <div className="bg-muted h-5 w-24 animate-pulse rounded" />
          ) : (
            <div className="flex flex-col gap-2.5">
              <AccessBadge state={restricted ? "restricted" : "allowed"} />
              <p className="text-muted-foreground text-[12px] leading-4">
                {restricted
                  ? "Inside a restricted space — only granted members and agents can reach it."
                  : "Readable by this workspace's members."}
              </p>
              {grants.length > 0 ? (
                <ul className="flex flex-col gap-1.5 pt-0.5">
                  {grants.map((grant) => (
                    <li
                      key={grant.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="text-foreground truncate text-[12.5px]">
                        {grant.label}
                      </span>
                      <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
                        {ROLE_LABEL[grant.role]}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </InspectorSection>

        <InspectorSection icon={WaypointsIcon} label="Related memory">
          {graphQ.isLoading ? (
            <div className="bg-muted h-5 w-32 animate-pulse rounded" />
          ) : related.length === 0 ? (
            <p className="text-muted-foreground text-[12px]">
              No linked memory yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {related.map((item) => (
                <li key={item.nodeId}>
                  <button
                    type="button"
                    onClick={() => onSelectNote(item.nodeId)}
                    className="text-foreground hover:bg-secondary hover:text-accent-foreground -mx-2 flex w-[calc(100%+1rem)] items-center rounded-md px-2 py-1 text-left text-[12.5px] transition-colors"
                  >
                    <span className="truncate">{item.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </InspectorSection>

        {tags.length > 0 ? (
          <InspectorSection icon={TagIcon} label="Tags">
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="bg-secondary text-secondary-foreground rounded-md px-1.5 py-0.5 font-mono text-[11px]"
                >
                  {tag}
                </span>
              ))}
            </div>
          </InspectorSection>
        ) : null}

        <InspectorSection icon={FileTextIcon} label="Sources">
          {sources.length === 0 ? (
            <p className="text-muted-foreground text-[12px]">
              No linked sources.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {sources.map((source) => (
                <li key={source.id} className="flex flex-col gap-0.5">
                  <span className="text-foreground truncate text-[12.5px]">
                    {source.title ?? source.sourceUrl ?? "Untitled capture"}
                  </span>
                  <span className="text-muted-foreground font-mono text-[10px]">
                    {source.kind}
                    {source.capturedAt
                      ? ` · ${formatRelativeTime(source.capturedAt)}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </InspectorSection>

        {summary ? (
          <InspectorSection label="Summary">
            <p className="text-muted-foreground text-[12.5px] leading-5">
              {summary}
            </p>
          </InspectorSection>
        ) : null}
      </div>
    </aside>
  );
}

function InspectorSection({
  icon: Icon,
  label,
  children,
}: {
  icon?: typeof FolderIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <span className="text-muted-foreground flex items-center gap-1.5 font-mono text-[10px] font-semibold">
        {Icon ? <Icon className="size-3" strokeWidth={2} /> : null}
        {label}
      </span>
      {children}
    </section>
  );
}
