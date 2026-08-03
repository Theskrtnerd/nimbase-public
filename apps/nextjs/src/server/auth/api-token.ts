import "server-only";

import { createHash } from "node:crypto";

import type { GrantRole } from "@acme/db/schema";
import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { ApiToken } from "@acme/db/schema";

// Tokens are high-entropy random strings; a plain SHA-256 lookup is sufficient
// (no need for a per-token salt). The DB stores only the hash.
export function hashApiToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface VerifiedToken {
  workspaceId: string;
  tokenId: string;
  groupMcpId: string | null;
  // Folder scope: null = workspace root, uuid = restricted subtree.
  folderId: string | null;
  role: GrantRole;
}

// Returns the workspace the bearer token belongs to, or null if invalid.
export async function verifyApiToken(
  authorizationHeader: string | null,
): Promise<VerifiedToken | null> {
  if (!authorizationHeader?.startsWith("Bearer ")) return null;
  const raw = authorizationHeader.slice("Bearer ".length).trim();
  if (!raw) return null;

  const rows = await db
    .select({
      id: ApiToken.id,
      workspaceId: ApiToken.workspaceId,
      groupMcpId: ApiToken.groupMcpId,
      folderId: ApiToken.folderId,
      role: ApiToken.role,
      expiresAt: ApiToken.expiresAt,
      lastUsedAt: ApiToken.lastUsedAt,
    })
    .from(ApiToken)
    .where(eq(ApiToken.tokenHash, hashApiToken(raw)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  const now = new Date();
  // Expired tokens fail closed but stay listed so their owner can see and
  // delete them.
  if (row.expiresAt && row.expiresAt <= now) return null;

  // Usage audit trail, throttled to one write per hour per token so the
  // hot path isn't a write amplifier. Best-effort: auth never fails on it.
  if (
    !row.lastUsedAt ||
    now.getTime() - row.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS
  ) {
    try {
      await db
        .update(ApiToken)
        .set({ lastUsedAt: now })
        .where(eq(ApiToken.id, row.id));
    } catch (err) {
      console.error("[api-token] lastUsedAt write failed", err);
    }
  }

  return {
    workspaceId: row.workspaceId,
    tokenId: row.id,
    groupMcpId: row.groupMcpId,
    folderId: row.folderId ?? null,
    role: row.role,
  };
}

const LAST_USED_WRITE_INTERVAL_MS = 60 * 60 * 1000;
