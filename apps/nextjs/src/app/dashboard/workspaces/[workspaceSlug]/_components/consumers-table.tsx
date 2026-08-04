"use client";

import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { AlertTriangleIcon, MoreHorizontalIcon } from "lucide-react";

import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@acme/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@acme/ui/table";

import type { ConsumerRow } from "./consumer-rows";
import {
  CONSUMER_TOOLS,
  KIND_ICON,
  KIND_LABEL,
  scopeLabel,
  TOOL_HINT,
  TOOL_LABEL,
} from "./consumer-rows";
import { SortButton, StatusPill } from "./table-primitives";

interface ConsumersTableProps {
  rows: ConsumerRow[];
  loading: boolean;
  globalFilter: string;
  onSelect: (row: ConsumerRow) => void;
  onDelete: (row: ConsumerRow) => void;
}

export function ConsumersTable({
  rows,
  loading,
  globalFilter,
  onSelect,
  onDelete,
}: ConsumersTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "name", desc: false },
  ]);

  // Column defs depend on the row callbacks, so memoise against those rather
  // than defining them at module scope.
  const columns = useMemo<ColumnDef<ConsumerRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortButton column={column} label="Name" />,
        cell: ({ row }) => {
          const Icon = KIND_ICON[row.original.kind];
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="bg-secondary text-accent-foreground flex size-7 shrink-0 items-center justify-center rounded-lg">
                <Icon className="size-3.5" strokeWidth={1.75} />
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="text-foreground truncate text-[13px] font-medium">
                  {row.original.name}
                </span>
                {row.original.subtitle ? (
                  <span className="text-muted-foreground truncate font-mono text-[10.5px]">
                    {row.original.subtitle}
                  </span>
                ) : null}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "kind",
        header: ({ column }) => <SortButton column={column} label="Type" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground text-[12.5px]">
            {KIND_LABEL[row.original.kind]}
          </span>
        ),
        filterFn: (row, _id, value: string) =>
          value === "all" || row.original.kind === value,
      },
      {
        accessorKey: "scope",
        header: ({ column }) => <SortButton column={column} label="Scope" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground truncate font-mono text-[11px]">
            {scopeLabel(row.original.scope)}
          </span>
        ),
      },
      {
        id: "deployments",
        header: "Deployed to",
        cell: ({ row }) => {
          const deployments = row.original.deployments;
          if (deployments.length === 0) {
            return <span className="text-muted-foreground">—</span>;
          }
          // Two chips inline, the rest collapsed — an agent can have several
          // interfaces without pushing the table sideways.
          const shown = deployments.slice(0, 2);
          const overflow = deployments.length - shown.length;
          return (
            <div className="flex flex-wrap items-center gap-1">
              {shown.map((d) => (
                <span
                  key={d.label}
                  title={
                    d.tone === "broken"
                      ? `${d.label} — needs attention`
                      : d.label
                  }
                  className={cn(
                    "inline-flex max-w-[130px] items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px]",
                    d.tone === "broken"
                      ? "bg-foreground/[0.14] text-foreground font-medium"
                      : "bg-secondary text-foreground",
                  )}
                >
                  {d.tone === "broken" && (
                    <AlertTriangleIcon className="size-3 shrink-0" />
                  )}
                  {d.label}
                </span>
              ))}
              {overflow > 0 && (
                <span
                  title={deployments.map((d) => d.label).join(", ")}
                  className="text-muted-foreground font-mono text-[10px]"
                >
                  +{overflow}
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: "tools",
        header: "Tools",
        cell: ({ row }) => {
          const held = new Set(row.original.tools);
          // All three slots always render, so the column reads as a capability
          // set — a missing tool is visibly withheld, not merely absent.
          return (
            <div className="flex items-center gap-1">
              {CONSUMER_TOOLS.map((tool) => {
                const on = held.has(tool);
                return (
                  <span
                    key={tool}
                    title={
                      on
                        ? TOOL_HINT[tool]
                        : `No ${TOOL_LABEL[tool].toLowerCase()} access`
                    }
                    className={cn(
                      "rounded border px-1.5 py-0.5 text-[10px] font-medium",
                      on
                        ? "bg-secondary border-border text-foreground"
                        : "border-border/60 text-muted-foreground/40 line-through",
                    )}
                  >
                    {TOOL_LABEL[tool]}
                  </span>
                );
              })}
            </div>
          );
        },
      },
      {
        accessorKey: "statusLabel",
        header: "Status",
        cell: ({ row }) => (
          <StatusPill
            tone={row.original.statusTone}
            label={row.original.statusLabel}
          />
        ),
      },
      {
        id: "activity",
        accessorFn: (r) => r.activityAt?.getTime() ?? 0,
        header: ({ column }) => <SortButton column={column} label="Activity" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground text-[12px] whitespace-nowrap">
            {row.original.activityLabel}
          </span>
        ),
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontalIcon className="size-4" />
                <span className="sr-only">Actions for {row.original.name}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onSelect(row.original)}>
                Open
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onDelete(row.original)}
              >
                {row.original.kind === "token" ? "Revoke" : "Delete"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [onSelect, onDelete],
  );

  // React Compiler skips memoising this component: useReactTable returns
  // functions it cannot safely memoise (react-hooks/incompatible-library). That
  // is expected and harmless here — the table's outputs are consumed inline in
  // this file and never handed to a memoised child.
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    globalFilterFn: (row, _columnId, filter: string) => {
      const q = filter.trim().toLowerCase();
      if (!q) return true;
      const r = row.original;
      return [
        r.name,
        r.subtitle,
        r.scope,
        KIND_LABEL[r.kind],
        ...r.tools.map((t) => TOOL_LABEL[t]),
        ...r.deployments.map((d) => d.label),
      ]
        .filter((v): v is string => typeof v === "string")
        .some((v) => v.toLowerCase().includes(q));
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-muted h-12 animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  const visible = table.getRowModel().rows;

  return (
    <div className="border-border bg-card overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {visible.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="text-muted-foreground h-28 text-center text-[13px]"
              >
                {globalFilter.trim()
                  ? "Nothing matches that search."
                  : "Nothing deployed yet. Use New to connect an agent, MCP endpoint, or token to this workspace's memory."}
              </TableCell>
            </TableRow>
          ) : (
            visible.map((row) => (
              <TableRow
                key={row.id}
                onClick={() => onSelect(row.original)}
                className="cursor-pointer"
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
