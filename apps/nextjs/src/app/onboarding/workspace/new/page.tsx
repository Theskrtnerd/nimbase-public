import { redirect } from "next/navigation";
import { z } from "zod/v4";

import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { Workspace, WorkspaceMember } from "@acme/db/schema";

import { OnboardingWizard } from "~/app/onboarding/workspace/onboarding-wizard";
import { getSession } from "~/auth/server";

export default async function NewWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [session, query] = await Promise.all([getSession(), searchParams]);

  if (!session) {
    redirect("/login");
  }

  const firstName = session.user.name?.split(" ")[0] ?? null;
  const workspaceId =
    typeof query.workspaceId === "string" &&
    z.uuid().safeParse(query.workspaceId).success
      ? query.workspaceId
      : null;
  const [workspace] = workspaceId
    ? await db
        .select({ id: Workspace.id, slug: Workspace.slug })
        .from(Workspace)
        .innerJoin(
          WorkspaceMember,
          and(
            eq(WorkspaceMember.workspaceId, Workspace.id),
            eq(WorkspaceMember.userId, session.user.id),
          ),
        )
        .where(eq(Workspace.id, workspaceId))
        .limit(1)
    : [];
  return (
    <OnboardingWizard firstName={firstName} initialWorkspace={workspace} />
  );
}
