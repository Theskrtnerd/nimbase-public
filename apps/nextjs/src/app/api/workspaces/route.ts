import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";

import type { WorkspaceIdentitySources } from "@acme/api/workspace-control";
import { createWorkspace } from "@acme/api/workspace-control";
import { and, desc, eq } from "@acme/db";
import { db } from "@acme/db/client";
import { Workspace, WorkspaceMember } from "@acme/db/schema";
import { workspaceCreateRequestSchema } from "@acme/validators/cli";

import { authorizeUserRequest } from "~/server/auth/authorize-workspace";
import { brainInitPort } from "~/server/brain/port";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const userId = await authorizeUserRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const workspaces = await db
    .select({ id: Workspace.id, name: Workspace.name, slug: Workspace.slug })
    .from(Workspace)
    .innerJoin(
      WorkspaceMember,
      and(
        eq(WorkspaceMember.workspaceId, Workspace.id),
        eq(WorkspaceMember.userId, userId),
      ),
    )
    .orderBy(desc(Workspace.createdAt));

  return NextResponse.json({ workspaces });
}

export async function POST(req: Request) {
  const userId = await authorizeUserRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = workspaceCreateRequestSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const identitySources: WorkspaceIdentitySources =
    "website" in parsed.data
      ? {
          title: parsed.data.title ? "manual" : "website",
          description: parsed.data.description ? "manual" : "website",
        }
      : { title: "manual", description: "manual" };
  const input =
    "website" in parsed.data
      ? {
          name: parsed.data.title ?? fallbackWorkspaceName(parsed.data.website),
          description: parsed.data.description,
          website: parsed.data.website,
        }
      : {
          name: parsed.data.title,
          description: parsed.data.description,
        };
  const workspace = await createWorkspace({
    input,
    creator: {
      id: userId,
      name: user.fullName ?? user.username ?? null,
      email: user.primaryEmailAddress?.emailAddress ?? null,
    },
    brainInit: brainInitPort,
    identitySources,
  });
  return NextResponse.json({ workspace }, { status: 201 });
}

function fallbackWorkspaceName(website: string): string {
  return new URL(website).hostname.replace(/^www\./, "").slice(0, 120);
}
