"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Code,
  Copy,
  ExternalLink,
  Eye,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { usePostHog } from "posthog-js/react";

import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";

import { useTRPC } from "~/trpc/react";
import { RawSource } from "./raw-source";

type Kind = "freeform" | "fixed";
type ThemeMode = "app" | "custom";
type Visibility = "private" | "public";

const VISIBILITY_LABEL: Record<Visibility, string> = {
  private: "Just me",
  public: "Public",
};

const VISIBILITY_OPTIONS: { v: Visibility; label: string }[] = [
  { v: "private", label: "Just me" },
  { v: "public", label: "Public" },
];

interface ArtifactListItem {
  id: string;
  title: string;
  kind: Kind;
  status: "generating" | "draft" | "failed";
  visibility: Visibility;
  slug: string | null;
  prompt: string | null;
  targetPath: string;
  error: string | null;
  updatedAt: string | Date;
}

export function ArtifactView({ workspaceId }: { workspaceId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const posthog = usePostHog();

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const targetsQuery = useQuery(
    trpc.access.captureTargets.queryOptions({ workspaceId }),
  );
  const artifactesQuery = useQuery(
    trpc.artifact.list.queryOptions(
      { workspaceId },
      {
        // Poll only while a generation job is in flight; stop as soon as
        // every artifact has settled.
        refetchInterval: (query) =>
          query.state.data?.some((c) => c.status === "generating")
            ? 2000
            : false,
      },
    ),
  );

  const targets = targetsQuery.data ?? [];
  const artifactes = (artifactesQuery.data ?? []) as ArtifactListItem[];
  const selected = artifactes.find((c) => c.id === selectedId) ?? null;

  async function refreshList() {
    await queryClient.invalidateQueries(
      trpc.artifact.list.queryFilter({ workspaceId }),
    );
  }

  // Re-run a failed generation with the artifact's stored params. Target folder
  // and theme are not re-sent: the row keeps its folder, and retries use the
  // app theme (custom theme description isn't persisted).
  async function regenerate(c: ArtifactListItem) {
    await fetch("/api/artifacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        artifactId: c.id,
        prompt: c.prompt ?? "Create a clean interface.",
        kind: c.kind,
      }),
    });
    await refreshList();
  }

  const setVisibilityMutation = useMutation(
    trpc.artifact.setVisibility.mutationOptions({
      onSuccess: (_, variables) => {
        posthog.capture("artifact_visibility_changed", {
          visibility: variables.visibility,
        });
        void refreshList();
      },
    }),
  );
  const deleteMutation = useMutation(
    trpc.artifact.delete.mutationOptions({
      onSuccess: () => {
        setSelectedId(null);
        void refreshList();
      },
    }),
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <aside className="border-border flex w-64 shrink-0 flex-col gap-2 overflow-y-auto border-r p-3">
        <h2 className="text-muted-foreground px-1 text-[11px] font-semibold">
          Artifacts
        </h2>
        <button
          type="button"
          onClick={() => setSelectedId(null)}
          className={cn(
            "mb-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium transition-colors",
            selectedId === null
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:bg-muted/50",
          )}
        >
          <Plus className="size-3.5" />
          New artifact
        </button>
        {artifactes.length === 0 ? (
          <p className="text-muted-foreground px-1 text-[12px]">
            None yet. Generate one on the right.
          </p>
        ) : (
          artifactes.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedId(c.id)}
              className={cn(
                "flex flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors",
                c.id === selectedId ? "bg-secondary" : "hover:bg-muted/50",
              )}
            >
              <span className="text-foreground truncate text-[13px] font-medium">
                {c.title}
              </span>
              <span
                className={cn(
                  "flex items-center gap-1 text-[11px]",
                  c.status === "failed"
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {c.status === "generating" ? (
                  <>
                    <Loader2 className="size-3 animate-spin" /> Generating…
                  </>
                ) : (
                  <>
                    {c.kind === "fixed" ? "Fixed" : "Freeform"}
                    {c.status === "failed"
                      ? " · Failed"
                      : ` · ${VISIBILITY_LABEL[c.visibility]}`}
                  </>
                )}
              </span>
            </button>
          ))
        )}
      </aside>

      <div className="bg-background flex min-w-0 flex-1 flex-col overflow-hidden">
        {selected ? (
          <ArtifactDetail
            key={selected.id}
            artifact={selected}
            onSetVisibility={(visibility) =>
              setVisibilityMutation.mutate({
                id: selected.id,
                visibility,
              })
            }
            onDelete={() => deleteMutation.mutate({ id: selected.id })}
            onRegenerate={() => void regenerate(selected)}
            busy={setVisibilityMutation.isPending || deleteMutation.isPending}
          />
        ) : (
          <GenerateArtifactForm
            workspaceId={workspaceId}
            targets={targets}
            onCreated={async (id) => {
              await refreshList();
              setSelectedId(id);
            }}
          />
        )}
      </div>
    </div>
  );
}

