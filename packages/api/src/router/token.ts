import { createHash, randomBytes } from "node:crypto";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { and, desc, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { ApiToken, WikiNode } from "@acme/db/schema";

import { targetFolderReadFilter } from "../lib/access";
import { anchorFolderPath } from "../lib/folders";
import { workspaceProcedure } from "../trpc";

// Resolve a token's folder scope to a path. A null folderId is root (""); a
// folderId that resolves to nothing denies rather than widening to "" — a
// deleted scope folder must invalidate the token's reach, not expand it.
// (This genuinely matches resolveTargetFolderPath now; the comment it replaced
// claimed parity while the `?? ""` did the opposite.)
async function scopePath(
  workspaceId: string,
  folderId: string | null,
): Promise<string> {
  const path = await anchorFolderPath(workspaceId, folderId);
  if (path === null) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Folder not found",
    });
  }
  return path;
}

// Tokens are high-entropy random strings; a plain SHA-256 lookup is sufficient
// (no per-token salt). Mirrors `hashApiToken` in the app — @acme/api cannot
// import from apps/nextjs, so the one-liner is duplicated here.
function hashApiToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export const tokenRouter = {
  // A token is visible only to someone who could revoke it — manager scope,
  // matching the REST GET /api/tokens filter. Deliberately stricter than the
  // viewer-level targetFolderReadFilter used by agent/artifact/sources: a token
  // is a credential, so who-holds-what is manager-level information.
  list: workspaceProcedure.query(async ({ ctx, input }) => {
    const { targetPath, scopeFilter } = targetFolderReadFilter(
      ctx.access,
      "manager",
    );
    return db
      .select({
        id: ApiToken.id,
        label: ApiToken.label,
        role: ApiToken.role,
        folderId: ApiToken.folderId,
        folderPath: targetPath,
        lastUsedAt: ApiToken.lastUsedAt,
        expiresAt: ApiToken.expiresAt,
        createdAt: ApiToken.createdAt,
      })
      .from(ApiToken)
      .leftJoin(
        WikiNode,
        and(eq(WikiNode.id, ApiToken.folderId), isNull(WikiNode.deletedAt)),
      )
      .where(and(eq(ApiToken.workspaceId, input.workspaceId), scopeFilter))
      .orderBy(desc(ApiToken.createdAt));
  }),

  // Mint a folder-scoped ApiToken. Requires manager on the target scope; the
  // role is clamped to viewer|contributor so a minted token can never carry
  // manager (no permission changes, no minting further tokens). The raw token
  // is returned exactly once — only its hash is stored.
  create: workspaceProcedure
    .input(
      z.object({
        label: z.string().trim().min(1).max(120),
        role: z.enum(["viewer", "contributor"]),
        targetFolderId: z.string().uuid().nullable().optional(),
        // Null/omitted = no expiry. Set it for tokens handed to external
        // external integrations so access decays by default.
        expiresAt: z.date().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const folderId = input.targetFolderId ?? null;
      const path = await scopePath(input.workspaceId, folderId);
      if (!ctx.access.canManage(path)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Manager access over the target folder required",
        });
      }

      const raw = randomBytes(32).toString("base64url");
      const [row] = await db
        .insert(ApiToken)
        .values({
          workspaceId: input.workspaceId,
          tokenHash: hashApiToken(raw),
          label: input.label,
          folderId,
          role: input.role,
          expiresAt: input.expiresAt ?? null,
        })
        .returning({ id: ApiToken.id });
      if (!row) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Token insert failed",
        });
      }
      return { id: row.id, token: raw };
    }),

  // Revoke a token — manager rights on the token's own folder scope.
  revoke: workspaceProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [token] = await db
        .select({ id: ApiToken.id, folderId: ApiToken.folderId })
        .from(ApiToken)
        .where(
          and(
            eq(ApiToken.id, input.id),
            eq(ApiToken.workspaceId, input.workspaceId),
          ),
        )
        .limit(1);
      if (!token) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Token not found" });
      }

      const path = await scopePath(input.workspaceId, token.folderId);
      if (!ctx.access.canManage(path)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Manager access over the token's folder required",
        });
      }

      await db.delete(ApiToken).where(eq(ApiToken.id, token.id));
      return { ok: true };
    }),
} satisfies TRPCRouterRecord;
