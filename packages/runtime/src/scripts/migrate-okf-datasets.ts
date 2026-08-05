// One-off: convert legacy JSON dataset bodies to OKF markdown concepts.
// Idempotent — skips nodes whose current body already begins with a
// frontmatter block. Renames `.json` leaves to `.md`. Run with:
//   infisical run -- pnpm -F @acme/runtime migrate:okf-datasets
// (the package script preloads the tsx hooks that shim "server-only").
// Afterwards, run the admin reindex (POST /api/admin/reindex) to embed the
// new versions.
import { and, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { WikiNode, WikiNodeVersion } from "@acme/db/schema";

import { serializeOkf } from "../memory/okf/codec";
import { datasetToMarkdown } from "../memory/okf/dataset-markdown";
import * as s3 from "../s3";

async function main(): Promise<void> {
  const nodes = await db
    .select({
      id: WikiNode.id,
      workspaceId: WikiNode.workspaceId,
      path: WikiNode.path,
      title: WikiNode.title,
      currentVersionId: WikiNode.currentVersionId,
    })
    .from(WikiNode)
    .where(and(eq(WikiNode.kind, "dataset"), isNull(WikiNode.deletedAt)));

  console.log(`${nodes.length} live dataset node(s)`);
  let converted = 0;
  let skipped = 0;

  for (const node of nodes) {
    if (!node.currentVersionId) {
      skipped++;
      continue;
    }
    const [version] = await db
      .select({
        s3Key: WikiNodeVersion.s3Key,
        summary: WikiNodeVersion.summary,
      })
      .from(WikiNodeVersion)
      .where(eq(WikiNodeVersion.id, node.currentVersionId))
      .limit(1);
    if (!version?.s3Key) {
      skipped++;
      continue;
    }

    const body = await s3.getObjectText(version.s3Key);
    if (body.startsWith("---")) {
      skipped++; // already OKF markdown
      continue;
    }

    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      console.error(`SKIP ${node.path}: body is neither OKF nor JSON`);
      skipped++;
      continue;
    }

    const stored = serializeOkf(
      {
        type: "Dataset",
        title: node.title,
        ...(version.summary ? { description: version.summary } : {}),
        timestamp: new Date().toISOString(),
      },
      datasetToMarkdown(json),
    );

    // New version (append-only), same flow as writeVersion minus indexing.
    const [inserted] = await db
      .insert(WikiNodeVersion)
      .values({
        nodeId: node.id,
        workspaceId: node.workspaceId,
        s3Key: "",
        summary: version.summary ?? "",
        sourceId: null,
      })
      .returning({ id: WikiNodeVersion.id });
    if (!inserted) throw new Error(`version insert failed for ${node.path}`);

    const key = s3.s3KeyFor.wikiBody(node.workspaceId, inserted.id);
    await s3.putObject(key, stored, "text/markdown");
    await db
      .update(WikiNodeVersion)
      .set({ s3Key: key })
      .where(eq(WikiNodeVersion.id, inserted.id));

    const newPath = node.path.replace(/\.json$/, ".md");
    await db
      .update(WikiNode)
      .set({ currentVersionId: inserted.id, path: newPath })
      .where(eq(WikiNode.id, node.id));

    console.log(`OK ${node.path} -> ${newPath}`);
    converted++;
  }

  console.log(`done: ${converted} converted, ${skipped} skipped`);
  console.log(
    "run the admin reindex (POST /api/admin/reindex) to embed the new versions",
  );
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
