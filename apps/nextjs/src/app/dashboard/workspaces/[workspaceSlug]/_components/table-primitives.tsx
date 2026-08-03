"use client";

import { ArrowUpDownIcon } from "lucide-react";

import { cn } from "@acme/ui";

/**
 * The shared vocabulary for the workspace's data tables (Consumers, Sources).
 * Status is monochrome by design (DESIGN.md §6/§7): intensity + label carry the
 * meaning, never hue. Both tables read from this module so the two can't drift.
 */
export type StatusTone = "active" | "idle" | "warn";

const TONE_CLASS: Record<StatusTone, string> = {
  active: "bg-foreground/[0.07] text-foreground",
  idle: "bg-muted text-muted-foreground",
  warn: "bg-foreground/[0.14] text-foreground font-medium",
};

const DOT_CLASS: Record<StatusTone, string> = {
  active: "bg-foreground/70",
  idle: "bg-muted-foreground/40",
  warn: "bg-foreground",
};

export function StatusPill({
  tone,
  label,
  title,
}: {
  tone: StatusTone;
  label: string;
  /** Native tooltip — used for error text that won't fit in a cell. */
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap",
        TONE_CLASS[tone],
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASS[tone])} />
      {label}
    </span>
  );
}

/**
 * Structurally typed on the slice of TanStack's `Column` it actually uses, so
 * it works for any row type without a generic parameter.
 */
export function SortButton({
  column,
  label,
}: {
  column: {
    toggleSorting: (desc?: boolean) => void;
    getIsSorted: () => false | "asc" | "desc";
  };
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      className="hover:text-foreground inline-flex cursor-pointer items-center gap-1 transition-colors"
    >
      {label}
      <ArrowUpDownIcon className="size-3 opacity-50" />
    </button>
  );
}
