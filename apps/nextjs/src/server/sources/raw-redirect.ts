import "server-only";

import { NextResponse } from "next/server";

import { providerAccessFilter } from "@acme/api/provider-access";
import { and, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { Source, WikiNode } from "@acme/db/schema";
import * as s3 from "@acme/runtime/s3";

import {
  authorizeWorkspaceRequest,
  authzErrorTextResponse,
} from "~/server/auth/authorize-workspace";
import { invalidIdTextResponse, isUuidParam } from "~/server/http/params";

export type SourceArtifactVariant = "original" | "raw-md";

/**
 * Trace-back: redirect an authorized viewer to a short-lived presigned GET of
 * a source's stored artifact — the byte-exact original, or the extracted
 * raw.md (null until ingest/extraction finishes, or for pre-migration rows
 * that never got one). Bytes never stream through the function.
 */
export async function redirectToSourceArtifact(
  req: Request,
  id: string,
  variant: SourceArtifactVariant,
): Promise<Response> {
  if (!isUuidParam(id)) return invalidIdTextResponse();

  const [source] = await db
    .select({
      workspaceId: Source.workspaceId,
      s3KeyOriginal: Source.s3KeyOriginal,
      s3KeyRawMd: Source.s3KeyRawMd,
      targetFolderId: Source.targetFolderId,
    })
    .from(Source)
    .where(eq(Source.id, id))
    .limit(1);
  if (!source) return new Response("Not found", { status: 404 });

  const authorized = await authorizeWorkspaceRequest(req, source.workspaceId);
  if (!authorized.ok) return authzErrorTextResponse(authorized);

  // Same visibility rule as sources.list: the artifact is readable iff its
  // target space is (root "" when untargeted or the folder was soft-deleted).
  let targetPath = "";
  if (source.targetFolderId) {
    const [folder] = await db
      .select({ path: WikiNode.path })
      .from(WikiNode)
      .where(
        and(
          eq(WikiNode.id, source.targetFolderId),
          eq(WikiNode.workspaceId, source.workspaceId),
          isNull(WikiNode.deletedAt),
        ),
      )
      .limit(1);
    if (folder) targetPath = folder.path;
  }
  if (!authorized.access.canRead(targetPath)) {
    return new Response("Not found", { status: 404 });
  }
  const [providerReadable] = await db
    .select({ id: Source.id })
    .from(Source)
    .where(
      and(
        eq(Source.id, id),
        providerAccessFilter(authorized.access, Source.accessPolicyId),
      ),
    )
    .limit(1);
  if (!providerReadable) return new Response("Not found", { status: 404 });

  const key = variant === "original" ? source.s3KeyOriginal : source.s3KeyRawMd;
  if (!key) return new Response("Not found", { status: 404 });

  const url = await s3.presignGetUrl(key);
  return NextResponse.redirect(url, { status: 302 });
}
