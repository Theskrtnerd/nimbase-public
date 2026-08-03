"use client";

import type { LucideIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightIcon,
  BotIcon,
  ChevronRightIcon,
  FileTextIcon,
  GlobeIcon,
  HighlighterIcon,
  ImageIcon,
  InboxIcon,
  LayersIcon,
  LockIcon,
  MessagesSquareIcon,
  MicIcon,
  UsersIcon,
  VideoIcon,
  WaypointsIcon,
} from "lucide-react";

import type { RouterOutputs } from "@acme/api";
import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
import { toast } from "@acme/ui/toast";

import type { ActiveView } from "./activity-bar";
import { formatRelativeTime } from "~/lib/format-relative-time";
import { useTRPC } from "~/trpc/react";
import { CompileStatusBadge } from "./memory-status";

type NodeRow = RouterOutputs["kb"]["listCompiledNodes"]["nodes"][number];
type SourceRow = RouterOutputs["sources"]["list"][number];

const dismissKey = (workspaceId: string) =>
  `nimbase.companyMdReviewed.${workspaceId}`;

function subscribeToStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

interface HomeViewProps {
  workspaceId: string;
  workspaceName: string;
  onOpenNote: (nodeId: string) => void;
  onNavigate: (view: ActiveView) => void;
  /** Memory view, connections lens — the graph is a lens, not its own view. */
  onOpenConnections: () => void;
}

/**
 * The Memory Home — the first screen of a workspace (DESIGN.md §8.1). It opens
 * on what's alive, not a blank editor: how much memory exists, what sources
 * need attention, what agents can reach, and what changed recently. Every
 * number is a live count from the API — no vanity metrics, no placeholders.
 * Empty and loading states are honest; atmospheric decoration stays out of
 * this productivity view by design.
 */
