"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { InboxIcon, SearchIcon } from "lucide-react";

import { cn } from "@acme/ui";
import { Input } from "@acme/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@acme/ui/sheet";

import type { SourceKind, SourceRow } from "./source-rows";
import { useTRPC } from "~/trpc/react";
import { SourceDetail } from "./source-detail";
import { ACTIVE_STATUSES, KIND_LABEL, sourceToRow } from "./source-rows";
import { SourcesTable } from "./sources-table";

const KIND_ORDER: SourceKind[] = [
  "web",
  "chat_export",
  "highlight",
  "screenshot",
  "voice",
  "video",
  "file",
];

/**
 * Sources — everything captured into this workspace, as one table (the same
 * shape as Consumers): search + kind filter over a sortable grid, with the full
 * story of any row in a right-side sheet.
 */
export function SourcesView({ workspaceId }: { workspaceId: string }) {
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<SourceKind | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const trpc = useTRPC();
  const sourcesQuery = useQuery(
    trpc.sources.list.queryOptions(
      { workspaceId },
      {
        // Poll while anything is still compiling so status flips on its own;
        // stop once every source is terminal (compiled/failed).
        refetchInterval: (query) => {
          const rows = query.state.data;
          if (!rows) return false;
          return rows.some((s) => ACTIVE_STATUSES.has(s.status)) ? 4000 : false;
        },
      },
    ),
  );

  const rows = useMemo<SourceRow[]>(
    () => (sourcesQuery.data ?? []).map(sourceToRow),
    [sourcesQuery.data],
  );

  const visibleRows = useMemo(
    () =>
      kindFilter === "all" ? rows : rows.filter((r) => r.kind === kindFilter),
    [rows, kindFilter],
  );

  // Look the selection up in the live rows rather than snapshotting the row, so
  // the open sheet tracks the 4s poll (a queued source flips to compiled).
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const handleSelect = useCallback((row: SourceRow) => {
    setSelectedId(row.id);
  }, []);

  // Only kinds actually present are worth offering as filters.
  const presentKinds = useMemo(() => {
    const seen = new Set(rows.map((r) => r.kind));
    return KIND_ORDER.filter((k) => seen.has(k));
  }, [rows]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="border-sidebar-border flex shrink-0 items-center gap-3 border-b px-5 py-3">
        <InboxIcon className="text-sidebar-accent-foreground size-4" />
        <div className="flex flex-col">
          <h1 className="text-foreground text-[15px] font-semibold tracking-tight">
            Sources
          </h1>
          <p className="text-muted-foreground text-[12px] leading-none">
            Everything captured into company memory — and where each one landed.
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          {sourcesQuery.isError ? (
            <p className="text-muted-foreground px-1 py-3 text-[13px]">
              Couldn&apos;t load sources. Try again in a moment.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px] flex-1">
                  <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search sources…"
                    className="h-8 pl-8 text-[13px]"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  <FilterChip
                    active={kindFilter === "all"}
                    onClick={() => setKindFilter("all")}
                  >
                    All
                    <span className="text-muted-foreground ml-1.5 font-mono text-[10px]">
                      {rows.length}
                    </span>
                  </FilterChip>
                  {presentKinds.map((kind) => (
                    <FilterChip
                      key={kind}
                      active={kindFilter === kind}
                      onClick={() => setKindFilter(kind)}
                    >
                      {KIND_LABEL[kind]}
                    </FilterChip>
                  ))}
                </div>
              </div>

              <SourcesTable
                rows={visibleRows}
                loading={sourcesQuery.isPending}
                globalFilter={search}
                onSelect={handleSelect}
              />
            </>
          )}
        </div>
      </div>

      <Sheet
        open={selected !== null}
        onOpenChange={(open) => !open && setSelectedId(null)}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selected ? (
            <>
              <SheetHeader>
                <SheetTitle>Source</SheetTitle>
              </SheetHeader>
              <div className="px-4 pb-6">
                <SourceDetail row={selected} />
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
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
