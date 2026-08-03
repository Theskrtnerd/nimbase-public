import "server-only";

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import {
  CONNECTOR_MANIFEST_PATH,
  CONNECTOR_PULL_PATH,
  CONNECTOR_SCOPES_PATH,
  connectorManifestSchema,
  connectorPullResponseSchema,
  connectorScopesResponseSchema,
} from "@nimbase/connector-sdk";

import type { ConnectorAdapter, ConnectorRequestContext } from "./types";

const MANIFEST_TIMEOUT_MS = 10_000;
const PULL_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 12_000_000;

const privateAddresses = new BlockList();
privateAddresses.addSubnet("0.0.0.0", 8, "ipv4");
privateAddresses.addSubnet("10.0.0.0", 8, "ipv4");
privateAddresses.addSubnet("100.64.0.0", 10, "ipv4");
privateAddresses.addSubnet("127.0.0.0", 8, "ipv4");
privateAddresses.addSubnet("169.254.0.0", 16, "ipv4");
privateAddresses.addSubnet("172.16.0.0", 12, "ipv4");
privateAddresses.addSubnet("192.0.0.0", 24, "ipv4");
privateAddresses.addSubnet("192.0.2.0", 24, "ipv4");
privateAddresses.addSubnet("192.168.0.0", 16, "ipv4");
privateAddresses.addSubnet("198.18.0.0", 15, "ipv4");
privateAddresses.addSubnet("198.51.100.0", 24, "ipv4");
privateAddresses.addSubnet("203.0.113.0", 24, "ipv4");
privateAddresses.addSubnet("224.0.0.0", 3, "ipv4");
privateAddresses.addSubnet("::", 128, "ipv6");
privateAddresses.addSubnet("::1", 128, "ipv6");
privateAddresses.addSubnet("2001:db8::", 32, "ipv6");
privateAddresses.addSubnet("fc00::", 7, "ipv6");
privateAddresses.addSubnet("fe80::", 10, "ipv6");
privateAddresses.addSubnet("ff00::", 8, "ipv6");

function unbracket(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

async function endpoint(baseUrl: string, path: string): Promise<URL> {
  const base = new URL(baseUrl);
  const hostname = unbracket(base.hostname).toLowerCase();
  const local =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (base.protocol !== "https:" && !(base.protocol === "http:" && local)) {
    throw new Error("connector endpoint must use HTTPS (HTTP is local-only)");
  }
  if (!local) {
    const family = isIP(hostname);
    const addresses = family
      ? [{ address: hostname, family }]
      : await lookup(hostname, { all: true, verbatim: true });
    if (
      addresses.length === 0 ||
      addresses.some(({ address, family: addressFamily }) =>
        privateAddresses.check(address, addressFamily === 6 ? "ipv6" : "ipv4"),
      )
    ) {
      throw new Error("connector endpoint resolves to a non-public address");
    }
  }
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

  const response = await fetch(
    await endpoint(args.context.endpointUrl, args.path),
    {
      method: args.method,
      headers,
      body: args.body === undefined ? undefined : JSON.stringify(args.body),
      redirect: "error",
      signal: AbortSignal.timeout(args.timeoutMs),
    },
  );
  if (!response.ok) {
    throw new Error(`connector request failed with status ${response.status}`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("connector response exceeds the size limit");
  }
  const text = await readResponseText(response);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("connector returned invalid JSON");
  }
}

async function readResponseText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("connector response exceeds the size limit");
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join("");
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
