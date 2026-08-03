"use client";

import { ExternalLinkIcon } from "lucide-react";

import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";

import type { SourceRow } from "./source-rows";
import { formatDateTime } from "~/lib/format-date";
import { scopeLabel } from "./source-rows";
import { StatusPill } from "./table-primitives";

/**
 * The row's full story, in the detail sheet: everything the table truncates —
 * the compile report and failure reason. The table itself only shows what fits
 * on one line.
 */
export function SourceDetail({ row }: { row: SourceRow }) {
  const Icon = row.icon;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <span className="bg-secondary text-accent-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
          <Icon className="size-[18px]" strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-foreground text-[15px] leading-tight font-semibold tracking-tight">
            {row.title}
          </h2>
          <p className="text-muted-foreground font-mono text-[11px]">
            {row.kindLabel}
            {row.subtitle ? ` · ${row.subtitle}` : null}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[12.5px]">
        <Field label="Status">
          <StatusPill tone={row.statusTone} label={row.statusLabel} />
        </Field>
        <Field label="Space">
          <span className="font-mono text-[11px]">{scopeLabel(row.scope)}</span>
        </Field>
        <Field label="Captured by">{row.capturedBy ?? "—"}</Field>
        <Field label="Captured">
          {formatDateTime(row.capturedAt)}
          <span className="text-muted-foreground"> · {row.capturedLabel}</span>
        </Field>
        <Field label="Compiled">
          {row.compiledAt ? formatDateTime(row.compiledAt) : "—"}
        </Field>
      </dl>

      {row.error ? (
        <Block label="Why it failed" emphasis>
          {row.error}
        </Block>
      ) : null}

      {row.compileReport ? (
        <Block label="Compile report">{row.compileReport}</Block>
      ) : null}

      {row.rawUrl ? (
        <Button variant="outline" size="sm" className="w-fit" asChild>
          <a href={row.rawUrl} target="_blank" rel="noreferrer">
            <ExternalLinkIcon className="size-3.5" />
            {row.kind === "voice" ? "Play recording" : "View original"}
          </a>
        </Button>
      ) : null}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground font-mono text-[10px] uppercase">
        {label}
      </dt>
      <dd className="text-foreground min-w-0">{children}</dd>
    </>
  );
}

function Block({
  label,
  emphasis,
  children,
}: {
  label: string;
  emphasis?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-muted-foreground font-mono text-[10px] uppercase">
        {label}
      </h3>
      <p
        className={cn(
          "rounded-lg px-3 py-2 text-[12.5px] leading-5 whitespace-pre-wrap",
          emphasis
            ? "bg-foreground/[0.07] text-foreground"
            : "bg-muted text-muted-foreground",
        )}
      >
        {children}
      </p>
    </section>
  );
}
