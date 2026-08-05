import { randomUUID } from "node:crypto";

import type { SQL, SQLWrapper } from "@acme/db";
import type {
  ProviderAccessGrantDefinition,
  ProviderAccessPolicyDefinition,
  ProviderAccessResourceState,
} from "@acme/db/schema";
import { and, eq, isNull, sql } from "@acme/db";
import { db } from "@acme/db/client";
import {
  canonicalProviderAccessPolicy,
  fingerprintProviderAccessPolicy,
  providerAccessGrantValues,
  providerSourceAccessSql,
} from "@acme/db/provider-access";
import {
  ProviderAccessGrant,
  ProviderAccessObservation,
  ProviderAccessPolicy,
  ProviderAccessResource,
  Source,
  SourceConnection,
} from "@acme/db/schema";

import type { AccessContext } from "./access";

const ACCESS_MIRROR_BATCH_SIZE = 25;

export interface ProviderAccessResourceRef {
  kind: string;
  externalId: string;
}

interface ProviderAccessResourceObservationBase
  extends ProviderAccessResourceRef {
  name?: string;
}

type MirroredProviderAccessGrant = Exclude<
  ProviderAccessGrantDefinition,
  { type: "user_profile" }
>;

type ProviderAccessPolicyInput = Pick<
  ProviderAccessPolicyDefinition,
  "visibility" | "completeness"
> & { grants: MirroredProviderAccessGrant[] };

export type ProviderAccessResourceObservationInput =
  ProviderAccessResourceObservationBase &
    (
      | { state: "active"; accessPolicy: ProviderAccessPolicyInput }
      | { state: "inaccessible" | "deleted" }
    );

export interface MirroredProviderAccessResource {
  resourceId: string;
  state: ProviderAccessResourceState;
  accessPolicy: {
    policyId: string;
    fingerprint: string;
    definition: ProviderAccessPolicyDefinition;
  } | null;
}

export type SourceProviderAccess = NonNullable<
  MirroredProviderAccessResource["accessPolicy"]
> & { resourceId: string };

export class ProviderAccessMirrorError extends Error {
  constructor(
    readonly code:
      | "connection_not_found"
      | "connection_inactive"
      | "invalid_resource"
      | "invalid_policy"
      | "resource_not_found"
      | "resource_inactive",
    message: string,
  ) {
    super(message);
    this.name = "ProviderAccessMirrorError";
  }
}

function mirroredPolicyInput(
  definition: ProviderAccessPolicyDefinition,
): ProviderAccessPolicyInput {
  const grants: MirroredProviderAccessGrant[] = [];
  for (const grant of definition.grants) {
    if (grant.type === "user_profile") {
      throw new ProviderAccessMirrorError(
        "invalid_policy",
        "Mirrored provider policies cannot grant local user profiles",
      );
    }
    grants.push(grant);
  }
  return {
    visibility: definition.visibility,
    completeness: definition.completeness,
    grants,
  };
}

function canonicalResourceRef(
  resource: ProviderAccessResourceRef,
): ProviderAccessResourceRef {
  const kind = resource.kind.trim().toLowerCase();
  const externalId = resource.externalId.trim();
  if (!kind || !externalId) {
    throw new ProviderAccessMirrorError(
      "invalid_resource",
      "Provider access resource kind and external id are required",
    );
  }
  return { kind, externalId };
}

export function providerAccessResourceKey(
  resource: ProviderAccessResourceRef,
): string {
  const canonical = canonicalResourceRef(resource);
  return JSON.stringify([canonical.kind, canonical.externalId]);
}

