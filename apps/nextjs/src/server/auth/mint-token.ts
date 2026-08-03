import "server-only";

import { randomBytes } from "node:crypto";

import { db } from "@acme/db/client";
import { ApiToken } from "@acme/db/schema";

import { hashApiToken } from "./api-token";

// Roles a minted token may carry. Never "manager": a token must not be able to
// change permissions or mint further tokens (CLAUDE.md).
export type MintableRole = "viewer" | "contributor";

/** A high-entropy, url-safe bearer token. Only its hash is ever stored. */
export function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface MintTokenInput {
  workspaceId: string;
  role: MintableRole;
  folderId: string | null;
  label: string;
  // Null/omitted = no expiry. Set it for short-lived external integrations.
  expiresAt?: Date | null;
}

export interface MintedToken {
  id: string;
  token: string;
  role: MintableRole;
  label: string;
}

export async function mintToken(input: MintTokenInput): Promise<MintedToken> {
  const raw = generateRawToken();
  const [row] = await db
    .insert(ApiToken)
    .values({
      workspaceId: input.workspaceId,
      tokenHash: hashApiToken(raw),
      label: input.label,
      folderId: input.folderId,
      role: input.role,
      expiresAt: input.expiresAt ?? null,
    })
    .returning({ id: ApiToken.id });
  if (!row) throw new Error("token insert failed");
  return { id: row.id, token: raw, role: input.role, label: input.label };
}
