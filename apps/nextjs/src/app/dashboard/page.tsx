import { redirect } from "next/navigation";

import { and, desc, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { Workspace, WorkspaceMember } from "@acme/db/schema";

import { getSession } from "~/auth/server";
import { acceptPendingInvites } from "~/server/auth/accept-invites";

export default async function DashboardPage() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  // Accept any pending workspace invites for this user's email addresses.
  await acceptPendingInvites(session.user.id);

  const [recent] = await db
    .select({ slug: Workspace.slug })
    .from(Workspace)
    .innerJoin(
      WorkspaceMember,
      and(
        eq(WorkspaceMember.workspaceId, Workspace.id),
        eq(WorkspaceMember.userId, session.user.id),
      ),
    )
    .orderBy(desc(Workspace.createdAt))
    .limit(1);

  if (!recent) {
    redirect("/onboarding/workspace");
  }

  redirect(`/dashboard/workspaces/${recent.slug}`);
}
