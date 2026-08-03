"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";

import type { RouterOutputs } from "@acme/api";
import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";
import { Label } from "@acme/ui/label";
import { Textarea } from "@acme/ui/textarea";

import { docSiteUrl } from "~/lib/doc-site-url";
import { useTRPC } from "~/trpc/react";

type DocSiteRow = RouterOutputs["docSite"]["list"][number];

const UTC_DATE_TIME = new Intl.DateTimeFormat("en", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

/**
 * Create + manage a published documentation site.
 *
 * The form and card own their own mutations; the Consumers sheets are pure
 * containers around them.
 */
export function DocSiteForm({
  workspaceId,
  onCreated,
}: {
  workspaceId: string;
  onCreated: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation(
    trpc.docSite.create.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(
          trpc.docSite.list.queryFilter({ workspaceId }),
        );
        onCreated();
      },
      onError: (err) => setError(err.message),
    }),
  );

  const canSubmit = name.trim().length > 0;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        create.mutate({
          workspaceId,
          name: name.trim(),
          description: description.trim() || undefined,
          instructions: instructions.trim() || undefined,
          visibility: isPublic ? "public" : "private",
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="docsite-name">Name</Label>
        <Input
          id="docsite-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme customer docs"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="docsite-description">Description</Label>
        <Input
          id="docsite-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Everything you need to integrate with Acme"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="docsite-instructions">Writing guidance</Label>
        <Textarea
          id="docsite-instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={3}
          placeholder="Plain language, no internal codenames, lead with the quickstart."
        />
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={isPublic}
          onChange={(e) => setIsPublic(e.target.checked)}
        />
        <span>
          Public
          <span className="text-muted-foreground block text-xs">
            Anyone with the link can read it. Leave off to restrict the site to
            signed-in workspace members.
          </span>
        </span>
      </label>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <Button type="submit" disabled={!canSubmit || create.isPending}>
        {create.isPending ? "Creating…" : "Create docs site"}
      </Button>
    </form>
  );
}

export function DocSiteCard({
  workspaceId,
  workspaceSlug,
  site,
}: {
  workspaceId: string;
  workspaceSlug: string;
  site: DocSiteRow;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // Polled while a build is in flight so the card reflects the runner without
  // the operator refreshing. Stops once the site settles.
  const builds = useQuery({
    ...trpc.docSite.builds.queryOptions({
      workspaceId,
      slug: site.slug,
      limit: 5,
    }),
    refetchInterval: site.status === "building" ? 4000 : false,
  });

  const publish = useMutation(
    trpc.docSite.publish.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries(
            trpc.docSite.list.queryFilter({ workspaceId }),
          ),
          queryClient.invalidateQueries(
            trpc.docSite.builds.queryFilter({ workspaceId, slug: site.slug }),
          ),
        ]);
      },
      onError: (err) => setError(err.message),
    }),
  );

  const latest = builds.data?.[0];

  return (
    <div className="space-y-5 text-sm">
      <dl className="grid grid-cols-[7rem_1fr] gap-y-2">
        <dt className="text-muted-foreground">Memory</dt>
        <dd>{site.folderPath ? `/${site.folderPath}` : "Whole KB"}</dd>
        <dt className="text-muted-foreground">Visibility</dt>
        <dd>{site.visibility === "public" ? "Public" : "Workspace readers"}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd>{site.status}</dd>
        <dt className="text-muted-foreground">Last built</dt>
        <dd>
          {site.lastBuiltAt ? UTC_DATE_TIME.format(site.lastBuiltAt) : "Never"}
        </dd>
        <dt className="text-muted-foreground">Template</dt>
        <dd className="font-mono text-xs">{site.templateVersion}</dd>
      </dl>

      {site.error && <p className="text-destructive text-sm">{site.error}</p>}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={publish.isPending || site.status === "building"}
          onClick={() => {
            setError(null);
            publish.mutate({ workspaceId, slug: site.slug });
          }}
        >
          <RefreshCwIcon className="mr-1.5 size-3.5" />
          {site.status === "building"
            ? "Building…"
            : site.status === "live"
              ? "Rebuild"
              : "Publish"}
        </Button>
        {site.status === "live" && (
          <Button size="sm" variant="outline" asChild>
            <a
              href={siteHref(workspaceSlug, site.slug)}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLinkIcon className="mr-1.5 size-3.5" />
              Open
            </a>
          </Button>
        )}
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {latest && (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs font-medium">
            Latest build
          </p>
          <p className="text-xs">
            {latest.status} · {latest.pageCount} page
            {latest.pageCount === 1 ? "" : "s"}
          </p>
          {/* The build log names anything dropped — a short site is otherwise
              indistinguishable from a small memory. */}
          {latest.log && (
            <pre className="bg-muted text-muted-foreground max-h-40 overflow-auto rounded p-2 text-[11px] whitespace-pre-wrap">
              {latest.log}
            </pre>
          )}
          {latest.error && (
            <p className="text-destructive text-xs">{latest.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Browser-side adapter over the canonical `docSiteUrl` — it only decides which
 * host to show. Dev has no docs host, so link at the route directly.
 */
function siteHref(workspaceSlug: string, siteSlug: string): string {
  if (typeof window === "undefined") return "";
  const host = window.location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1";
  return docSiteUrl({
    workspaceSlug,
    siteSlug,
    docsHost: isLocal ? undefined : `docs.${host.replace(/^app\./, "")}`,
    devOrigin: window.location.origin,
  });
}
