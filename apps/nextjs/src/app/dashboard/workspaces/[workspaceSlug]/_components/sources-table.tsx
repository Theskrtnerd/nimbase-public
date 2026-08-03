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
import { ExternalLinkIcon, MoreHorizontalIcon } from "lucide-react";

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

import type { SourceRow } from "./source-rows";
import { KIND_LABEL, scopeLabel } from "./source-rows";
import { SortButton, StatusPill } from "./table-primitives";

interface SourcesTableProps {
  rows: SourceRow[];
  loading: boolean;
  globalFilter: string;
  onSelect: (row: SourceRow) => void;
}

export function SourcesTable({
  rows,
  loading,
  globalFilter,
  onSelect,
}: SourcesTableProps) {
  // Newest first — a capture feed reads in reverse chronological order.
  const [sorting, setSorting] = useState<SortingState>([
    { id: "captured", desc: true },
  ]);

  // Column defs close over onSelect, so memoise against it rather than
  // defining them at module scope.
  const columns = useMemo<ColumnDef<SourceRow>[]>(
    () => [
      {
        accessorKey: "title",
        header: ({ column }) => <SortButton column={column} label="Source" />,
        cell: ({ row }) => {
          const Icon = row.original.icon;
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="bg-secondary text-accent-foreground flex size-7 shrink-0 items-center justify-center rounded-lg">
                <Icon className="size-3.5" strokeWidth={1.75} />
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="text-foreground truncate text-[13px] font-medium">
                  {row.original.title}
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
          <span className="text-muted-foreground text-[12.5px] whitespace-nowrap">
            {row.original.kindLabel}
          </span>
        ),
      },
      {
        accessorKey: "scope",
        header: ({ column }) => <SortButton column={column} label="Space" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground truncate font-mono text-[11px]">
            {scopeLabel(row.original.scope)}
          </span>
        ),
      },
      {
        accessorKey: "capturedBy",
        header: "Captured by",
        cell: ({ row }) =>
          row.original.capturedBy ? (
            <span className="text-muted-foreground truncate text-[12px]">
              {row.original.capturedBy}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "statusLabel",
        header: "Status",
        cell: ({ row }) => (
          <StatusPill
            tone={row.original.statusTone}
            label={row.original.statusLabel}
            title={
              row.original.status === "failed"
                ? (row.original.error ?? "Compilation failed.")
                : (row.original.compileReport ?? undefined)
            }
          />
        ),
      },
      {
        id: "captured",
        accessorFn: (r) => r.capturedAt.getTime(),
        header: ({ column }) => <SortButton column={column} label="Captured" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground text-[12px] whitespace-nowrap">
            {row.original.capturedLabel}
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
                <span className="sr-only">
                  Actions for {row.original.title}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onSelect(row.original)}>
                Open
              </DropdownMenuItem>
              {row.original.rawUrl ? (
                <DropdownMenuItem asChild>
                  <a
                    href={row.original.rawUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLinkIcon className="size-4" />
                    {row.original.kind === "voice"
                      ? "Play recording"
                      : "View original"}
                  </a>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [onSelect],
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
        r.title,
        r.subtitle,
        r.scope,
        r.kindLabel,
        KIND_LABEL[r.kind],
        r.capturedBy,
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
        {Array.from({ length: 5 }).map((_, i) => (
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
                  : "Nothing captured yet. Use the CLI or connect a source to start building company memory."}
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
