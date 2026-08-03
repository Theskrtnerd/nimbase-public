import type { SQL, SQLWrapper } from "@acme/db";
import type { ProviderAccessPolicyDefinition } from "@acme/db/schema";
import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import {
  canonicalProviderAccessPolicy,
  fingerprintProviderAccessPolicy,
  providerAccessGrantValues,
  providerResourceAccessSql,
} from "@acme/db/provider-access";
import {
  ProviderAccessGrant,
  ProviderAccessPolicy,
  Source,
  WorkspaceMember,
} from "@acme/db/schema";

import type { AccessContext } from "./access";

async function policyWithCaptureOwner(
  workspaceId: string,
  actorUserId: string | null,
  definition: ProviderAccessPolicyDefinition,
): Promise<ProviderAccessPolicyDefinition> {
  const canonical = canonicalProviderAccessPolicy(definition);
  if (canonical.visibility === "workspace") return canonical;
  if (!actorUserId) {
    throw new Error("Restricted provider access requires a capture owner");
  }

  const [member] = await db
    .select({ userProfileId: WorkspaceMember.userProfileId })
    .from(WorkspaceMember)
    .where(
      and(
        eq(WorkspaceMember.workspaceId, workspaceId),
        eq(WorkspaceMember.userId, actorUserId),
      ),
    )
    .limit(1);
  if (!member) {
    throw new Error(
      "Restricted provider access owner is not a workspace member",
    );
  }
  return canonicalProviderAccessPolicy({
    ...canonical,
    grants: [
      ...canonical.grants,
      { type: "user_profile", userProfileId: member.userProfileId },
    ],
  });
}

/** Persist one immutable provider ACL snapshot and its normalized grants. */
export async function persistProviderAccessPolicy(args: {
  workspaceId: string;
  actorUserId: string | null;
  definition: ProviderAccessPolicyDefinition;
}): Promise<{
  id: string;
  fingerprint: string;
  definition: ProviderAccessPolicyDefinition;
}> {
  const definition = await policyWithCaptureOwner(
    args.workspaceId,
    args.actorUserId,
    args.definition,
  );
  const fingerprint = fingerprintProviderAccessPolicy(definition);
  const [inserted] = await db
    .insert(ProviderAccessPolicy)
    .values({
      workspaceId: args.workspaceId,
      fingerprint,
      provider: definition.provider,
      tenantId: definition.tenantId,
      visibility: definition.visibility,
      completeness: definition.completeness,
      definition,
    })
    .onConflictDoNothing({
      target: [
        ProviderAccessPolicy.workspaceId,
        ProviderAccessPolicy.fingerprint,
      ],
    })
    .returning({ id: ProviderAccessPolicy.id });

  const policy =
    inserted ??
    (
      await db
        .select({ id: ProviderAccessPolicy.id })
        .from(ProviderAccessPolicy)
        .where(
          and(
            eq(ProviderAccessPolicy.workspaceId, args.workspaceId),
            eq(ProviderAccessPolicy.fingerprint, fingerprint),
          ),
        )
        .limit(1)
    )[0];
  if (!policy) throw new Error("Could not persist provider access policy");

  const grants = providerAccessGrantValues(
    args.workspaceId,
    policy.id,
    definition,
  );
  if (grants.length > 0) {
    await db.insert(ProviderAccessGrant).values(grants).onConflictDoNothing();
  }
  return { id: policy.id, fingerprint, definition };
}

/**
 * Persist the latest policy and re-fence every captured version of the same
 * provider item. Evidence bytes stay immutable; authorization follows the
 * newest ACL observed by its connection.
 */
export async function persistSourceProviderAccessPolicy(args: {
  workspaceId: string;
  actorUserId: string | null;
  connectionId: string | null | undefined;
  externalId: string | null | undefined;
  definition: ProviderAccessPolicyDefinition;
}): ReturnType<typeof persistProviderAccessPolicy> {
  const policy = await persistProviderAccessPolicy(args);
  if (args.connectionId && args.externalId) {
    await db
      .update(Source)
      .set({ accessPolicyId: policy.id })
      .where(
        and(
          eq(Source.workspaceId, args.workspaceId),
          eq(Source.connectionId, args.connectionId),
          eq(Source.externalId, args.externalId),
        ),
      );
  }
  return policy;
}

export function providerAccessFilter(
  access: AccessContext,
  policyId: SQL | SQLWrapper,
): SQL {
  return providerResourceAccessSql(policyId, {
    workspaceId: access.workspaceId,
    userProfileId: access.userProfileId,
  });
}
