import "server-only";

import type {
  ConnectorAccessResource,
  ConnectorItem,
} from "@nimbase/connector-sdk";

import type {
  MirroredProviderAccessResource,
  ProviderAccessResourceObservationInput,
  SourceProviderAccess,
} from "@acme/api/provider-access";
import {
  linkProviderSourceHistoryToResource,
  mirrorProviderAccessResources,
  providerAccessResourceKey,
  resolveProviderAccessResource,
} from "@acme/api/provider-access";

function resourceObservation(
  resource: ConnectorAccessResource,
): ProviderAccessResourceObservationInput {
  const identity = {
    kind: resource.kind,
    externalId: resource.externalId,
    ...(resource.name ? { name: resource.name } : {}),
  };
  return resource.state === "active"
    ? {
        ...identity,
        state: resource.state,
        accessPolicy: resource.accessPolicy,
      }
    : { ...identity, state: resource.state };
}

function legacyItemObservation(
  item: ConnectorItem,
): ProviderAccessResourceObservationInput | null {
  return item.accessPolicy
    ? {
        kind: "item",
        externalId: item.externalId,
        state: "active",
        accessPolicy: item.accessPolicy,
      }
    : null;
}

function sourceProviderAccess(
  resource: MirroredProviderAccessResource,
): SourceProviderAccess {
  if (resource.state !== "active" || !resource.accessPolicy) {
    throw new Error("connector item references an inactive access resource");
  }
  return {
    resourceId: resource.resourceId,
    ...resource.accessPolicy,
  };
}

/**
 * Adapt connector wire observations to the shared ACL mirror and return a
 * per-pull resolver. Legacy item policies become item-scoped resources here,
 * keeping ingestion and every provider on one domain path.
 */
export async function prepareConnectorAccess(args: {
  workspaceId: string;
  connectionId: string;
  items: ConnectorItem[];
  accessResources: ConnectorAccessResource[];
}): Promise<{
  resolve(item: ConnectorItem): Promise<SourceProviderAccess | undefined>;
}> {
  const observations = [
    ...args.accessResources.map(resourceObservation),
    ...args.items.flatMap((item) => {
      const observation = legacyItemObservation(item);
      return observation ? [observation] : [];
    }),
  ];
  const resources =
    observations.length > 0
      ? await mirrorProviderAccessResources({
          workspaceId: args.workspaceId,
          connectionId: args.connectionId,
          observations,
        })
      : new Map<string, MirroredProviderAccessResource>();

  return {
    async resolve(item) {
      const reference =
        item.accessResource ??
        (item.accessPolicy
          ? { kind: "item", externalId: item.externalId }
          : undefined);
      if (!reference) return undefined;

      const key = providerAccessResourceKey(reference);
      const mirrored = resources.get(key);
      const providerAccess = mirrored
        ? sourceProviderAccess(mirrored)
        : await resolveProviderAccessResource({
            workspaceId: args.workspaceId,
            connectionId: args.connectionId,
            resource: reference,
          });
      if (!mirrored) {
        resources.set(key, {
          resourceId: providerAccess.resourceId,
          state: "active",
          accessPolicy: {
            policyId: providerAccess.policyId,
            fingerprint: providerAccess.fingerprint,
            definition: providerAccess.definition,
          },
        });
      }
      await linkProviderSourceHistoryToResource({
        workspaceId: args.workspaceId,
        connectionId: args.connectionId,
        sourceExternalId: item.externalId,
        resourceId: providerAccess.resourceId,
      });
      return providerAccess;
    },
  };
}
