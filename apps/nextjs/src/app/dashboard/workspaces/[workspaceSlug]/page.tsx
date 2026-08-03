import { notFound, redirect } from "next/navigation";
import { z } from "zod/v4";

import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { Workspace, WorkspaceMember } from "@acme/db/schema";

import { getAuthSession } from "~/auth/server";
import { WorkspaceShell } from "./_components/workspace-shell";

export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [session, { workspaceSlug }, query] = await Promise.all([
    getAuthSession(),
    params,
    searchParams,
  ]);

  if (!session) {
    redirect("/login");
  }

  // The URL segment carries the slug, but keep accepting a raw workspace UUID
  // so legacy bookmarks and server-side redirects that still emit an id (Stripe
  // billing return, OAuth callbacks) resolve — we canonicalize them to the slug
  // URL below.
  const asUuid = z.uuid().safeParse(workspaceSlug);

  // Access is membership, not ownership: any WorkspaceMember (owner/admin/member)
  // can open the workspace. Mirrors workspace.byId — never gate on
  // Workspace.ownerUserId directly (it is only the creator record).
  const [workspace] = await db
    .select({
      id: Workspace.id,
      slug: Workspace.slug,
      name: Workspace.name,
      description: Workspace.description,
      createdAt: Workspace.createdAt,
    })
    .from(Workspace)
    .innerJoin(
      WorkspaceMember,
      and(
        eq(WorkspaceMember.workspaceId, Workspace.id),
        eq(WorkspaceMember.userId, session.user.id),
      ),
    )
    .where(
      asUuid.success
        ? eq(Workspace.id, asUuid.data)
        : eq(Workspace.slug, workspaceSlug),
    )
    .limit(1);

  if (!workspace) {
    notFound();
  }

  // Canonicalize an id (or any non-slug spelling) to the stable slug URL,
  // preserving query params so banners like ?billing=<state> survive.
  if (workspace.slug !== workspaceSlug) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "string") qs.set(key, value);
      else if (Array.isArray(value)) for (const v of value) qs.append(key, v);
    }
    const suffix = qs.toString();
    redirect(
      `/dashboard/workspaces/${workspace.slug}${suffix ? `?${suffix}` : ""}`,
    );
  }

  return (
    <WorkspaceShell
      initialSettingsSection={
        query.settings === "integrations" ? "integrations" : undefined
      }
      workspace={{
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        createdAt: workspace.createdAt,
      }}
    />
  );
}