function GenerateArtifactForm({
  workspaceId,
  targets,
  onCreated,
}: {
  workspaceId: string;
  targets: { folderId: string | null; label: string }[];
  onCreated: (id: string) => Promise<void> | void;
}) {
  const posthog = usePostHog();
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<Kind>("fixed");
  const [themeMode, setThemeMode] = useState<ThemeMode>("app");
  const [themeDescription, setThemeDescription] = useState("");
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function generate() {
    setError(null);
    setIsPending(true);
    try {
      const res = await fetch("/api/artifacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          prompt: prompt.trim(),
          kind,
          themeMode,
          themeDescription:
            themeMode === "custom"
              ? themeDescription.trim() || undefined
              : undefined,
          targetFolderId: targetFolderId ?? undefined,
          visibility,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? `Generation failed (${res.status})`);
        return;
      }
      const { id } = (await res.json()) as { id: string };
      posthog.capture("artifact_generated", {
        kind,
        theme_mode: themeMode,
      });
      setPrompt("");
      await onCreated(id);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-6 pb-10">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <div className="bg-card border-border flex flex-col gap-4 rounded-xl border p-5">
          <h2 className="text-foreground text-[14px] font-semibold tracking-tight">
            Generate an artifact
          </h2>

          <textarea
            aria-label="Artifact description"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="Describe the interface you want…"
            className="border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring/40 w-full resize-none rounded-lg border px-3 py-2 text-[13px] leading-5 outline-none focus-visible:ring-2"
          />

          <button
            type="button"
            onClick={() => setAdvancedOpen((prev) => !prev)}
            className="text-muted-foreground hover:text-foreground self-start text-[12px] font-medium transition-colors"
          >
            {advancedOpen ? "Hide advanced" : "Advanced options"}
          </button>

          {advancedOpen ? (
            <div className="border-border flex flex-col gap-4 rounded-lg border border-dashed p-3">
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground text-[11px] font-semibold">
                  Mode
                </p>
                <div className="flex gap-2">
                  <ModeButton
                    active={kind === "fixed"}
                    onClick={() => setKind("fixed")}
                    label="Fixed"
                    hint="React/TSX"
                  />
                  <ModeButton
                    active={kind === "freeform"}
                    onClick={() => setKind("freeform")}
                    label="Freeform"
                    hint="HTML"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground text-[11px] font-semibold">
                  Theme
                </p>
                <div className="flex gap-2">
                  <ModeButton
                    active={themeMode === "app"}
                    onClick={() => setThemeMode("app")}
                    label="Match app"
                    hint="Nimbase colors & fonts"
                  />
                  <ModeButton
                    active={themeMode === "custom"}
                    onClick={() => setThemeMode("custom")}
                    label="Custom"
                    hint="Describe your own"
                  />
                </div>
                {themeMode === "custom" ? (
                  <textarea
                    aria-label="Custom theme description"
                    value={themeDescription}
                    onChange={(e) => setThemeDescription(e.target.value)}
                    rows={2}
                    placeholder="e.g. dark, neon-on-black, monospace headings…"
                    className="border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring/40 w-full resize-none rounded-lg border px-3 py-2 text-[13px] leading-5 outline-none focus-visible:ring-2"
                  />
                ) : null}
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground text-[11px] font-semibold">
                  Target space
                </p>
                <select
                  aria-label="Target space"
                  value={targetFolderId ?? ""}
                  onChange={(e) => setTargetFolderId(e.target.value || null)}
                  className="border-border bg-background text-foreground focus-visible:ring-ring/40 w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus-visible:ring-2"
                >
                  <option value="">Workspace root</option>
                  {targets
                    .filter((t) => t.folderId !== null)
                    .map((t) => (
                      <option key={t.folderId} value={t.folderId ?? ""}>
                        {t.label}
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground text-[11px] font-semibold">
                  Link access
                </p>
                <div className="flex gap-2">
                  <ModeButton
                    active={visibility === "private"}
                    onClick={() => setVisibility("private")}
                    label="Private"
                    hint="Workspace access"
                  />
                  <ModeButton
                    active={visibility === "public"}
                    onClick={() => setVisibility("public")}
                    label="Public"
                    hint="Anyone with link"
                  />
                </div>
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="text-destructive text-[13px]">{error}</p>
          ) : null}

          <Button
            type="button"
            disabled={isPending || prompt.trim().length === 0}
            onClick={() => void generate()}
            className="gap-2 self-start"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Generating…
              </>
            ) : (
              "Generate"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
        active
          ? "border-primary bg-secondary"
          : "border-border hover:bg-muted/50",
      )}
    >
      <span className="text-foreground text-[13px] font-medium">{label}</span>
      <span className="text-muted-foreground text-[11px]">{hint}</span>
    </button>
  );
}

function VisibilityControl({
  visibility,
  busy,
  onChange,
}: {
  visibility: Visibility;
  busy: boolean;
  onChange: (visibility: Visibility) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="border-border flex overflow-hidden rounded-md border">
        {VISIBILITY_OPTIONS.map((o) => (
          <button
            key={o.v}
            type="button"
            disabled={busy}
            onClick={() => onChange(o.v)}
            className={cn(
              "px-2.5 py-1 text-[12px] font-medium transition-colors",
              visibility === o.v
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-muted/50",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ArtifactDetail({
  artifact,
  onSetVisibility,
  onDelete,
  onRegenerate,
  busy,
}: {
  artifact: ArtifactListItem;
  onSetVisibility: (visibility: Visibility) => void;
  onDelete: () => void;
  onRegenerate: () => void;
  busy: boolean;
}) {
  const posthog = usePostHog();
  const [copied, setCopied] = useState(false);
  // Fixed artifactes can flip between the rendered preview and their TSX source.
  // Keyed remount (parent passes key={artifact.id}) resets this on artifact switch.
  const [showSource, setShowSource] = useState(false);
  // A finished artifact always has a link (slug minted at creation).
  const isReady = artifact.status === "draft" && !!artifact.slug;
  const isFixed = artifact.kind === "fixed";

  const sourceQuery = useQuery({
    queryKey: ["artifact-source", artifact.id],
    enabled: isFixed && showSource,
    queryFn: async () => {
      const res = await fetch(`/api/artifacts/${artifact.id}/source`);
      if (!res.ok) throw new Error(`Source unavailable (${res.status})`);
      return res.text();
    },
  });

  function copyLink() {
    if (!artifact.slug) return;
    const url = `${window.location.origin}/s/${artifact.slug}`;
    void navigator.clipboard.writeText(url).then(() => {
      posthog.capture("artifact_link_copied", {
        visibility: artifact.visibility,
      });
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <>
      <header className="border-border flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex min-w-0 flex-col">
          <span className="text-foreground truncate text-[14px] font-semibold">
            {artifact.title}
          </span>
          <span className="text-muted-foreground text-[11px]">
            {artifact.kind === "fixed" ? "Fixed (React)" : "Freeform (HTML)"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isFixed ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowSource((prev) => !prev)}
              className="h-8 gap-1.5 px-3 text-[12px]"
            >
              {showSource ? (
                <>
                  <Eye className="size-3.5" /> Preview
                </>
              ) : (
                <>
                  <Code className="size-3.5" /> View source
                </>
              )}
            </Button>
          ) : null}
          {isReady ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copyLink}
                className="h-8 gap-1.5 px-3 text-[12px]"
              >
                {copied ? (
                  <>
                    <Check className="size-3.5" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="size-3.5" /> Copy link
                  </>
                )}
              </Button>
              <a
                href={`/s/${artifact.slug}`}
                target="_blank"
                rel="noreferrer"
                className="border-border bg-background text-foreground hover:bg-muted inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium transition-colors"
              >
                <ExternalLink className="size-3.5" /> Open
              </a>
              <VisibilityControl
                visibility={artifact.visibility}
                busy={busy}
                onChange={onSetVisibility}
              />
            </>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={busy}
            onClick={onDelete}
            aria-label="Delete artifact"
            className="size-8"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </header>
      <div className="bg-background min-h-0 flex-1 overflow-hidden">
        {artifact.status === "generating" ? (
          <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-[13px]">
            <Loader2 className="size-4 animate-spin" /> Generating…
          </div>
        ) : artifact.status === "failed" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
            <p className="text-destructive max-w-md text-center text-[13px]">
              {artifact.error ?? "Generation failed"}
            </p>
            <Button type="button" size="sm" onClick={onRegenerate}>
              Try again
            </Button>
          </div>
        ) : isFixed && showSource ? (
          <div className="flex h-full min-h-0 flex-col">
            {sourceQuery.isPending ? (
              <div className="text-muted-foreground flex items-center gap-2 p-4 text-[13px]">
                <Loader2 className="size-4 animate-spin" /> Loading source…
              </div>
            ) : sourceQuery.isError ? (
              <p className="text-destructive p-4 text-[13px]">
                {sourceQuery.error.message}
              </p>
            ) : (
              <RawSource body={sourceQuery.data} />
            )}
          </div>
        ) : (
          <iframe
            title={artifact.title}
            src={`/api/artifacts/${artifact.id}/preview?v=${new Date(artifact.updatedAt).getTime()}`}
            sandbox="allow-scripts"
            className="h-full w-full border-0"
          />
        )}
      </div>
    </>
  );
}