/** Persist one immutable provider ACL snapshot and its normalized grants. */
export async function persistProviderAccessPolicy(args: {
  workspaceId: string;
  definition: ProviderAccessPolicyDefinition;
}): Promise<{
  id: string;
  fingerprint: string;
  definition: ProviderAccessPolicyDefinition;
}> {
  const definition = canonicalProviderAccessPolicy(args.definition);
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

async function loadConnection(args: {
  workspaceId: string;
  connectionId: string;
}): Promise<{ provider: string; tenantId: string }> {
  const [connection] = await db
    .select({
      provider: SourceConnection.provider,
      tenantId: SourceConnection.routeKey,
      status: SourceConnection.status,
    })
    .from(SourceConnection)
    .where(
      and(
        eq(SourceConnection.id, args.connectionId),
        eq(SourceConnection.workspaceId, args.workspaceId),
      ),
    )
    .limit(1);
  if (!connection) {
    throw new ProviderAccessMirrorError(
      "connection_not_found",
      "Provider connection not found",
    );
  }
  if (connection.status !== "active") {
    throw new ProviderAccessMirrorError(
      "connection_inactive",
      "Provider connection is not active",
    );
  }
  return { provider: connection.provider, tenantId: connection.tenantId };
}

async function loadResource(args: {
  workspaceId: string;
  connectionId: string;
  resource: ProviderAccessResourceRef;
}) {
  return (
    await db
      .select({
        id: ProviderAccessResource.id,
        name: ProviderAccessResource.name,
        state: ProviderAccessResource.state,
        currentAccessPolicyId: ProviderAccessResource.currentAccessPolicyId,
      })
      .from(ProviderAccessResource)
      .where(
        and(
          eq(ProviderAccessResource.workspaceId, args.workspaceId),
          eq(ProviderAccessResource.connectionId, args.connectionId),
          eq(ProviderAccessResource.kind, args.resource.kind),
          eq(ProviderAccessResource.externalId, args.resource.externalId),
        ),
      )
      .limit(1)
  )[0];
}

async function mirrorResource(args: {
  workspaceId: string;
  connectionId: string;
  provider: string;
  tenantId: string;
  observation: ProviderAccessResourceObservationInput;
  observedAt: Date;
}): Promise<MirroredProviderAccessResource> {
  const resource = canonicalResourceRef(args.observation);
  const persistedPolicy =
    args.observation.state === "active"
      ? await persistProviderAccessPolicy({
          workspaceId: args.workspaceId,
          definition: {
            version: 1,
            provider: args.provider,
            tenantId: args.tenantId,
            ...args.observation.accessPolicy,
          },
        })
      : null;
  const accessPolicy = persistedPolicy
    ? {
        policyId: persistedPolicy.id,
        fingerprint: persistedPolicy.fingerprint,
        definition: persistedPolicy.definition,
      }
    : null;
  const currentAccessPolicyId = accessPolicy?.policyId ?? null;
  const normalizedName = args.observation.name?.trim();
  const name = normalizedName?.length ? normalizedName : null;

  const existing = await loadResource({
    workspaceId: args.workspaceId,
    connectionId: args.connectionId,
    resource,
  });
  if (!existing) {
    const resourceId = randomUUID();
    await db.batch([
      db.insert(ProviderAccessResource).values({
        id: resourceId,
        workspaceId: args.workspaceId,
        connectionId: args.connectionId,
        provider: args.provider,
        kind: resource.kind,
        externalId: resource.externalId,
        name,
        state: args.observation.state,
        currentAccessPolicyId,
        lastVerifiedAt: args.observedAt,
        updatedAt: args.observedAt,
      }),
      db.insert(ProviderAccessObservation).values({
        workspaceId: args.workspaceId,
        resourceId,
        state: args.observation.state,
        accessPolicyId: currentAccessPolicyId,
        observedAt: args.observedAt,
      }),
    ]);
    return {
      resourceId,
      state: args.observation.state,
      accessPolicy,
    };
  }

  const changed =
    existing.state !== args.observation.state ||
    existing.currentAccessPolicyId !== currentAccessPolicyId;
  const update = db
    .update(ProviderAccessResource)
    .set({
      name: args.observation.name === undefined ? existing.name : name,
      state: args.observation.state,
      currentAccessPolicyId,
      lastVerifiedAt: args.observedAt,
      updatedAt: args.observedAt,
    })
    .where(
      and(
        eq(ProviderAccessResource.id, existing.id),
        eq(ProviderAccessResource.workspaceId, args.workspaceId),
        eq(ProviderAccessResource.connectionId, args.connectionId),
      ),
    )
    .returning({ id: ProviderAccessResource.id });
  if (changed) {
    const currentPolicy = currentAccessPolicyId
      ? eq(ProviderAccessResource.currentAccessPolicyId, currentAccessPolicyId)
      : isNull(ProviderAccessResource.currentAccessPolicyId);
    const [updated] = await db.batch([
      update,
      db.insert(ProviderAccessObservation).select(
        db
          .select({
            workspaceId: ProviderAccessResource.workspaceId,
            resourceId: ProviderAccessResource.id,
            state: ProviderAccessResource.state,
            accessPolicyId: ProviderAccessResource.currentAccessPolicyId,
            observedAt: ProviderAccessResource.lastVerifiedAt,
          })
          .from(ProviderAccessResource)
          .where(
            and(
              eq(ProviderAccessResource.id, existing.id),
              eq(ProviderAccessResource.workspaceId, args.workspaceId),
              eq(ProviderAccessResource.connectionId, args.connectionId),
              eq(ProviderAccessResource.state, args.observation.state),
              currentPolicy,
            ),
          ),
      ),
    ]);
    if (updated.length === 0) {
      throw new ProviderAccessMirrorError(
        "connection_inactive",
        "Provider connection changed during ACL mirroring",
      );
    }
  } else {
    const updated = await update;
    if (updated.length === 0) {
      throw new ProviderAccessMirrorError(
        "connection_inactive",
        "Provider connection changed during ACL mirroring",
      );
    }
  }
  return {
    resourceId: existing.id,
    state: args.observation.state,
    accessPolicy,
  };
}

/**
 * Mirror a batch from one connector. Repeated identical observations refresh
 * lastVerifiedAt; only effective policy or lifecycle transitions append to
 * governance history.
 */
export async function mirrorProviderAccessResources(args: {
  workspaceId: string;
  connectionId: string;
  observations: ProviderAccessResourceObservationInput[];
  observedAt?: Date;
}): Promise<Map<string, MirroredProviderAccessResource>> {
  const connection = await loadConnection(args);
  const observedAt = args.observedAt ?? new Date();
  const mirrored = new Map<string, MirroredProviderAccessResource>();
  const seen = new Set<string>();
  const keyed = args.observations.map((observation) => {
    const key = providerAccessResourceKey(observation);
    if (seen.has(key)) {
      throw new ProviderAccessMirrorError(
        "invalid_resource",
        `Duplicate provider access resource observation: ${key}`,
      );
    }
    seen.add(key);
    return { key, observation };
  });
  for (
    let offset = 0;
    offset < keyed.length;
    offset += ACCESS_MIRROR_BATCH_SIZE
  ) {
    const batch = keyed.slice(offset, offset + ACCESS_MIRROR_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(({ observation }) =>
        mirrorResource({
          workspaceId: args.workspaceId,
          connectionId: args.connectionId,
          provider: connection.provider,
          tenantId: connection.tenantId,
          observation,
          observedAt,
        }),
      ),
    );
    for (const [index, result] of results.entries()) {
      const entry = batch[index];
      if (entry) mirrored.set(entry.key, result);
    }
  }
  return mirrored;
}

export async function resolveProviderAccessResource(args: {
  workspaceId: string;
  connectionId: string;
  resource: ProviderAccessResourceRef;
}): Promise<SourceProviderAccess> {
  const resource = canonicalResourceRef(args.resource);
  const [row] = await db
    .select({
      resourceId: ProviderAccessResource.id,
      state: ProviderAccessResource.state,
      policyId: ProviderAccessPolicy.id,
      fingerprint: ProviderAccessPolicy.fingerprint,
      definition: ProviderAccessPolicy.definition,
    })
    .from(ProviderAccessResource)
    .leftJoin(
      ProviderAccessPolicy,
      eq(ProviderAccessPolicy.id, ProviderAccessResource.currentAccessPolicyId),
    )
    .where(
      and(
        eq(ProviderAccessResource.workspaceId, args.workspaceId),
        eq(ProviderAccessResource.connectionId, args.connectionId),
        eq(ProviderAccessResource.kind, resource.kind),
        eq(ProviderAccessResource.externalId, resource.externalId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new ProviderAccessMirrorError(
      "resource_not_found",
      "Provider access resource not found",
    );
  }
  if (
    row.state !== "active" ||
    !row.policyId ||
    !row.fingerprint ||
    !row.definition
  ) {
    throw new ProviderAccessMirrorError(
      "resource_inactive",
      "Provider access resource is not active",
    );
  }
  return {
    resourceId: row.resourceId,
    policyId: row.policyId,
    fingerprint: row.fingerprint,
    definition: row.definition,
  };
}

/**
 * Bind every immutable capture version of one provider item to its current ACL
 * resource. This pointer may change when the provider moves an item between
 * security containers; capture-time policy snapshots and bytes never change.
 */
export async function linkProviderSourceHistoryToResource(args: {
  workspaceId: string;
  connectionId: string;
  sourceExternalId: string;
  resourceId: string;
}): Promise<void> {
  await db
    .update(Source)
    .set({ accessResourceId: args.resourceId })
    .where(
      and(
        eq(Source.workspaceId, args.workspaceId),
        eq(Source.connectionId, args.connectionId),
        eq(Source.externalId, args.sourceExternalId),
        sql`EXISTS (
          SELECT 1
          FROM ${ProviderAccessResource} access_resource
          WHERE access_resource.id = ${args.resourceId}
            AND access_resource.workspace_id = ${args.workspaceId}
            AND access_resource.connection_id = ${args.connectionId}
            AND access_resource.state = 'active'
        )`,
      ),
    );
}

/** Compatibility bridge for item-level protocol-v1 policies. */
export async function persistSourceProviderAccessPolicy(args: {
  workspaceId: string;
  connectionId: string | null | undefined;
  externalId: string | null | undefined;
  definition: ProviderAccessPolicyDefinition;
}): Promise<SourceProviderAccess> {
  if (!args.connectionId || !args.externalId) {
    throw new ProviderAccessMirrorError(
      "invalid_resource",
      "Provider-managed sources require connection and external ids",
    );
  }
  const resource = { kind: "item", externalId: args.externalId };
  const mirrored = await mirrorProviderAccessResources({
    workspaceId: args.workspaceId,
    connectionId: args.connectionId,
    observations: [
      {
        ...resource,
        state: "active",
        accessPolicy: mirroredPolicyInput(args.definition),
      },
    ],
  });
  const result = mirrored.get(providerAccessResourceKey(resource));
  if (!result?.accessPolicy) {
    throw new Error("Could not mirror provider access resource policy");
  }
  await linkProviderSourceHistoryToResource({
    workspaceId: args.workspaceId,
    connectionId: args.connectionId,
    sourceExternalId: args.externalId,
    resourceId: result.resourceId,
  });
  return {
    resourceId: result.resourceId,
    ...result.accessPolicy,
  };
}

/**
 * Revoke current provider authorization and remove a connection atomically.
 * Resources survive with a null connection id because immutable Sources still
 * link to them for traceability and fail-closed authorization.
 */
export async function deleteProviderConnection(args: {
  workspaceId: string;
  connectionId: string;
  observedAt?: Date;
}): Promise<void> {
  const observedAt = args.observedAt ?? new Date();
  const activeResources = and(
    eq(ProviderAccessResource.workspaceId, args.workspaceId),
    eq(ProviderAccessResource.connectionId, args.connectionId),
    eq(ProviderAccessResource.state, "active"),
  );
  const recordRevocations = db.insert(ProviderAccessObservation).select(
    db
      .select({
        workspaceId: ProviderAccessResource.workspaceId,
        resourceId: ProviderAccessResource.id,
        state: sql<ProviderAccessResourceState>`'inaccessible'`.as("state"),
        accessPolicyId: sql<string | null>`null`.as("access_policy_id"),
        observedAt: sql<Date>`${observedAt}`.as("observed_at"),
      })
      .from(ProviderAccessResource)
      .where(activeResources),
  );
  await db.batch([
    recordRevocations,
    db
      .update(ProviderAccessResource)
      .set({
        connectionId: null,
        state: "inaccessible",
        currentAccessPolicyId: null,
        lastVerifiedAt: observedAt,
        updatedAt: observedAt,
      })
      .where(activeResources),
    db
      .delete(SourceConnection)
      .where(
        and(
          eq(SourceConnection.id, args.connectionId),
          eq(SourceConnection.workspaceId, args.workspaceId),
        ),
      ),
  ]);
}

export function providerAccessFilter(
  access: AccessContext,
  capturePolicyId: SQL | SQLWrapper,
  resourceId: SQL | SQLWrapper,
): SQL {
  return providerSourceAccessSql(capturePolicyId, resourceId, {
    workspaceId: access.workspaceId,
    userProfileId: access.userProfileId,
  });
}
