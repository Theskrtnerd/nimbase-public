"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlugZapIcon, PlusIcon, SearchIcon } from "lucide-react";

import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@acme/ui/dropdown-menu";
import { Input } from "@acme/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@acme/ui/sheet";
import { toast } from "@acme/ui/toast";

import type { ConsumerKind, ConsumerRow } from "./consumer-rows";
import { useTRPC } from "~/trpc/react";
import { AgentDetail, CreateAgentForm } from "./agents-view";
import {
  agentToRow,
  KIND_ICON,
  KIND_LABEL,
  mcpToRow,
  tokenToRow,
} from "./consumer-rows";
import { CreateTokenForm, TokenDetail } from "./consumer-token-forms";
import { ConsumersTable } from "./consumers-table";
import { CreateGroupMcpPanel, GroupMcpRowCard } from "./group-mcp-settings";

const KIND_ORDER: ConsumerKind[] = ["agent", "mcp", "token"];

/** Which row is open in the detail sheet — kind plus the row's id. */
interface Selection {
  kind: ConsumerKind;
  id: string;
}

/**
 * Consumers (DESIGN.md §8.6) — the single governance view for everything that
 * consumes company memory. The "Consumers" tab is one table of all four
 * deployed non-human principals (agents and their interfaces, group MCP
 * endpoints, and API tokens); the "Permissions" tab is the folder-level
 * grant map that decides what any of them can actually read.
 *
 * This replaced the separate Access and Agents views: the two were describing
 * the same subject (who reaches the KB) from two directions.
 */
