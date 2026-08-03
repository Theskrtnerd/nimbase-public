import { randomUUID } from "node:crypto";

import { and, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import {
  ExternalIdentity,
  UserProfile,
  UserProfileEmail,
} from "@acme/db/schema";

export interface CompanyIdentity {
  provider: string;
  tenantId: string;
  subject: string;
  /**
   * Only pass an address whose provider has verified ownership. Unverified
   * addresses must be omitted so they can never merge two employee profiles.
   */
  verifiedEmail?: string | null;
  displayName?: string | null;
}

export type UserProfileResolutionKind =
  | "external_identity"
  | "verified_email"
  | "created";

export interface UserProfileResolution {
  profile: typeof UserProfile.$inferSelect;
  matchedBy: UserProfileResolutionKind;
}

export class UserProfileIdentityConflictError extends Error {
  constructor() {
    super(
      "The verified email and provider identity resolve to different user profiles",
    );
    this.name = "UserProfileIdentityConflictError";
  }
}

export interface NormalizedCompanyIdentity {
  provider: string;
  tenantId: string;
  subject: string;
  verifiedEmail: string | null;
  displayName: string | null;
}

export function normalizeCompanyEmail(email: string | null | undefined) {
  const normalized = email?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}

export function normalizeCompanyIdentity(
  identity: CompanyIdentity,
): NormalizedCompanyIdentity {
  return {
    provider: requiredIdentityPart(identity.provider, "provider").toLowerCase(),
    tenantId: requiredIdentityPart(identity.tenantId, "tenantId").toLowerCase(),
    // Provider subjects are opaque. Trimming transport whitespace is safe;
    // case-folding is not.
    subject: requiredIdentityPart(identity.subject, "subject"),
    verifiedEmail: normalizeCompanyEmail(identity.verifiedEmail),
    displayName: normalizeDisplayName(identity.displayName),
  };
}

/**
 * Resolve one source-system identity to a stable company profile.
 *
 * Match order is intentionally strict:
 *   stable provider subject -> exact verified email -> new profile.
 * Names, titles, and other fuzzy attributes are never identity evidence.
 */
export async function resolveUserProfile(
  workspaceId: string,
  identity: CompanyIdentity,
): Promise<UserProfileResolution> {
  const normalized = normalizeCompanyIdentity(identity);
  const { provider, tenantId, subject, verifiedEmail, displayName } =
    normalized;

  const externalProfile = await profileForExternalIdentity({
    workspaceId,
    provider,
    tenantId,
    subject,
  });
  if (externalProfile) {
    await refreshResolvedIdentity({
      workspaceId,
      userProfileId: externalProfile.id,
      identity: { provider, tenantId, subject },
      verifiedEmail,
      displayName,
    });
    return {
      profile: await loadProfile(externalProfile.id),
      matchedBy: "external_identity",
    };
  }

  if (verifiedEmail) {
    const emailProfile = await profileForVerifiedEmail(
      workspaceId,
      verifiedEmail,
    );
    if (emailProfile) {
      const boundProfileId = await bindExternalIdentity({
        workspaceId,
        userProfileId: emailProfile.id,
        provider,
        tenantId,
        subject,
        verifiedEmail,
      });
      await refreshProfileName(boundProfileId, displayName);
      return {
        profile: await loadProfile(boundProfileId),
        matchedBy:
          boundProfileId === emailProfile.id
            ? "verified_email"
            : "external_identity",
      };
    }
  }

  const profileId = await createProfile({
    workspaceId,
    verifiedEmail,
    displayName,
  });
  if (verifiedEmail) {
    await bindVerifiedEmail(workspaceId, profileId, verifiedEmail);
  }
  const boundProfileId = await bindExternalIdentity({
    workspaceId,
    userProfileId: profileId,
    provider,
    tenantId,
    subject,
    verifiedEmail,
  });
  if (boundProfileId !== profileId) {
    // A concurrent resolver won the provider-subject binding. This UUID was
    // created only for this attempt, so removing it cannot affect the winner.
    await db.delete(UserProfile).where(eq(UserProfile.id, profileId));
  }
  return {
    profile: await loadProfile(boundProfileId),
    matchedBy: boundProfileId === profileId ? "created" : "external_identity",
  };
}

async function profileForExternalIdentity(args: {
  workspaceId: string;
  provider: string;
  tenantId: string;
  subject: string;
}): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: ExternalIdentity.userProfileId })
    .from(ExternalIdentity)
    .where(
      and(
        eq(ExternalIdentity.workspaceId, args.workspaceId),
        eq(ExternalIdentity.provider, args.provider),
        eq(ExternalIdentity.tenantId, args.tenantId),
        eq(ExternalIdentity.subject, args.subject),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function profileForVerifiedEmail(
  workspaceId: string,
  email: string,
): Promise<{ id: string } | null> {
  const [alias] = await db
    .select({ id: UserProfileEmail.userProfileId })
    .from(UserProfileEmail)
    .where(
      and(
        eq(UserProfileEmail.workspaceId, workspaceId),
        eq(UserProfileEmail.email, email),
      ),
    )
    .limit(1);
  if (alias) return alias;

  const [primary] = await db
    .select({ id: UserProfile.id })
    .from(UserProfile)
    .where(
      and(
        eq(UserProfile.workspaceId, workspaceId),
        eq(UserProfile.primaryEmail, email),
      ),
    )
    .limit(1);
  return primary ?? null;
}

async function createProfile(args: {
  workspaceId: string;
  verifiedEmail: string | null;
  displayName?: string | null;
}): Promise<string> {
  const proposedId = randomUUID();
  const [created] = await db
    .insert(UserProfile)
    .values({
      id: proposedId,
      workspaceId: args.workspaceId,
      primaryEmail: args.verifiedEmail,
      displayName: normalizeDisplayName(args.displayName),
    })
    .onConflictDoNothing()
    .returning({ id: UserProfile.id });
  if (created) return created.id;
  if (!args.verifiedEmail) {
    throw new Error("Could not create user profile");
  }
  const existing = await profileForVerifiedEmail(
    args.workspaceId,
    args.verifiedEmail,
  );
  if (!existing) throw new Error("Could not resolve user profile");
  return existing.id;
}

async function bindVerifiedEmail(
  workspaceId: string,
  userProfileId: string,
  email: string,
): Promise<string> {
  await db
    .insert(UserProfileEmail)
    .values({ workspaceId, userProfileId, email })
    .onConflictDoNothing();
  const resolved = await profileForVerifiedEmail(workspaceId, email);
  if (!resolved) throw new Error("Could not bind verified email");
  if (resolved.id === userProfileId) {
    await db
      .update(UserProfile)
      .set({ primaryEmail: email })
      .where(
        and(
          eq(UserProfile.id, userProfileId),
          isNull(UserProfile.primaryEmail),
        ),
      );
  }
  return resolved.id;
}

async function bindExternalIdentity(args: {
  workspaceId: string;
  userProfileId: string;
  provider: string;
  tenantId: string;
  subject: string;
  verifiedEmail: string | null;
}): Promise<string> {
  await db
    .insert(ExternalIdentity)
    .values({
      workspaceId: args.workspaceId,
      userProfileId: args.userProfileId,
      provider: args.provider,
      tenantId: args.tenantId,
      subject: args.subject,
      email: args.verifiedEmail,
      emailVerified: args.verifiedEmail !== null,
    })
    .onConflictDoNothing();
  const resolved = await profileForExternalIdentity(args);
  if (!resolved) throw new Error("Could not bind external identity");
  return resolved.id;
}

async function refreshResolvedIdentity(args: {
  workspaceId: string;
  userProfileId: string;
  identity: { provider: string; tenantId: string; subject: string };
  verifiedEmail: string | null;
  displayName?: string | null;
}): Promise<void> {
  if (args.verifiedEmail) {
    const emailProfileId = await bindVerifiedEmail(
      args.workspaceId,
      args.userProfileId,
      args.verifiedEmail,
    );
    if (emailProfileId !== args.userProfileId) {
      throw new UserProfileIdentityConflictError();
    }
  }

  await Promise.all([
    db
      .update(ExternalIdentity)
      .set({
        email: args.verifiedEmail,
        emailVerified: args.verifiedEmail !== null,
      })
      .where(
        and(
          eq(ExternalIdentity.workspaceId, args.workspaceId),
          eq(ExternalIdentity.provider, args.identity.provider),
          eq(ExternalIdentity.tenantId, args.identity.tenantId),
          eq(ExternalIdentity.subject, args.identity.subject),
        ),
      ),
    refreshProfileName(args.userProfileId, args.displayName),
  ]);
}

async function refreshProfileName(
  userProfileId: string,
  displayName: string | null | undefined,
): Promise<void> {
  const normalized = normalizeDisplayName(displayName);
  if (!normalized) return;
  await db
    .update(UserProfile)
    .set({ displayName: normalized })
    .where(eq(UserProfile.id, userProfileId));
}

async function loadProfile(id: string) {
  const [profile] = await db
    .select()
    .from(UserProfile)
    .where(eq(UserProfile.id, id))
    .limit(1);
  if (!profile) throw new Error("Resolved user profile no longer exists");
  return profile;
}

function requiredIdentityPart(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Identity ${field} is required`);
  return normalized;
}

function normalizeDisplayName(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
