import { and, eq, isNotNull, isNull, or } from "@acme/db";
import { db } from "@acme/db/client";
import { AccessGrant, WikiNode } from "@acme/db/schema";

import type { AccessContext } from "./access";

export interface CaptureTarget {
  folderId: string | null; // null = workspace root
  path: string; // "" = root
  label: string;
}

// Spaces = root + folders that carry a grant or a restricted flag, filtered
// to where the caller can actually capture. Shared by the tRPC router and
// the extension REST route.
export async function listCaptureTargets(
  access: AccessContext,
): Promise<CaptureTarget[]> {
  const anchors = await db
    .selectDistinct({ id: WikiNode.id, path: WikiNode.path })
    .from(WikiNode)
    .leftJoin(AccessGrant, eq(AccessGrant.folderId, WikiNode.id))
    .where(
      and(
        eq(WikiNode.workspaceId, access.workspaceId),
        isNull(WikiNode.deletedAt),
        or(eq(WikiNode.restricted, true), isNotNull(AccessGrant.id)),
      ),
    );

  const targets: CaptureTarget[] = [];
  if (access.canCapture("")) {
    targets.push({ folderId: null, path: "", label: "Workspace root" });
  }
  for (const anchor of anchors.sort((a, b) => a.path.localeCompare(b.path))) {
    if (access.canCapture(anchor.path)) {
      targets.push({
        folderId: anchor.id,
        path: anchor.path,
        label: anchor.path,
      });
    }
  }
  return targets;
}