export function ConsumersView({ workspaceId }: { workspaceId: string }) {
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<ConsumerKind | "all">("all");
  const [creating, setCreating] = useState<ConsumerKind | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);

  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const workspace = useQuery(
    trpc.workspace.byId.queryOptions({ id: workspaceId }),
  );
  const agents = useQuery(trpc.agent.list.queryOptions({ workspaceId }));
  // groupMcp.list and token.list are manager/admin-gated. Everyone else gets
  // FORBIDDEN, which is a legitimate "you have none of these" for
  // this table rather than an error state — hence `?? []` on isError below.
  const mcps = useQuery(trpc.groupMcp.list.queryOptions({ workspaceId }));
  const tokens = useQuery(trpc.token.list.queryOptions({ workspaceId }));

  const rows = useMemo<ConsumerRow[]>(
    () => [
      ...(agents.data ?? []).map(agentToRow),
      ...(mcps.data ?? []).map(mcpToRow),
      ...(tokens.data ?? []).map(tokenToRow),
    ],
    [agents.data, mcps.data, tokens.data],
  );

  const visibleRows = useMemo(
    () =>
      kindFilter === "all" ? rows : rows.filter((r) => r.kind === kindFilter),
    [rows, kindFilter],
  );

  // Only the agent list gates the skeleton — the three admin-only queries can
  // legitimately never resolve for a non-admin, and waiting on them would leave
  // members staring at a permanent skeleton.
  const loading = agents.isLoading;

  const deleteAgent = useMutation(trpc.agent.delete.mutationOptions({}));
  const deleteMcp = useMutation(trpc.groupMcp.delete.mutationOptions({}));
  const revokeToken = useMutation(trpc.token.revoke.mutationOptions({}));

  const handleDelete = useCallback(
    async (row: ConsumerRow) => {
      const noun = row.kind === "token" ? "Revoke" : "Delete";
      if (!window.confirm(`${noun} "${row.name}"? This cannot be undone.`)) {
        return;
      }
      try {
        switch (row.kind) {
          case "agent":
            await deleteAgent.mutateAsync({ id: row.id });
            await queryClient.invalidateQueries(
              trpc.agent.list.queryFilter({ workspaceId }),
            );
            break;
          case "mcp":
            await deleteMcp.mutateAsync({ workspaceId, id: row.id });
            await queryClient.invalidateQueries(
              trpc.groupMcp.list.queryFilter({ workspaceId }),
            );
            break;
          case "token":
            await revokeToken.mutateAsync({ workspaceId, id: row.id });
            await queryClient.invalidateQueries(
              trpc.token.list.queryFilter({ workspaceId }),
            );
            break;
        }
      } catch {
        toast.error(`${noun} failed. Please try again.`);
        return;
      }
      setSelected((cur) => (cur?.id === row.id ? null : cur));
    },
    [deleteAgent, deleteMcp, revokeToken, queryClient, trpc, workspaceId],
  );

  const handleSelect = useCallback((row: ConsumerRow) => {
    setSelected({ kind: row.kind, id: row.id });
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="border-sidebar-border flex shrink-0 items-center gap-3 border-b px-5 py-3">
        <PlugZapIcon className="text-sidebar-accent-foreground size-4" />
        <div className="flex flex-col">
          <h1 className="text-foreground text-[15px] font-semibold tracking-tight">
            Consumers
          </h1>
          <p className="text-muted-foreground text-[12px] leading-none">
            Everything connected to your company memory — and what each one is
            allowed to read.
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search consumers…"
                className="h-8 pl-8 text-[13px]"
              />
            </div>

            <div className="flex items-center gap-1">
              <FilterChip
                active={kindFilter === "all"}
                onClick={() => setKindFilter("all")}
              >
                All
              </FilterChip>
              {KIND_ORDER.map((kind) => (
                <FilterChip
                  key={kind}
                  active={kindFilter === kind}
                  onClick={() => setKindFilter(kind)}
                >
                  {KIND_LABEL[kind]}
                </FilterChip>
              ))}
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="h-8">
                  <PlusIcon className="size-4" />
                  New
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {KIND_ORDER.map((kind) => {
                  const Icon = KIND_ICON[kind];
                  return (
                    <DropdownMenuItem
                      key={kind}
                      onClick={() => setCreating(kind)}
                    >
                      <Icon className="size-4" />
                      {KIND_LABEL[kind]}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <ConsumersTable
            rows={visibleRows}
            loading={loading}
            globalFilter={search}
            onSelect={handleSelect}
            onDelete={(row) => void handleDelete(row)}
          />
        </div>
      </div>

      <CreateSheet
        workspaceId={workspaceId}
        orgSlug={workspace.data?.slug}
        kind={creating}
        onClose={() => setCreating(null)}
      />

      <DetailSheet
        workspaceId={workspaceId}
        orgSlug={workspace.data?.slug}
        selection={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-full px-2.5 py-1 text-[12px] whitespace-nowrap transition-colors",
        active
          ? "bg-secondary text-foreground font-medium"
          : "text-muted-foreground hover:bg-secondary/50",
      )}
    >
      {children}
    </button>
  );
}

const CREATE_COPY: Record<
  ConsumerKind,
  { title: string; description: string }
> = {
  agent: {
    title: "New agent",
    description: "Answers from company memory in the app or a website widget.",
  },
  mcp: {
    title: "New group MCP endpoint",
    description: "A hosted MCP URL for external tools and agents.",
  },
  token: {
    title: "New API token",
    description:
      "A folder-scoped bearer token for the CLI, MCP transport, and automation.",
  },
};

function CreateSheet({
  workspaceId,
  orgSlug,
  kind,
  onClose,
}: {
  workspaceId: string;
  orgSlug: string | undefined;
  kind: ConsumerKind | null;
  onClose: () => void;
}) {
  const copy = kind ? CREATE_COPY[kind] : null;

  return (
    <Sheet open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {kind && copy ? (
          <>
            <SheetHeader>
              <SheetTitle>{copy.title}</SheetTitle>
              <SheetDescription>{copy.description}</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">
              {kind === "agent" && (
                <CreateAgentForm workspaceId={workspaceId} onDone={onClose} />
              )}
              {kind === "mcp" && (
                <CreateGroupMcpPanel
                  workspaceId={workspaceId}
                  orgSlug={orgSlug}
                />
              )}
              {kind === "token" && (
                <CreateTokenForm workspaceId={workspaceId} onDone={onClose} />
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailSheet({
  workspaceId,
  orgSlug,
  selection,
  onClose,
}: {
  workspaceId: string;
  orgSlug: string | undefined;
  selection: Selection | null;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={selection !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {selection ? (
          <>
            <SheetHeader>
              <SheetTitle>{KIND_LABEL[selection.kind]}</SheetTitle>
            </SheetHeader>
            <div className="px-4 pb-6">
              <DetailBody
                workspaceId={workspaceId}
                orgSlug={orgSlug}
                selection={selection}
                onClose={onClose}
              />
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Detail bodies are the pre-existing per-kind cards, reused as-is. Each already
 * owns its own edit/enable/delete mutations, so the sheet is a pure container.
 */
function DetailBody({
  workspaceId,
  orgSlug,
  selection,
  onClose,
}: {
  workspaceId: string;
  orgSlug: string | undefined;
  selection: Selection;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const mcps = useQuery({
    ...trpc.groupMcp.list.queryOptions({ workspaceId }),
    enabled: selection.kind === "mcp",
  });

  switch (selection.kind) {
    case "agent":
      return (
        <AgentDetail
          agentId={selection.id}
          workspaceId={workspaceId}
          onBack={onClose}
        />
      );
    case "mcp": {
      const row = mcps.data?.find((m) => m.id === selection.id);
      if (!row) return <DetailFallback loading={mcps.isLoading} />;
      return (
        <GroupMcpRowCard
          workspaceId={workspaceId}
          orgSlug={orgSlug}
          row={row}
        />
      );
    }
    case "token":
      return <TokenDetail workspaceId={workspaceId} tokenId={selection.id} />;
  }
}

function DetailFallback({ loading }: { loading: boolean }) {
  return (
    <p className="text-muted-foreground text-[13px]">
      {loading ? "Loading…" : "This item is no longer available."}
    </p>
  );
}
