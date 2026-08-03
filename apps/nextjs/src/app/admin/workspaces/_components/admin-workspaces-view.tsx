"use client";

import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { AppRouter } from "@acme/api";
import { Badge } from "@acme/ui/badge";
import { Button } from "@acme/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@acme/ui/card";
import { Input } from "@acme/ui/input";
import { Label } from "@acme/ui/label";

import { useTRPC } from "~/trpc/react";

export function AdminWorkspacesView() {
  const trpc = useTRPC();
  const [draft, setDraft] = useState("");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  const detail = useQuery(
    trpc.operator.workspaceDetail.queryOptions(
      { workspaceId: workspaceId ?? "" },
      { retry: false, enabled: workspaceId !== null },
    ),
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <GodModeBanner />

      <form
        className="flex items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setWorkspaceId(draft.trim() || null);
        }}
      >
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="workspace-id">Workspace ID</Label>
          <Input
            id="workspace-id"
            placeholder="00000000-0000-0000-0000-000000000000"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={draft.trim().length === 0}>
          Load
        </Button>
      </form>

      {workspaceId !== null && detail.isPending ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : null}

      {detail.isError ? (
        <p className="text-destructive text-sm">
          {detail.error.message || "Unable to load workspace."}
        </p>
      ) : null}

      {detail.data ? <WorkspaceDetail data={detail.data} /> : null}
    </div>
  );
}

function GodModeBanner() {
  return (
    <div className="border-border bg-muted text-muted-foreground flex items-center gap-3 rounded-lg border px-4 py-3">
      <Badge variant="outline">God mode</Badge>
      <span className="text-sm">
        Read-only operator view. Every workspace you open here is logged.
      </span>
    </div>
  );
}

type Detail = inferRouterOutputs<AppRouter>["operator"]["workspaceDetail"];

function WorkspaceDetail({ data }: { data: Detail }) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{data.workspace.name}</CardTitle>
          {data.workspace.description ? (
            <CardDescription>{data.workspace.description}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>Owner: {data.workspace.ownerUserId}</span>
          <span>Members: {data.members.length}</span>
          <span>Sources: {data.sourceCount}</span>
          <span>Artifactes: {data.artifactCount}</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {data.members.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="text-foreground">
                {m.name ?? m.email ?? m.userId}
              </span>
              <Badge variant="secondary">{m.role}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Top memory ({data.nodes.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          {data.nodes.length === 0 ? (
            <p className="text-muted-foreground text-sm">No compiled memory.</p>
          ) : (
            data.nodes.map((n) => (
              <div key={n.id} className="flex flex-col text-sm">
                <span className="text-foreground">{n.title}</span>
                <span className="text-muted-foreground text-xs">{n.path}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
