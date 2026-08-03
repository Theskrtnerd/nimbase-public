import "server-only";

import { randomUUID } from "node:crypto";
import type { JsonValue } from "@nimbase/connector-sdk";

import { db } from "@acme/db/client";
import { SourceConnection } from "@acme/db/schema";

import { encryptConnectionSecret } from "../connection-secret";
import { remoteConnector } from "./remote-connector";

export async function registerRemoteConnector(args: {
  workspaceId: string;
  userId: string;
  targetFolderId: string | null;
  endpointUrl: string;
  secret: string | null;
  displayName: string | null;
  intervalSeconds: number;
  configuration: Record<string, JsonValue>;
}): Promise<{
  connectionId: string;
  provider: string;
  label: string;
  scopeKind: string | null;
  supportsScopes: boolean;
}> {
  const endpointUrl = new URL(args.endpointUrl).toString();
  const manifest = await remoteConnector.manifest({
    endpointUrl,
    secret: args.secret,
  });
  const now = new Date();
  const [connection] = await db
    .insert(SourceConnection)
    .values({
      id: randomUUID(),
      workspaceId: args.workspaceId,
      provider: manifest.id,
      displayName: args.displayName ?? manifest.label,
      authKind: "connector_http",
      connectorUrl: endpointUrl,
      routeKey: endpointUrl,
      secretsEncrypted: args.secret
        ? encryptConnectionSecret(args.secret)
        : null,
      targetFolderId: args.targetFolderId,
      config: args.configuration,
      status: "active",
      intervalSeconds: args.intervalSeconds,
      nextRunAt: now,
      createdByUserId: args.userId,
    })
    .onConflictDoUpdate({
      target: [
        SourceConnection.workspaceId,
        SourceConnection.provider,
        SourceConnection.routeKey,
      ],
      set: {
        displayName: args.displayName ?? manifest.label,
        authKind: "connector_http",
        connectorUrl: endpointUrl,
        secretsEncrypted: args.secret
          ? encryptConnectionSecret(args.secret)
          : null,
        targetFolderId: args.targetFolderId,
        config: args.configuration,
        status: "active",
        intervalSeconds: args.intervalSeconds,
        cursor: null,
        nextRunAt: now,
        lastError: null,
        consecutiveFailures: 0,
        updatedAt: now,
      },
    })
    .returning({ id: SourceConnection.id });
  if (!connection) throw new Error("could not register connector");
  return {
    connectionId: connection.id,
    provider: manifest.id,
    label: manifest.label,
    scopeKind: manifest.scopeKind,
    supportsScopes: manifest.supportsScopes,
  };
}
