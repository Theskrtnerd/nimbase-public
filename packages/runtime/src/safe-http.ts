import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent, fetch } from "undici";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 3;

const blockedAddresses = new BlockList();
blockedAddresses.addSubnet("0.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("10.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("100.64.0.0", 10, "ipv4");
blockedAddresses.addSubnet("127.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("169.254.0.0", 16, "ipv4");
blockedAddresses.addSubnet("172.16.0.0", 12, "ipv4");
blockedAddresses.addSubnet("192.0.0.0", 24, "ipv4");
blockedAddresses.addSubnet("192.0.2.0", 24, "ipv4");
blockedAddresses.addSubnet("192.168.0.0", 16, "ipv4");
blockedAddresses.addSubnet("198.18.0.0", 15, "ipv4");
blockedAddresses.addSubnet("198.51.100.0", 24, "ipv4");
blockedAddresses.addSubnet("203.0.113.0", 24, "ipv4");
blockedAddresses.addSubnet("224.0.0.0", 3, "ipv4");
blockedAddresses.addSubnet("::", 128, "ipv6");
blockedAddresses.addSubnet("::1", 128, "ipv6");
blockedAddresses.addSubnet("::ffff:0:0", 96, "ipv6");
// Public IPv6 unicast is currently 2000::/3. Deny every other top-level range,
// then close protocol/documentation tunnels within that range which can encode
// non-public destinations.
blockedAddresses.addSubnet("::", 3, "ipv6");
blockedAddresses.addSubnet("4000::", 2, "ipv6");
blockedAddresses.addSubnet("8000::", 1, "ipv6");
blockedAddresses.addSubnet("2001::", 23, "ipv6");
blockedAddresses.addSubnet("2001:db8::", 32, "ipv6");
blockedAddresses.addSubnet("2002::", 16, "ipv6");
blockedAddresses.addSubnet("fc00::", 7, "ipv6");
blockedAddresses.addSubnet("fe80::", 10, "ipv6");
blockedAddresses.addSubnet("ff00::", 8, "ipv6");

export class OutboundRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundRequestError";
  }
}

interface SafeFetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  redirect?: "error" | "follow";
  maxRedirects?: number;
  allowPrivateNetwork?: boolean;
}

function normalizeHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function isBlockedAddress(address: string, family: number): boolean {
  return blockedAddresses.check(address, family === 6 ? "ipv6" : "ipv4");
}

async function resolveAddresses(hostname: string) {
  const normalized = normalizeHostname(hostname).toLowerCase();
  const family = isIP(normalized);
  const addresses = family
    ? [{ address: normalized, family }]
    : await lookup(normalized, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new OutboundRequestError("outbound hostname did not resolve");
  }
  return addresses;
}

const publicDispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      void resolveAddresses(hostname).then(
        (addresses) => {
          if (
            addresses.some(({ address, family }) =>
              isBlockedAddress(address, family),
            )
          ) {
            callback(
              new OutboundRequestError(
                "outbound hostname resolves to a non-public address",
              ),
              [],
            );
            return;
          }
          if (options.all) {
            callback(null, addresses);
            return;
          }
          const first = addresses[0];
          if (!first) {
            callback(
              new OutboundRequestError("outbound hostname did not resolve"),
              [],
            );
            return;
          }
          callback(null, first.address, first.family);
        },
        (error: unknown) => {
          callback(
            error instanceof Error
              ? error
              : new OutboundRequestError("outbound DNS lookup failed"),
            [],
          );
        },
      );
    },
  },
});

function validateUrl(url: URL, allowPrivateNetwork: boolean): void {
  if (url.username || url.password) {
    throw new OutboundRequestError("outbound URLs cannot contain credentials");
  }
  if (url.protocol === "https:") return;
  if (allowPrivateNetwork && url.protocol === "http:") return;
  throw new OutboundRequestError("outbound URL must use HTTPS");
}

async function assertPublicDestination(url: URL): Promise<void> {
  const addresses = await resolveAddresses(url.hostname);
  if (
    addresses.some(({ address, family }) => isBlockedAddress(address, family))
  ) {
    throw new OutboundRequestError(
      "outbound hostname resolves to a non-public address",
    );
  }
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

export async function safeFetch(
  input: string | URL,
  options: SafeFetchOptions = {},
) {
  const allowPrivateNetwork = options.allowPrivateNetwork ?? false;
  const redirect = options.redirect ?? "error";
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let url = new URL(input);

  for (let followed = 0; ; followed++) {
    validateUrl(url, allowPrivateNetwork);
    if (!allowPrivateNetwork) await assertPublicDestination(url);
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      body: options.body,
      redirect: "manual",
      dispatcher: allowPrivateNetwork ? undefined : publicDispatcher,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    if (!isRedirect(response.status)) return response;
    if (redirect === "error") {
      await response.body?.cancel();
      throw new OutboundRequestError("outbound redirects are not allowed");
    }
    if (followed >= maxRedirects) {
      await response.body?.cancel();
      throw new OutboundRequestError("outbound redirect limit exceeded");
    }
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) {
      throw new OutboundRequestError("outbound redirect has no location");
    }
    url = new URL(location, url);
  }
}

export async function readResponseBytes(
  response: Awaited<ReturnType<typeof safeFetch>>,
  maxBytes: number,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    throw new OutboundRequestError("outbound response exceeds the size limit");
  }
  if (!response.body) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const body = response.body as AsyncIterable<unknown>;
  for await (const value of body) {
    if (!(value instanceof Uint8Array)) {
      throw new OutboundRequestError(
        "outbound response returned invalid bytes",
      );
    }
    const chunk = value;
    bytes += chunk.byteLength;
    if (bytes > maxBytes) {
      throw new OutboundRequestError(
        "outbound response exceeds the size limit",
      );
    }
    chunks.push(chunk);
  }

  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function readResponseText(
  response: Awaited<ReturnType<typeof safeFetch>>,
  maxBytes: number,
): Promise<string> {
  return new TextDecoder().decode(await readResponseBytes(response, maxBytes));
}
