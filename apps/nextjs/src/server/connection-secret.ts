import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { env } from "~/env";

// AES-256-GCM sealing shared by connector and agent connection credentials.
// Format: base64(iv).base64(authTag).base64(ciphertext).
function key(): Buffer {
  const secret = env.AGENT_CONNECTION_SECRET;
  if (!secret) {
    throw new Error("AGENT_CONNECTION_SECRET is not set");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptConnectionSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

export function decryptConnectionSecret(sealed: string): string {
  const [ivB64, tagB64, ciphertextB64] = sealed.split(".");
  if (!ivB64 || !tagB64 || !ciphertextB64) {
    throw new Error("malformed sealed secret");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
