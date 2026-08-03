import "server-only";

import type { BrainInitJobData } from "@acme/cloud";
import { buildAccessContext } from "@acme/api/access";
import { toProviderContext } from "@acme/cloud";
import {
  COMPANY_MD_PATH,
  draftCompanyMd,
  enrichCompanyWebsite,
} from "@acme/cloud/biographer";
import { memoryProvider } from "@acme/cloud/memory/wiki-pg-provider";
import * as s3 from "@acme/cloud/s3";
import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { Workspace } from "@acme/db/schema";

import { ingestSource } from "~/server/ingest/ingest-source";

// Day-zero Biographer job: one site fetch feeds both the company.md draft and
// the website Source ingest. draftCompanyMd never throws (deterministic
// fallback), so "failed" here means the memory write itself failed.
export async function runBrainInitJob(data: BrainInitJobData): Promise<void> {
  const [workspace] = await db
    .select({
      id: Workspace.id,
      name: Workspace.name,
      description: Workspace.description,
      website: Workspace.website,
      ownerUserId: Workspace.ownerUserId,
    })
    .from(Workspace)
    .where(eq(Workspace.id, data.workspaceId))
    .limit(1);
  if (!workspace) return;

  // Explicit null (from onboarding: "no website") means skip; undefined
  // (job dispatched without the field) falls back to the workspace's stored
  // website, if any.
  const websiteUrl =
    data.websiteUrl === undefined
      ? (workspace.website ?? null)
      : data.websiteUrl;
  const enrichment = websiteUrl
    ? await enrichCompanyWebsite(websiteUrl)
    : { title: null, description: null, logoUrl: null, siteText: null };
  const identitySources = data.identitySources ?? {
    title: data.identitySource,
    description: data.identitySource,
  };
  const discoveredTitle =
    identitySources.title === "website" &&
    enrichment.title &&
    enrichment.title !== workspace.name
      ? enrichment.title
      : null;
  const discoveredDescription =
    identitySources.description === "website" &&
    enrichment.description &&
    enrichment.description !== workspace.description
      ? enrichment.description
      : null;
  const name = discoveredTitle ?? workspace.name;
  const description = discoveredDescription ?? workspace.description;

  try {
    if (discoveredTitle || discoveredDescription) {
      await db
        .update(Workspace)
        .set({
          ...(discoveredTitle ? { name: discoveredTitle } : {}),
          ...(discoveredDescription
            ? { description: discoveredDescription }
            : {}),
        })
        .where(eq(Workspace.id, workspace.id));
    }

    // Brand data is optional and must never prevent workspace creation. Keep a
    // local copy of the chosen logo so the product doesn't depend on a remote
    // asset remaining available after onboarding.
    if (enrichment.logoUrl) {
      try {
        const logo = await fetch(enrichment.logoUrl);
        const contentType = logo.headers.get("content-type") ?? "image/svg+xml";
        if (logo.ok && contentType.startsWith("image/")) {
          await s3.putObject(
            `workspaces/${workspace.id}/branding/logo`,
            new Uint8Array(await logo.arrayBuffer()),
            contentType,
          );
        }
      } catch (err) {
        console.error("[brain-init] logo download failed (continuing)", err);
      }
    }

    const content = await draftCompanyMd({
      workspaceId: workspace.id,
      name,
      description,
      websiteUrl,
      siteText: enrichment.siteText,
    });

    // The job runs ownerless of a session; the workspace owner is the acting
    // principal (owner role ⇒ unrestricted scopes, same as the old tRPC path).
    const access = buildAccessContext({
      workspaceId: workspace.id,
      userId: workspace.ownerUserId,
      role: "owner",
      grants: [],
      restricted: [],
    });

    await memoryProvider.upsert(toProviderContext(access), {
      kind: "note",
      type: "Company Profile",
      path: COMPANY_MD_PATH,
      title: name,
      content,
      summary: "Company overview — the root note, tended by the Biographer",
    });

    // NOT-91: the website becomes a real Source so it compiles into memory.
    // Best-effort — an ingest failure must not fail brain init.
    if (websiteUrl) {
      try {
        await ingestSource(
          {
            kind: "web",
            sourceUrl: websiteUrl,
            title: `${name} website`,
            text: enrichment.siteText ?? websiteUrl,
          },
          {
            workspaceId: workspace.id,
            userId: workspace.ownerUserId,
            targetFolderId: null,
          },
        );
      } catch (err) {
        console.error("[brain-init] website ingest failed (continuing)", err);
      }
    }

    await db
      .update(Workspace)
      .set({ brainInitStatus: "done" })
      .where(eq(Workspace.id, workspace.id));
  } catch (err) {
    console.error("[brain-init] failed", err);
    await db
      .update(Workspace)
      .set({ brainInitStatus: "failed" })
      .where(eq(Workspace.id, workspace.id));
  }
}
