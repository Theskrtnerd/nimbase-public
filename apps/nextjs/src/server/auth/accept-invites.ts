import "server-only";

import { clerkClient, currentUser } from "@clerk/nextjs/server";

import type { InvitePort } from "@acme/api";
import { resolveUserProfile } from "@acme/api";
import { assertWithinLimit, EntitlementError } from "@acme/api/entitlements";
import { and, eq, inArray } from "@acme/db";
import { db } from "@acme/db/client";
import { AccessGrant, WorkspaceInvite, WorkspaceMember } from "@acme/db/schema";

// Wired into createTRPCContext. Clerk refuses invitations for existing users —
// that's fine: the invite row alone is enough, acceptance matches by email.
export const clerkInvitePort: InvitePort = {
  async send(email: string) {
    try {
      const client = await clerkClient();
      const invitation = await client.invitations.createInvitation({
        emailAddress: email,
        notify: true,
        ignoreExisting: true,
      });
      return invitation.id;
    } catch (err) {
      console.error("[invites] clerk invitation failed", err);
      return null;
    }
  },
};

// Called on dashboard load: turns pending email invites for the signed-in
// user into memberships (+ their initial grants). Idempotent.
export async function acceptPendingInvites(userId: string): Promise<number> {
  const user = await currentUser();
  if (!user) return 0;
  const emails = user.emailAddresses
    .filter((email) => email.verification?.status === "verified")
    .map((email) => email.emailAddress.toLowerCase());
  if (emails.length === 0) return 0;

  const pending = await db
    .select()
    .from(WorkspaceInvite)
    .where(
      and(
        eq(WorkspaceInvite.status, "pending"),
        inArray(WorkspaceInvite.email, emails),
      ),
    );

  let accepted = 0;
  for (const invite of pending) {
    try {
      await assertWithinLimit(invite.workspaceId, "members");
    } catch (err) {
      if (err instanceof EntitlementError) {
        // Workspace is at its member cap (downgraded plan). Leave the invite
        // pending so it can be accepted after an upgrade; skip this one without
        // aborting the rest of the login.
        console.warn(
          "[accept-invites] member cap reached, skipping",
          invite.workspaceId,
        );
        continue;
      }
      throw err;
    }

    const resolution = await resolveUserProfile(invite.workspaceId, {
      provider: "clerk",
      tenantId: "nimbase",
      subject: userId,
      verifiedEmail: invite.email,
      displayName: user.fullName,
    });

    await db
      .insert(WorkspaceMember)
      .values({
        workspaceId: invite.workspaceId,
        userId,
        userProfileId: resolution.profile.id,
        role: invite.role,
        name: user.fullName,
        email: invite.email,
      })
      .onConflictDoNothing();
    // Each grant targets a distinct folder and doesn't read another grant's
    // result, so these upserts can fan out concurrently.
    await Promise.all(
      (invite.initialGrants ?? []).map((grant) =>
        db
          .insert(AccessGrant)
          .values({
            workspaceId: invite.workspaceId,
            principalType: "user",
            principalId: userId,
            folderId: grant.folderId,
            role: grant.role,
            createdByUserId: invite.invitedByUserId,
          })
          .onConflictDoUpdate({
            target: [
              AccessGrant.workspaceId,
              AccessGrant.principalType,
              AccessGrant.principalId,
              AccessGrant.folderId,
            ],
            set: { role: grant.role },
          }),
      ),
    );
    await db
      .update(WorkspaceInvite)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(eq(WorkspaceInvite.id, invite.id));
    accepted += 1;
  }
  return accepted;
}
