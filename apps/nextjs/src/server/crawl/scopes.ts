import "server-only";

import {
  CONNECTOR_PROTOCOL_VERSION,
  jsonValueSchema,
} from "@nimbase/connector-sdk";

import type { AccessContext } from "@acme/api/access";
import {
  applyConnectionScopeConfiguration,
  ConnectionControlError,
  requireManageableConnection,
} from "@acme/api/connection-control";

import { decryptConnectionSecret } from "../connection-secret";
import { connectorAdapterFor } from "./registry";

export interface ConnectionScopeOption {
  id: string;
  name: string;
  path?: string;
  selected: boolean;
}

export interface ConnectionScopeResult {
  connectionId: string;
  provider: string;
  scopeKind: string | null;
  scopes: ConnectionScopeOption[];
}

async function loadScopes(args: {
  access: AccessContext;
  connectionId: string;
}) {
  const connection = await requireManageableConnection(
    args.access,
    args.connectionId,
  );
  const configuration = jsonValueSchema.parse(connection.config ?? {});
  if (
    configuration === null ||
    Array.isArray(configuration) ||
    typeof configuration !== "object"
  ) {
    throw new ConnectionControlError(
      "invalid_request",
      "Connector configuration must be a JSON object",
    );
  }
  const context = {
    endpointUrl: connection.connectorUrl,
    secret: connection.secretsEncrypted
      ? decryptConnectionSecret(connection.secretsEncrypted)
      : null,
  };
  const adapter = connectorAdapterFor(connection.provider);
  const manifest = await adapter.manifest(context);
  if (manifest.id !== connection.provider) {
    throw new ConnectionControlError(
      "invalid_request",
      "Connector manifest id changed after registration",
    );
  }
  if (!manifest.supportsScopes) {
    return { connection, manifest, scopes: [] };
  }
  const result = await adapter.scopes(context, {
    protocolVersion: CONNECTOR_PROTOCOL_VERSION,
    connectionId: connection.id,
    configuration,
  });
  const selected = new Set(connection.config?.scopeIds ?? []);
  return {
    connection,
    manifest,
    scopes: result.scopes.map((scope) => ({
      ...scope,
      selected: selected.has(scope.id),
    })),
  };
}

export async function listConnectionScopes(args: {
  access: AccessContext;
  connectionId: string;
}): Promise<ConnectionScopeResult> {
  const { connection, manifest, scopes } = await loadScopes(args);
  return {
    connectionId: connection.id,
    provider: connection.provider,
    scopeKind: manifest.scopeKind,
    scopes,
  };
}

export async function configureConnectionScopes(args: {
  access: AccessContext;
  connectionId: string;
  scopeIds: string[];
}): Promise<ConnectionScopeResult> {
  const context = await loadScopes(args);
  if (!context.manifest.supportsScopes || !context.manifest.scopeKind) {
    throw new ConnectionControlError(
      "invalid_request",
      "This connection has no configurable scopes",
    );
  }
  const byId = new Map(context.scopes.map((scope) => [scope.id, scope]));
  const selectedIds = [...new Set(args.scopeIds)];
  for (const scopeId of selectedIds) {
    if (!byId.has(scopeId)) {
      throw new ConnectionControlError(
        "invalid_request",
        `Unknown ${context.manifest.scopeKind} ${scopeId}`,
      );
    }
  }
  await applyConnectionScopeConfiguration(context.connection, selectedIds);
  const selected = new Set(selectedIds);
  return {
    connectionId: context.connection.id,
    provider: context.connection.provider,
    scopeKind: context.manifest.scopeKind,
    scopes: context.scopes.map((scope) => ({
      ...scope,
      selected: selected.has(scope.id),
    })),
  };
}
