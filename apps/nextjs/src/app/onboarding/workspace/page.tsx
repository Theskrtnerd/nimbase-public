import { redirect } from "next/navigation";

import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { WorkspaceMember } from "@acme/db/schema";

import { getSession } from "~/auth/server";
import { OnboardingWizard } from "./onboarding-wizard";

export default async function OnboardingWorkspacePage() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  // Skip onboarding if the user already belongs to any workspace — membership,
  // not ownership, so invited-only members aren't forced to create one.
  const [existing] = await db
    .select({ id: WorkspaceMember.id })
    .from(WorkspaceMember)
    .where(eq(WorkspaceMember.userId, session.user.id))
    .limit(1);

  if (existing) {
    redirect("/dashboard");
  }

  const firstName = session.user.name?.split(" ")[0] ?? null;

  return <OnboardingWizard firstName={firstName} />;
}
