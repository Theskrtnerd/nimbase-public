import { NextResponse } from "next/server";
import { z } from "zod/v4";

import { s3 } from "@acme/cloud";
import { indexNodeVersion } from "@acme/cloud/index-node-version";
import { and, eq, sql } from "@acme/db";
import { db } from "@acme/db/client";
import { WikiNode, WikiNodeVersion } from "@acme/db/schema";

import {
  authorizeWorkspaceRequest,
  authzErrorResponse,
} from "~/server/auth/authorize-workspace";

export const runtime = "nodejs";
export const maxDuration = 300;

// One batch per request to stay under the function timeout. Re-run until
// `remaining` is false. Indexes current note versions that have no chunks yet.
const BATCH = 25;

const Body = z.object({ workspaceId: z.uuid() });

export async function POST(req: Request) {
  // Previously this passed `undefined` as the workspace, which made the
  // ApiToken branch the only reachable one — and every token passed, including
  // a folder-scoped viewer. Re-embedding a whole workspace is admin work and
  // costs real money, so it takes an explicit workspace plus an admin
  // principal. Tokens are always role "member", so they can never satisfy it.
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const authorized = await authorizeWorkspaceRequest(
    req,
    parsed.data.workspaceId,
  );
  if (!authorized.ok) return authzErrorResponse(authorized);
  if (!authorized.access.isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { workspaceId } = authorized;

  // Current versions (node.current_version_id = version.id) with no chunks.
  const pending = await db
    .select({
      id: WikiNodeVersion.id,
      s3Key: WikiNodeVersion.s3Key,
      summary: WikiNodeVersion.summary,
      kind: WikiNode.kind,
    })
    .from(WikiNodeVersion)
    .innerJoin(WikiNode, eq(WikiNode.currentVersionId, WikiNodeVersion.id))
    .where(
      and(
        eq(WikiNodeVersion.workspaceId, workspaceId),
        sql`NOT EXISTS (SELECT 1 FROM wiki_chunk wc WHERE wc.node_version_id = ${WikiNodeVersion.id})`,
      ),
    )
    .limit(BATCH);

  // Each version indexes independently of the others in the batch (bounded to
  // BATCH=25, so unbounded fan-out isn't a concern); failures are reported
  // per-item rather than aborting the batch.
  const results = await Promise.allSettled(
    pending.map(async (version) => {
      const body = await s3.getObjectText(version.s3Key);
      await indexNodeVersion({
        nodeVersionId: version.id,
        workspaceId,
        kind: version.kind === "dataset" ? "dataset" : "note",
        body,
        summary: version.summary,
      });
    }),
  );
  let indexed = 0;
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      indexed++;
    } else {
      console.error(
        "[reindex] failed for version",
        pending[i]?.id,
        result.reason,
      );
    }
  });

  return NextResponse.json({
    indexed,
    batch: pending.length,
    remaining: pending.length === BATCH,
  });
}
