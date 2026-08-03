import { createHash, randomBytes } from "node:crypto";

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export interface Pkce {
  verifier: string;
  challenge: string;
  state: string;
}

/** Generate a PKCE verifier + S256 challenge + CSRF state for the login flow. */
export function createPkce(): Pkce {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));
  return { verifier, challenge, state };
}
