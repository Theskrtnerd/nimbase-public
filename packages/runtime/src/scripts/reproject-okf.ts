// Rebuild the derived Postgres index from the canonical S3 bodies.
//
// This is the command that makes "frontmatter is the source of truth" a
// testable claim rather than a convention. It reads every live node's current
// version body, runs it through the OKF codec, and compares the projection
// against what Postgres actually holds:
//
//   pnpm -F @acme/runtime reproject:okf -- --check    # report drift, write nothing
//   pnpm -F @acme/runtime reproject:okf               # repair drift
//   pnpm -F @acme/runtime reproject:okf -- --workspace <id>
//
// (prefix with `infisical run --` for real credentials.)
//
// It deliberately does NOT create new versions: bodies are already canonical,
// so this only recomputes the index (wiki_node.title/kind,
// wiki_node_version.summary, wiki_node_tag, wiki_node_source). Nothing here
// authors content, which is why it is allowed to write those columns outside
// GardenerFs.writeVersion.
//
// Use it after adding a field to the FIELDS registry (to backfill the new
// projection) or whenever you want to prove the two sides agree.
import { and, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import {
  WikiNode,
  WikiNodeSource,
  WikiNodeTag,
  WikiNodeVersion,
} from "@acme/db/schema";

import type { OkfDbProjection } from "../memory/okf/codec";
import { parseOkf, projectToDb } from "../memory/okf/codec";
import * as s3 from "../s3";

interface Drift {
  path: string;
  field: string;
  db: string;
  body: string;
}

function fmt(value: string | readonly string[] | null | undefined): string {
  if (value === null || value === undefined) return "∅";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "∅";
  return value.length > 0 ? (value as string) : "∅";
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((v) => set.has(v));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes("--check");
  const wsIndex = argv.indexOf("--workspace");
  const workspaceId = wsIndex >= 0 ? argv[wsIndex + 1] : undefined;

  const where = workspaceId
    ? and(isNull(WikiNode.deletedAt), eq(WikiNode.workspaceId, workspaceId))
    : isNull(WikiNode.deletedAt);

  const nodes = await db
    .select({
      id: WikiNode.id,
      workspaceId: WikiNode.workspaceId,
      path: WikiNode.path,
      kind: WikiNode.kind,
      title: WikiNode.title,
      currentVersionId: WikiNode.currentVersionId,
    })
    .from(WikiNode)
    .where(where);

  const concepts = nodes.filter(
    (n) => n.kind !== "folder" && n.currentVersionId !== null,
  );
  console.log(
    `${concepts.length} live concept node(s)${workspaceId ? ` in workspace ${workspaceId}` : ""}`,
  );

  const drifts: Drift[] = [];
  let repaired = 0;
  let unreadable = 0;

  for (const node of concepts) {
    const versionId = node.currentVersionId;
    if (!versionId) continue;

    const [version] = await db
      .select({
        id: WikiNodeVersion.id,
        s3Key: WikiNodeVersion.s3Key,
        summary: WikiNodeVersion.summary,
      })
      .from(WikiNodeVersion)
      .where(eq(WikiNodeVersion.id, versionId));
    if (!version?.s3Key) {
      unreadable++;
      continue;
    }

    let body: string;
    try {
      body = await s3.getObjectText(version.s3Key);
    } catch (err) {
      console.error(`  ! ${node.path}: unreadable body (${String(err)})`);
      unreadable++;
      continue;
    }

    const projected: OkfDbProjection = projectToDb(parseOkf(body).meta);

    const [dbTags, dbSources] = await Promise.all([
      db
        .select({ tag: WikiNodeTag.tag })
        .from(WikiNodeTag)
        .where(eq(WikiNodeTag.nodeId, node.id)),
      db
        .select({ sourceId: WikiNodeSource.sourceId })
        .from(WikiNodeSource)
        .where(eq(WikiNodeSource.nodeId, node.id)),
    ]);

    const current = {
      // The body's title is allowed to be absent on legacy notes; the node
      // title is the fallback the write path would have stamped, so treat
      // "body says nothing" as agreement rather than drift.
      title: projected.title ?? node.title,
      kind: projected.kind,
      summary: projected.summary ?? "",
      tags: dbTags.map((t) => t.tag),
      sourceIds: dbSources.map((s) => s.sourceId),
    };

    const nodeDrifts: Drift[] = [];
    if (current.title !== node.title) {
      nodeDrifts.push({
        path: node.path,
        field: "title",
        db: fmt(node.title),
        body: fmt(current.title),
      });
    }
    if (projected.kind !== node.kind) {
      nodeDrifts.push({
        path: node.path,
        field: "kind",
        db: fmt(node.kind),
        body: fmt(projected.kind),
      });
    }
    if (current.summary !== (version.summary ?? "")) {
      nodeDrifts.push({
        path: node.path,
        field: "summary",
        db: fmt(version.summary),
        body: fmt(current.summary),
      });
    }
    if (!sameSet(current.tags, projected.tags)) {
      nodeDrifts.push({
        path: node.path,
        field: "tags",
        db: fmt(current.tags),
        body: fmt(projected.tags),
      });
    }
    if (!sameSet(current.sourceIds, projected.sourceIds)) {
      nodeDrifts.push({
        path: node.path,
        field: "sources",
        db: fmt(current.sourceIds),
        body: fmt(projected.sourceIds),
      });
    }

    if (nodeDrifts.length === 0) continue;
    drifts.push(...nodeDrifts);
    for (const d of nodeDrifts) {
      console.log(`  ~ ${d.path} [${d.field}] db=${d.db} → body=${d.body}`);
    }
    if (checkOnly) continue;

    await db
      .update(WikiNode)
      .set({ title: current.title, kind: projected.kind })
      .where(eq(WikiNode.id, node.id));
    await db
      .update(WikiNodeVersion)
      .set({ summary: current.summary })
      .where(eq(WikiNodeVersion.id, version.id));

    await db.delete(WikiNodeTag).where(eq(WikiNodeTag.nodeId, node.id));
    if (projected.tags.length > 0) {
      await db.insert(WikiNodeTag).values(
        projected.tags.map((tag) => ({
          workspaceId: node.workspaceId,
          nodeId: node.id,
          tag,
        })),
      );
    }

    await db.delete(WikiNodeSource).where(eq(WikiNodeSource.nodeId, node.id));
    if (projected.sourceIds.length > 0) {
      await db
        .insert(WikiNodeSource)
        .values(
          projected.sourceIds.map((sourceId) => ({
            workspaceId: node.workspaceId,
            nodeId: node.id,
            sourceId,
          })),
        )
        .onConflictDoNothing({
          target: [WikiNodeSource.nodeId, WikiNodeSource.sourceId],
        });
    }
    repaired++;
  }

  console.log(
    checkOnly
      ? `\n${drifts.length} drifted field(s) across ${new Set(drifts.map((d) => d.path)).size} node(s); ${unreadable} unreadable. No writes.`
      : `\nrepaired ${repaired} node(s) (${drifts.length} field(s)); ${unreadable} unreadable.`,
  );

  // --check is a gate: non-zero when the derived index disagrees with the
  // canonical bodies, so CI can assert the two sides never diverge.
  if (checkOnly && drifts.length > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
