import "server-only";

import { randomUUID } from "node:crypto";

import type { ArtifactKind, ArtifactVisibility } from "@acme/db/schema";
import { assertWithinLimit } from "@acme/api/entitlements";
import { and, eq, like, or } from "@acme/db";
import { db } from "@acme/db/client";
import { Artifact } from "@acme/db/schema";
import {
  isReservedSlug,
  nextAvailableSlug,
  resourceSlugBase,
} from "@acme/db/slug";

import { shareUrl } from "~/server/share/share-url";
import { dispatchArtifactGenerate } from "./dispatch";
import { generateArtifactTitle } from "./title";

export interface CreateArtifactInput {
  prompt: string;
  kind?: ArtifactKind;
  themeMode?: "app" | "custom";
  themeDescription?: string;
  visibility?: ArtifactVisibility;
  slug?: string;
  // Present → regenerate an existing artifact (keeps folder/slug/visibility).
  artifactId?: string;
}

export interface CreateArtifactContext {
  workspaceId: string;
  targetFolderId: string | null;
  // Creator/deployment viewer scopes, snapshotted to fence read tools.
  readScopes: { prefix: string; exclude: string[] }[] | null;
}

export interface CreateArtifactResult {
  id: string;
  slug: string;
  title: string;
  url: string;
  status: "generating";
  visibility: ArtifactVisibility;
}

export class ArtifactCreateError extends Error {
  constructor(
    readonly code: "not_found" | "slug_conflict" | "slug_invalid",
    message: string,
  ) {
    super(message);
    this.name = "ArtifactCreateError";
  }
}

/**
 * Create (or regenerate) an artifact and enqueue its generation. Auth-agnostic —
 * the caller must already have authorized the workspace and `canCapture` on
 * the target folder. The slug is minted at creation so the share link is
 * stable for the artifact's whole life.
 */
export async function createArtifact(
  input: CreateArtifactInput,
  ctx: CreateArtifactContext,
): Promise<CreateArtifactResult> {
  const kind = input.kind ?? "fixed";

  if (input.artifactId) {
    const [existing] = await db
      .select({
        slug: Artifact.slug,
        status: Artifact.status,
        visibility: Artifact.visibility,
        title: Artifact.title,
      })
      .from(Artifact)
      .where(
        and(
          eq(Artifact.id, input.artifactId),
          eq(Artifact.workspaceId, ctx.workspaceId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new ArtifactCreateError("not_found", "Artifact not found");
    }
    const { slug } = existing;
    // A generation already in flight is left untouched (no re-enqueue).
    if (existing.status === "generating") {
      return {
        id: input.artifactId,
        slug,
        title: existing.title,
        url: shareUrl(slug),
        status: "generating",
        visibility: existing.visibility,
      };
    }
    // Reset job state; folder, slug, and visibility are preserved. The
    // title is renamed from the new prompt so it never goes stale.
    await assertWithinLimit(ctx.workspaceId, "artifact");
    const retitled = await generateArtifactTitle(input.prompt, ctx.workspaceId);
    await db
      .update(Artifact)
      .set({
        kind,
        title: retitled,
        prompt: input.prompt,
        status: "generating",
        error: null,
        slug,
        updatedAt: new Date(),
      })
      .where(eq(Artifact.id, input.artifactId));
    await dispatchArtifactGenerate({
      jobId: randomUUID(),
      artifactId: input.artifactId,
      workspaceId: ctx.workspaceId,
      prompt: input.prompt,
      kind,
      themeMode: input.themeMode ?? "app",
      themeDescription: input.themeDescription,
      readScopes: ctx.readScopes,
    });
    return {
      id: input.artifactId,
      slug,
      title: retitled,
      url: shareUrl(slug),
      status: "generating",
      visibility: existing.visibility,
    };
  }

  const id = randomUUID();
  const visibility = input.visibility ?? "private";

  await assertWithinLimit(ctx.workspaceId, "artifact");
  const title = await generateArtifactTitle(input.prompt, ctx.workspaceId);
  const slug = await allocateArtifactSlug(title, input.slug);
  await db.insert(Artifact).values({
    id,
    workspaceId: ctx.workspaceId,
    title,
    kind,
    prompt: input.prompt,
    targetFolderId: ctx.targetFolderId,
    status: "generating",
    visibility,
    slug,
  });

  await dispatchArtifactGenerate({
    jobId: randomUUID(),
    artifactId: id,
    workspaceId: ctx.workspaceId,
    prompt: input.prompt,
    kind,
    themeMode: input.themeMode ?? "app",
    themeDescription: input.themeDescription,
    readScopes: ctx.readScopes,
  });

  return {
    id,
    slug,
    title,
    url: shareUrl(slug),
    status: "generating",
    visibility,
  };
}

async function allocateArtifactSlug(
  title: string,
  requested: string | undefined,
): Promise<string> {
  const base = requested ?? resourceSlugBase(title, "artifact");
  if (requested && isReservedSlug(requested)) {
    throw new ArtifactCreateError(
      "slug_invalid",
      `The slug "${requested}" is reserved`,
    );
  }
  const rows = await db
    .select({ slug: Artifact.slug })
    .from(Artifact)
    .where(or(eq(Artifact.slug, base), like(Artifact.slug, `${base}-%`)));
  const taken = new Set(rows.map((row) => row.slug));
  if (requested && taken.has(requested)) {
    throw new ArtifactCreateError(
      "slug_conflict",
      `The slug "${requested}" is already in use`,
    );
  }
  return nextAvailableSlug(base, taken);
}
