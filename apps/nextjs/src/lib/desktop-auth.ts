import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { env } from "~/env";

// PKCE auth for native clients, including the CLI. The /desktop/authorize and
// /api/extension/token route names are legacy naming kept for compatibility.

// One-time authorization code (5 min) issued by /desktop/authorize and
// redeemed by the token routes in exchange for a session token.
const CODE_TTL_MS = 5 * 60 * 1000;

// Client session token (30 days). Stored on-device by the client.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface CodePayload {
  userId: string;
  challenge: string;
  state: string;
  exp: number;
}

interface SessionPayload {
  userId: string;
  exp: number;
}

function getSecret(): string {
  return env.DESKTOP_AUTH_SECRET;
}

function base64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(
    input.replaceAll("-", "+").replaceAll("_", "/") + pad,
    "base64",
  );
}

function sign(payload: object, label: string): string {
  const body = base64url(JSON.stringify(payload));
  const sig = base64url(
    createHmac("sha256", getSecret()).update(`${label}.${body}`).digest(),
  );
  return `${body}.${sig}`;
}

function verify<T>(token: string, label: string): T | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = base64url(
    createHmac("sha256", getSecret()).update(`${label}.${body}`).digest(),
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(fromBase64url(body).toString("utf8")) as {
      exp: number;
    };
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

export function issueAuthCode(input: {
  userId: string;
  challenge: string;
  state: string;
}): string {
  const payload: CodePayload = {
    userId: input.userId,
    challenge: input.challenge,
    state: input.state,
    exp: Date.now() + CODE_TTL_MS,
  };
  return sign(payload, "code");
}

export function redeemAuthCode(input: {
  code: string;
  codeVerifier: string;
}): { userId: string } | null {
  const payload = verify<CodePayload>(input.code, "code");
  if (!payload) return null;
  const challenge = base64url(
    createHash("sha256").update(input.codeVerifier).digest(),
  );
  const a = Buffer.from(challenge);
  const b = Buffer.from(payload.challenge);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { userId: payload.userId };
}

export function issueSessionToken(userId: string): {
  token: string;
  expiresAt: number;
} {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload: SessionPayload = { userId, exp };
  return { token: sign(payload, "session"), expiresAt: exp };
}

export function verifySessionToken(token: string): { userId: string } | null {
  const payload = verify<SessionPayload>(token, "session");
  return payload ? { userId: payload.userId } : null;
}
