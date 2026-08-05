import "server-only";

import {
  CONNECTOR_MANIFEST_PATH,
  CONNECTOR_PULL_PATH,
  CONNECTOR_SCOPES_PATH,
  connectorManifestSchema,
  connectorPullResponseSchema,
  connectorScopesResponseSchema,
} from "@nimbase/connector-sdk";

import { readResponseText, safeFetch } from "@acme/runtime/safe-http";

import type { ConnectorAdapter, ConnectorRequestContext } from "./types";
import { env } from "~/env";

const MANIFEST_TIMEOUT_MS = 10_000;
const PULL_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 12_000_000;

function endpoint(baseUrl: string, path: string): URL {
  const base = new URL(baseUrl);
  return new URL(path, base);
}

async function connectorRequest(args: {
  context: ConnectorRequestContext;
  path: string;
  method: "GET" | "POST";
  body?: unknown;
  timeoutMs: number;
}): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (args.context.secret) {
    headers.Authorization = `Bearer ${args.context.secret}`;
  }
  if (args.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await safeFetch(
    endpoint(args.context.endpointUrl, args.path),
    {
      method: args.method,
      headers,
      body: args.body === undefined ? undefined : JSON.stringify(args.body),
      redirect: "error",
      timeoutMs: args.timeoutMs,
      allowPrivateNetwork: env.NIMBASE_ALLOW_PRIVATE_CONNECTORS,
    },
  );
  if (!response.ok) {
    throw new Error(`connector request failed with status ${response.status}`);
  }
  const text = await readResponseText(response, MAX_RESPONSE_BYTES);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("connector returned invalid JSON");
  }
}

export const remoteConnector: ConnectorAdapter = {
  async manifest(context) {
    const value = await connectorRequest({
      context,
      path: CONNECTOR_MANIFEST_PATH,
      method: "GET",
      timeoutMs: MANIFEST_TIMEOUT_MS,
    });
    return connectorManifestSchema.parse(value);
  },
  async pull(context, request) {
    const value = await connectorRequest({
      context,
      path: CONNECTOR_PULL_PATH,
      method: "POST",
      body: request,
      timeoutMs: PULL_TIMEOUT_MS,
    });
    return connectorPullResponseSchema.parse(value);
  },
  async scopes(context, request) {
    const value = await connectorRequest({
      context,
      path: CONNECTOR_SCOPES_PATH,
      method: "POST",
      body: request,
      timeoutMs: MANIFEST_TIMEOUT_MS,
    });
    return connectorScopesResponseSchema.parse(value);
  },
};
