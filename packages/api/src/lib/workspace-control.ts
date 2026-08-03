import { randomUUID } from "node:crypto";
import type { z } from "zod/v4";

import type { CreateWorkspaceSchema } from "@acme/db/schema";
import { eq, like, or } from "@acme/db";
import { db } from "@acme/db/client";
import {
  AccessGrant,
  ExternalIdentity,
  UserProfile,
  UserProfileEmail,
  Workspace,
  WorkspaceMember,
} from "@acme/db/schema";
import { nextAvailableSlug, slugifyName } from "@acme/db/slug";

import { normalizeCompanyEmail } from "./company-identity";

export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>;

export interface WorkspaceCreator {
  id: string;
  name?: string | null;
  email?: string | null;
}

export type WorkspaceIdentitySource = "manual" | "website";
export interface WorkspaceIdentitySources {
  title: WorkspaceIdentitySource;
  description: WorkspaceIdentitySource;
}

export interface WorkspaceBrainInit {
  enqueue: (args: {
    workspaceId: string;
    websiteUrl?: string | null;
    identitySources: WorkspaceIdentitySources;
  }) => Promise<void>;
}

export type WorkspaceRecord = typeof Workspace.$inferSelect;

export async function createWorkspace(args: {
  input: CreateWorkspaceInput;
  creator: WorkspaceCreator;
  brainInit?: WorkspaceBrainInit | null;
  identitySources: WorkspaceIdentitySources;
}): Promise<WorkspaceRecord> {
  const { input, creator } = args;
  const slugBase = slugifyName(input.name) || "workspace";
  const takenRows = await db
    .select({ slug: Workspace.slug })
    .from(Workspace)
    .where(
      or(eq(Workspace.slug, slugBase), like(Workspace.slug, `${slugBase}-%`)),
    )
    .limit(200);
  const taken = new Set(takenRows.map((row) => row.slug));

  let workspace: WorkspaceRecord | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = nextAvailableSlug(slugBase, taken);
    const workspaceId = randomUUID();
    const userProfileId = randomUUID();
    const primaryEmail = normalizeCompanyEmail(creator.email);
    try {
      const statements = [
        db
          .insert(Workspace)
          .values({
            id: workspaceId,
            name: input.name,
            description: input.description?.length ? input.description : null,
            website: input.website ?? null,
            ownerUserId: creator.id,
            slug,
          })
          .returning(),
        db.insert(UserProfile).values({
          id: userProfileId,
          workspaceId,
          primaryEmail,
          displayName: creator.name ?? null,
        }),
        ...(primaryEmail
          ? [
              db.insert(UserProfileEmail).values({
                workspaceId,
                userProfileId,
                email: primaryEmail,
              }),
            ]
          : []),
        db.insert(ExternalIdentity).values({
          workspaceId,
          userProfileId,
          provider: "clerk",
          tenantId: "nimbase",
          subject: creator.id,
          email: primaryEmail,
          emailVerified: primaryEmail !== null,
        }),
        db.insert(WorkspaceMember).values({
          workspaceId,
          userId: creator.id,
          userProfileId,
          role: "owner",
          name: creator.name ?? null,
          email: primaryEmail,
        }),
        db.insert(AccessGrant).values({
          workspaceId,
          principalType: "all_members",
          role: "contributor",
        }),
      ] as const;
      const [workspaceRows] = await db.batch(statements);
      [workspace] = workspaceRows;
      break;
    } catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error;
      taken.add(slug);
    }
  }

  if (!workspace) {
    throw new Error("Failed to create workspace");
  }

  try {
    await args.brainInit?.enqueue({
      workspaceId: workspace.id,
      websiteUrl: input.website ?? null,
      identitySources: args.identitySources,
    });
  } catch (error) {
    console.error("[workspace.create] brain-init enqueue failed", error);
  }

  return workspace;
}