export function HomeView({
  workspaceId,
  workspaceName,
  onOpenNote,
  onNavigate,
  onOpenConnections,
}: HomeViewProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const nodesQ = useQuery(
    trpc.kb.listCompiledNodes.queryOptions({ workspaceId }),
  );
  const sourcesQ = useQuery(trpc.sources.list.queryOptions({ workspaceId }));
  const graphQ = useQuery(trpc.kb.graph.queryOptions({ workspaceId }));
  const agentsQ = useQuery(trpc.agent.list.queryOptions({ workspaceId }));
  const membersQ = useQuery(trpc.members.list.queryOptions({ workspaceId }));
  const brainQ = useQuery(
    trpc.workspace.brainInit.queryOptions(
      { workspaceId },
      // Poll only while drafting; stops itself once terminal.
      {
        refetchInterval: (q) =>
          q.state.data?.status === "pending" ? 2000 : false,
      },
    ),
  );

  const persistedDismissed = useSyncExternalStore(
    subscribeToStorage,
    () => localStorage.getItem(dismissKey(workspaceId)) === "1",
    () => true, // server snapshot: hidden until the client knows better
  );
  const [dismissedNow, setDismissedNow] = useState(false);
  const reviewDismissed = persistedDismissed || dismissedNow;
  const dismissReview = () => {
    localStorage.setItem(dismissKey(workspaceId), "1");
    setDismissedNow(true); // same-tab writes don't fire "storage"; state covers it
  };
  const retryBrain = useMutation(
    trpc.workspace.initializeBrain.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries(
          trpc.workspace.brainInit.queryFilter({ workspaceId }),
        ),
      onError: () => toast.error("Couldn't restart the draft"),
    }),
  );
  const companyNode =
    nodesQ.data?.nodes.find((n) => n.path === "company.md") ?? null;
  const brainStatus = brainQ.data?.status;
  const showReviewCard =
    !reviewDismissed &&
    !!brainStatus &&
    (brainStatus !== "done" || companyNode !== null);

  const loading = nodesQ.isLoading || sourcesQ.isLoading;

  const nodes = nodesQ.data?.nodes ?? [];
  const restrictedCount = nodesQ.data?.locked.length ?? 0;
  const sources = sourcesQ.data ?? [];

  const memoryCount = nodes.length;
  const failedCount = sources.filter((s) => s.status === "failed").length;
  const compilingCount = sources.filter((s) => s.status === "queued").length;
  const connectionCount = graphQ.data?.links.length;
  const agents = agentsQ.data ?? [];
  const enabledAgents = agents.filter((a) => a.enabled).length;
  const memberCount = membersQ.data?.members.length;

  const recentMemory = [...nodes]
    .sort(
      (a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0),
    )
    .slice(0, 6);

  // Sources that need a human: failed compiles. Falls back to the most
  // recent captures when all is well.
  const attention = sources.filter((s) => s.status === "failed");
  const attentionRows = (attention.length > 0 ? attention : sources).slice(
    0,
    6,
  );
  const attentionMode = attention.length > 0;

  const isEmpty = !loading && memoryCount === 0 && sources.length === 0;

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-8 md:px-10">
        <header className="flex flex-col gap-2">
          <nav
            aria-label="Breadcrumb"
            className="text-muted-foreground flex items-center gap-1.5 font-mono text-[10px] font-semibold"
          >
            <span className="truncate">{workspaceName}</span>
            <ChevronRightIcon className="size-3 shrink-0" strokeWidth={2} />
            <span>Memory</span>
          </nav>
          <h1 className="text-foreground text-3xl font-semibold tracking-tight">
            Organization Overview
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="text-muted-foreground text-[13.5px] leading-5">
              Live memory ingestion and source health.
            </p>
            <GovernancePills
              memberCount={memberCount}
              restrictedCount={restrictedCount}
            />
          </div>
        </header>

        {showReviewCard ? (
          <CompanyMdCard
            status={brainStatus}
            companyNodeId={companyNode?.id ?? null}
            onOpen={() => {
              dismissReview();
              if (companyNode) onOpenNote(companyNode.id);
            }}
            onRetry={() => retryBrain.mutate({ workspaceId })}
            onDismiss={dismissReview}
            retrying={retryBrain.isPending}
          />
        ) : null}

        {loading ? (
          <HomeSkeleton />
        ) : isEmpty ? (
          <EmptyHome onNavigate={onNavigate} />
        ) : (
          <>
            <section className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Scorecard
                icon={LayersIcon}
                label="Memory objects"
                value={memoryCount}
                sub={
                  restrictedCount > 0
                    ? `${String(restrictedCount)} restricted`
                    : "compiled & current"
                }
                onClick={() => onNavigate("notes")}
              />
              <Scorecard
                icon={InboxIcon}
                label="Sources"
                value={sources.length}
                sub={
                  failedCount > 0
                    ? `${String(failedCount)} need attention`
                    : compilingCount > 0
                      ? `${String(compilingCount)} compiling`
                      : "all compiled"
                }
                attention={failedCount > 0}
                onClick={() => onNavigate("sources")}
              />
              <Scorecard
                icon={WaypointsIcon}
                label="Connections"
                value={connectionCount}
                sub={`across ${String(memoryCount)} memories`}
                onClick={onOpenConnections}
              />
              <Scorecard
                icon={BotIcon}
                label="Agents"
                value={agents.length}
                sub={
                  enabledAgents > 0
                    ? `${String(enabledAgents)} answering from memory`
                    : agents.length > 0
                      ? "paused"
                      : "none deployed"
                }
                onClick={() => onNavigate("consumers")}
              />
            </section>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <Panel
                title="Recently updated"
                actionLabel="Browse memory"
                onAction={() => onNavigate("notes")}
              >
                {recentMemory.length === 0 ? (
                  <PanelEmpty text="No memory has been compiled yet." />
                ) : (
                  recentMemory.map((node) => (
                    <MemoryRow
                      key={node.id}
                      node={node}
                      onOpen={() => onOpenNote(node.id)}
                    />
                  ))
                )}
              </Panel>

              <Panel
                title={attentionMode ? "Needs attention" : "Recent captures"}
                actionLabel="Open sources"
                onAction={() => onNavigate("sources")}
              >
                {attentionRows.length === 0 ? (
                  <PanelEmpty text="No sources captured yet." />
                ) : (
                  attentionRows.map((source) => (
                    <SourceListRow key={source.id} source={source} />
                  ))
                )}
              </Panel>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- pieces --- */

function CompanyMdCard({
  status,
  companyNodeId,
  onOpen,
  onRetry,
  onDismiss,
  retrying,
}: {
  status: "pending" | "done" | "failed";
  companyNodeId: string | null;
  onOpen: () => void;
  onRetry: () => void;
  onDismiss: () => void;
  retrying: boolean;
}) {
  return (
    <section className="bg-card border-border mt-7 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium">
            {status === "pending"
              ? "Drafting your company overview…"
              : status === "failed"
                ? "Company overview draft failed"
                : "Review your company overview"}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {status === "pending"
              ? "The Biographer is writing company.md from what you shared."
              : status === "failed"
                ? "The Biographer couldn't finish. You can retry the draft."
                : "The Biographer drafted company.md — read it and fix anything wrong. It's the root note every compile builds on."}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ✕
        </button>
      </div>
      <div className="mt-3 flex gap-2">
        {status === "done" && companyNodeId ? (
          <Button size="sm" onClick={onOpen}>
            Review company.md
          </Button>
        ) : null}
        {status === "failed" ? (
          <Button size="sm" onClick={onRetry} disabled={retrying}>
            {retrying ? "Retrying…" : "Retry draft"}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function GovernancePills({
  memberCount,
  restrictedCount,
}: {
  memberCount: number | undefined;
  restrictedCount: number;
}) {
  if (memberCount === undefined) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="bg-secondary text-secondary-foreground flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium">
        <UsersIcon className="size-3.5" strokeWidth={2} />
        Governed by {memberCount} {memberCount === 1 ? "member" : "members"}
      </span>
      {restrictedCount > 0 ? (
        <span className="bg-secondary text-secondary-foreground flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium">
          <LockIcon className="size-3.5" strokeWidth={2} />
          {restrictedCount} restricted{" "}
          {restrictedCount === 1 ? "area" : "areas"}
        </span>
      ) : null}
    </div>
  );
}

function Scorecard({
  icon: Icon,
  label,
  value,
  sub,
  attention = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: number | undefined;
  sub: string;
  attention?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group bg-card border-border hover:border-accent-foreground/40 relative flex flex-col rounded-xl border p-4 pb-5 text-left transition-colors"
    >
      <Icon
        className="text-accent-foreground/70 absolute top-4 right-4 size-4"
        strokeWidth={1.75}
      />
      <span className="text-foreground text-3xl font-semibold tracking-tight tabular-nums">
        {value ?? "—"}
      </span>
      <span className="text-foreground mt-2 font-mono text-[11px] font-semibold">
        {label}
      </span>
      <span
        className={cn(
          "mt-0.5 font-mono text-[11px] leading-4",
          attention ? "text-foreground font-medium" : "text-muted-foreground",
        )}
      >
        {sub}
      </span>
    </button>
  );
}

function Panel({
  title,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  actionLabel: string;
  onAction: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card border-border flex flex-col rounded-xl border">
      <header className="border-border flex items-center justify-between border-b px-4 py-3">
        <span className="text-foreground font-mono text-[11px] font-semibold">
          {title}
        </span>
        <button
          type="button"
          onClick={onAction}
          className="text-accent-foreground flex items-center gap-1 text-[12.5px] font-medium transition-colors hover:underline"
        >
          {actionLabel}
          <ArrowRightIcon className="size-3.5" />
        </button>
      </header>
      <div className="divide-border flex flex-col divide-y">{children}</div>
    </section>
  );
}

function PanelEmpty({ text }: { text: string }) {
  return (
    <p className="text-muted-foreground px-3 py-6 text-center text-[12px]">
      {text}
    </p>
  );
}

function MemoryRow({ node, onOpen }: { node: NodeRow; onOpen: () => void }) {
  const segments = node.path.split("/").filter(Boolean);
  const title = node.title;
  const folder = segments.slice(0, -1).join(" / ");
  return (
    <button
      type="button"
      onClick={onOpen}
      className="hover:bg-secondary/60 flex items-center gap-3 px-4 py-3 text-left transition-colors first:rounded-t-none last:rounded-b-xl"
    >
      <FileTextIcon
        className="text-muted-foreground size-4 shrink-0"
        strokeWidth={1.75}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-foreground truncate text-[13px] font-medium">
          {title}
        </span>
        {folder ? (
          <span className="text-muted-foreground truncate font-mono text-[10.5px]">
            {folder}
          </span>
        ) : null}
      </span>
      {node.updatedAt ? (
        <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
          {formatRelativeTime(node.updatedAt)}
        </span>
      ) : null}
    </button>
  );
}

function SourceListRow({ source }: { source: SourceRow }) {
  const title = source.title ?? hostFromUrl(source.sourceUrl) ?? "Untitled";
  const when = source.compiledAt ?? source.createdAt;
  return (
    <div className="flex items-center gap-3 px-4 py-3 last:rounded-b-xl">
      <SourceKindIcon
        kind={source.kind}
        className="text-muted-foreground size-4 shrink-0"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-foreground truncate text-[13px] font-medium">
          {title}
        </span>
        <span className="text-muted-foreground truncate text-[11px]">
          {source.capturedByName ?? "Captured"} · {formatRelativeTime(when)}
        </span>
      </span>
      <CompileStatusBadge
        state={source.status === "queued" ? "pending" : source.status}
      />
    </div>
  );
}

function EmptyHome({ onNavigate }: { onNavigate: (view: ActiveView) => void }) {
  return (
    <div className="border-border bg-card/40 mt-10 flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-16 text-center">
      <span className="bg-secondary text-accent-foreground flex size-12 items-center justify-center rounded-xl">
        <InboxIcon className="size-6" strokeWidth={1.75} />
      </span>
      <p className="text-foreground mt-4 text-[15px] font-semibold">
        Start building company memory
      </p>
      <p className="text-muted-foreground mt-1.5 max-w-sm text-[13px] leading-5">
        Capture a page, thread, or note with the CLI or connect a source. It
        compiles into governed, source-grounded memory here.
      </p>
      <button
        type="button"
        onClick={() => onNavigate("sources")}
        className="bg-primary text-primary-foreground hover:bg-primary/90 mt-5 flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium transition-colors"
      >
        View sources
        <ArrowRightIcon className="size-3.5" />
      </button>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="mt-7">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-card border-border h-28 animate-pulse rounded-xl border"
          />
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="bg-card border-border h-64 animate-pulse rounded-xl border"
          />
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- utils --- */

function hostFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function SourceKindIcon({
  kind,
  className,
}: {
  kind: SourceRow["kind"];
  className?: string;
}) {
  switch (kind) {
    case "web":
      return <GlobeIcon className={className} strokeWidth={1.75} />;
    case "chat_export":
      return <MessagesSquareIcon className={className} strokeWidth={1.75} />;
    case "highlight":
      return <HighlighterIcon className={className} strokeWidth={1.75} />;
    case "screenshot":
      return <ImageIcon className={className} strokeWidth={1.75} />;
    case "voice":
      return <MicIcon className={className} strokeWidth={1.75} />;
    case "video":
      return <VideoIcon className={className} strokeWidth={1.75} />;
  }
}
