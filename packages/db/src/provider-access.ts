import { createHash } from "node:crypto";
import type { SQL, SQLWrapper } from "drizzle-orm";
import { sql } from "drizzle-orm";

import type {
  ProviderAccessGrantDefinition,
  ProviderAccessPolicyDefinition,
} from "./schema";
import {
  ExternalIdentity,
  ProviderAccessGrant,
  ProviderAccessPolicy,
  providerAccessPolicyDefinitionSchema,
  UserProfile,
  UserProfileEmail,
} from "./schema";

export interface ProviderAccessSubject {
  workspaceId: string;
  userProfileId: string | null;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, "");
}

function normalizeGrant(
  grant: ProviderAccessGrantDefinition,
): ProviderAccessGrantDefinition {
  switch (grant.type) {
    case "user_profile":
      return grant;
    case "email":
      return { type: "email", email: normalizeEmail(grant.email) };
    case "domain":
      return { type: "domain", domain: normalizeDomain(grant.domain) };
    case "external_identity":
      return {
        type: "external_identity",
        provider: grant.provider.trim().toLowerCase(),
        // Provider tenant/organization ids are opaque and may be
        // case-sensitive (Slack team ids are the common example).
        tenantId: grant.tenantId.trim(),
        subject: grant.subject.trim(),
      };
  }
}

function grantKey(grant: ProviderAccessGrantDefinition): string {
  switch (grant.type) {
    case "user_profile":
      return `profile:${grant.userProfileId}`;
    case "email":
      return `email:${grant.email}`;
    case "domain":
      return `domain:${grant.domain}`;
    case "external_identity":
      return JSON.stringify([
        "external",
        grant.provider,
        grant.tenantId,
        grant.subject,
      ]);
  }
}

export function canonicalProviderAccessPolicy(
  definition: ProviderAccessPolicyDefinition,
): ProviderAccessPolicyDefinition {
  const parsed = providerAccessPolicyDefinitionSchema.parse(definition);
  const grants =
    parsed.visibility === "workspace"
      ? []
      : [
          ...new Map(
            parsed.grants
              .map(normalizeGrant)
              .map((grant) => [grantKey(grant), grant]),
          ).values(),
        ].sort((left, right) => grantKey(left).localeCompare(grantKey(right)));

  return {
    version: 1,
    provider: parsed.provider.trim().toLowerCase(),
    tenantId: parsed.tenantId.trim(),
    visibility: parsed.visibility,
    completeness: parsed.completeness,
    grants,
  };
}

export function fingerprintProviderAccessPolicy(
  definition: ProviderAccessPolicyDefinition,
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalProviderAccessPolicy(definition)))
    .digest("hex");
}

export function providerAccessGrantValues(
  workspaceId: string,
  policyId: string,
  definition: ProviderAccessPolicyDefinition,
): (typeof ProviderAccessGrant.$inferInsert)[] {
  return canonicalProviderAccessPolicy(definition).grants.map((grant) => {
    const base = {
      workspaceId,
      policyId,
      principalType: grant.type,
    } as const;
    switch (grant.type) {
      case "user_profile":
        return { ...base, userProfileId: grant.userProfileId };
      case "email":
        return { ...base, email: grant.email };
      case "domain":
        return { ...base, domain: grant.domain };
      case "external_identity":
        return {
          ...base,
          provider: grant.provider,
          tenantId: grant.tenantId,
          subject: grant.subject,
        };
    }
  });
}

/** SQL authorization for provider-managed evidence. Missing policy denies. */
export function providerPolicyAccessSql(
  policyId: SQL | SQLWrapper,
  subject: ProviderAccessSubject,
): SQL {
  if (!subject.userProfileId) {
    return sql`
      EXISTS (
        SELECT 1
        FROM ${ProviderAccessPolicy} policy
        WHERE policy.id = ${policyId}
          AND policy.workspace_id = ${subject.workspaceId}
          AND policy.visibility = 'workspace'
      )`;
  }

  const profileId = subject.userProfileId;
  return sql`
    EXISTS (
      SELECT 1
      FROM ${ProviderAccessPolicy} policy
      WHERE policy.id = ${policyId}
        AND policy.workspace_id = ${subject.workspaceId}
        AND (
          policy.visibility = 'workspace'
          OR EXISTS (
            SELECT 1
            FROM ${ProviderAccessGrant} grant_row
            WHERE grant_row.policy_id = policy.id
              AND grant_row.workspace_id = ${subject.workspaceId}
              AND (
                (
                  grant_row.principal_type = 'user_profile'
                  AND grant_row.user_profile_id = ${profileId}
                )
                OR (
                  grant_row.principal_type = 'email'
                  AND (
                    EXISTS (
                      SELECT 1
                      FROM ${UserProfileEmail} profile_email
                      WHERE profile_email.workspace_id = ${subject.workspaceId}
                        AND profile_email.user_profile_id = ${profileId}
                        AND lower(profile_email.email) = grant_row.email
                    )
                    OR EXISTS (
                      SELECT 1
                      FROM ${UserProfile} profile
                      WHERE profile.workspace_id = ${subject.workspaceId}
                        AND profile.id = ${profileId}
                        AND lower(profile.primary_email) = grant_row.email
                    )
                  )
                )
                OR (
                  grant_row.principal_type = 'domain'
                  AND (
                    EXISTS (
                      SELECT 1
                      FROM ${UserProfileEmail} profile_email
                      WHERE profile_email.workspace_id = ${subject.workspaceId}
                        AND profile_email.user_profile_id = ${profileId}
                        AND split_part(lower(profile_email.email), '@', 2) = grant_row.domain
                    )
                    OR EXISTS (
                      SELECT 1
                      FROM ${UserProfile} profile
                      WHERE profile.workspace_id = ${subject.workspaceId}
                        AND profile.id = ${profileId}
                        AND split_part(lower(profile.primary_email), '@', 2) = grant_row.domain
                    )
                  )
                )
                OR (
                  grant_row.principal_type = 'external_identity'
                  AND EXISTS (
                    SELECT 1
                    FROM ${ExternalIdentity} external_identity
                    WHERE external_identity.workspace_id = ${subject.workspaceId}
                      AND external_identity.user_profile_id = ${profileId}
                      AND external_identity.provider = grant_row.provider
                      AND external_identity.tenant_id = grant_row.tenant_id
                      AND external_identity.subject = grant_row.subject
                  )
                )
              )
          )
        )
    )`;
}

/**
 * SQL authorization for a resource carrying a nullable provider policy.
 * Null means a manual/legacy resource whose existing workspace/folder fence
 * remains authoritative. Provider policies never receive an admin bypass.
 */
export function providerResourceAccessSql(
  policyId: SQL | SQLWrapper,
  subject: ProviderAccessSubject,
): SQL {
  return sql`(
    ${policyId} is null
    OR ${providerPolicyAccessSql(policyId, subject)}
  )`;
}
