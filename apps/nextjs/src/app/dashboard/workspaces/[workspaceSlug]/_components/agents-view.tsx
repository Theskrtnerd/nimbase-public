"use client";

import { useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport } from "ai";
import { ArrowLeftIcon, Loader2Icon, SendIcon, Trash2Icon } from "lucide-react";
import { usePostHog } from "posthog-js/react";

import type { ArtifactVisibility } from "@acme/db/schema";
import { cn } from "@acme/ui";
import { Badge } from "@acme/ui/badge";
import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";
import { Label } from "@acme/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@acme/ui/select";
import { Switch } from "@acme/ui/switch";
import { Textarea } from "@acme/ui/textarea";

import { useTRPC } from "~/trpc/react";

const ROOT_OPTION = "__root__";

export function CreateAgentForm({
  workspaceId,
  onDone,
}: {
  workspaceId: string;
  onDone: (id: string | null) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const posthog = usePostHog();
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [folder, setFolder] = useState(ROOT_OPTION);
  const targets = useQuery(
    trpc.access.captureTargets.queryOptions({ workspaceId }),
  );
  const create = useMutation(
    trpc.agent.create.mutationOptions({
      onSuccess: async (res) => {
        posthog.capture("agent_created", {
          workspace_id: workspaceId,
          has_instructions: instructions.trim().length > 0,
          scoped_to_folder: folder !== ROOT_OPTION,
        });
        await queryClient.invalidateQueries(
          trpc.agent.list.queryFilter({ workspaceId }),
        );
        onDone(res.id);
      },
    }),
  );

  return (
    <div className="bg-card border-border flex flex-col gap-3 rounded-xl border p-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="agent-name">Name</Label>
        <Input
          id="agent-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Eng Docs Assistant"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="agent-instructions">Instructions</Label>
        <Textarea
          id="agent-instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="How should this agent answer? (tone, focus, what to prioritise)"
          rows={3}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Knowledge anchor</Label>
        <Select value={folder} onValueChange={setFolder}>
          <SelectTrigger>
            <SelectValue placeholder="Workspace root" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ROOT_OPTION}>Workspace root</SelectItem>
            {(targets.data ?? []).flatMap((t) =>
              t.folderId ? (
                <SelectItem key={t.folderId} value={t.folderId}>
                  {t.label}
                </SelectItem>
              ) : (
                []
              ),
            )}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-[12px]">
          The folder the agent can read. You need manager access to it.
        </p>
      </div>
      {create.isError && (
        <p className="text-destructive text-[12px]">
          {create.error.message.includes("Manager")
            ? "You need manager access to that folder to create an agent there."
            : "Could not create the agent."}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!name.trim() || create.isPending}
          onClick={() =>
            create.mutate({
              workspaceId,
              name: name.trim(),
              instructions: instructions.trim() || undefined,
              targetFolderId: folder === ROOT_OPTION ? null : folder,
            })
          }
        >
          {create.isPending && <Loader2Icon className="size-4 animate-spin" />}
          Create
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function AgentDetail({
  agentId,
  workspaceId,
  onBack,
}: {
  agentId: string;
  workspaceId: string;
  onBack: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const agent = useQuery(trpc.agent.get.queryOptions({ id: agentId }));
  const del = useMutation(
    trpc.agent.delete.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(
          trpc.agent.list.queryFilter({ workspaceId }),
        );
        onBack();
      },
    }),
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeftIcon className="size-4" />
          All agents
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          disabled={del.isPending}
          onClick={() => del.mutate({ id: agentId })}
        >
          <Trash2Icon className="size-4" />
          Delete
        </Button>
      </div>

      {agent.data ? (
        <>
          <AgentPersonaForm key={agent.data.id} agent={agent.data} />
          <AgentTestChat agentId={agentId} agentName={agent.data.name} />
          <AgentConnections agentId={agentId} />
          <AgentActivity agentId={agentId} />
        </>
      ) : (
        <p className="text-muted-foreground text-[13px]">Loading…</p>
      )}
    </div>
  );
}

function AgentPersonaForm({
  agent,
}: {
  agent: {
    id: string;
    name: string;
    instructions: string;
    enabled: boolean;
    artifactEnabled: boolean;
    artifactVisibility: ArtifactVisibility;
  };
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  // State holds only the user's unsaved edits; every field falls back to the
  // server value, so a refetched agent shows through instead of a stale copy.
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [instructionsEdit, setInstructionsEdit] = useState<string | null>(null);
  const [enabledEdit, setEnabledEdit] = useState<boolean | null>(null);
  const [artifactEdit, setArtifactEdit] = useState<boolean | null>(null);
  const [visibilityEdit, setVisibilityEdit] = useState<
    "private" | "public" | null
  >(null);
  const name = nameEdit ?? agent.name;
  const instructions = instructionsEdit ?? agent.instructions;
  const enabled = enabledEdit ?? agent.enabled;
  const artifactEnabled = artifactEdit ?? agent.artifactEnabled;
  const artifactVisibility =
    visibilityEdit ??
    (agent.artifactVisibility === "public" ? "public" : "private");
  const update = useMutation(
    trpc.agent.update.mutationOptions({
      onSuccess: async () => {
        // Drop the local edits so the form follows the server copy again.
        setNameEdit(null);
        setInstructionsEdit(null);
        setEnabledEdit(null);
        setArtifactEdit(null);
        setVisibilityEdit(null);
        await queryClient.invalidateQueries(
          trpc.agent.get.queryFilter({ id: agent.id }),
        );
      },
    }),
  );

  const dirty =
    name !== agent.name ||
    instructions !== agent.instructions ||
    enabled !== agent.enabled ||
    artifactEnabled !== agent.artifactEnabled ||
    artifactVisibility !== agent.artifactVisibility;

  return (
    <section className="bg-card border-border flex flex-col gap-3 rounded-xl border p-5">
      <h2 className="text-foreground text-[14px] font-semibold">Persona</h2>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="persona-name">Name</Label>
        <Input
          id="persona-name"
          value={name}
          onChange={(e) => setNameEdit(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="persona-instructions">Instructions</Label>
        <Textarea
          id="persona-instructions"
          value={instructions}
          onChange={(e) => setInstructionsEdit(e.target.value)}
          rows={4}
        />
      </div>
      <div className="border-border flex flex-col gap-3 border-t pt-3">
        <div className="flex items-center gap-2">
          <Switch
            id="persona-artifact"
            checked={artifactEnabled}
            onCheckedChange={setArtifactEdit}
          />
          <Label htmlFor="persona-artifact">Can build artifacts</Label>
        </div>
        <p className="text-muted-foreground text-[12px]">
          Lets the agent answer with a generated page — a KPI breakdown, a
          report — and reply with its link. The page can only read what this
          agent can read.
        </p>
        {artifactEnabled && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="persona-artifact-visibility">
              Who can open them
            </Label>
            <Select
              value={artifactVisibility}
              onValueChange={(v) =>
                setVisibilityEdit(v as "private" | "public")
              }
            >
              <SelectTrigger id="persona-artifact-visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">
                  Workspace members with folder access
                </SelectItem>
                <SelectItem value="public">Anyone with the link</SelectItem>
              </SelectContent>
            </Select>
            {artifactVisibility === "private" && (
              <p className="text-muted-foreground text-[12px]">
                Teammates without a Nimbase account or folder access will get a
                404 when they open the link from chat.
              </p>
            )}
            {artifactVisibility === "public" && (
              <p className="text-muted-foreground text-[12px]">
                Links are unlisted but need no sign-in — anyone they are
                forwarded to can read the page.
              </p>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Switch
            id="persona-enabled"
            checked={enabled}
            onCheckedChange={setEnabledEdit}
          />
          <Label htmlFor="persona-enabled">Enabled</Label>
        </div>
        <Button
          size="sm"
          disabled={!dirty || !name.trim() || update.isPending}
          onClick={() =>
            update.mutate({
              id: agent.id,
              name: name.trim(),
              instructions,
              enabled,
              artifactEnabled,
              artifactVisibility,
            })
          }
        >
          {update.isPending && <Loader2Icon className="size-4 animate-spin" />}
          Save
        </Button>
      </div>
    </section>
  );
}

function AgentTestChat({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const [input, setInput] = useState("");
  const transport = useMemo(
    () => new DefaultChatTransport({ api: `/api/agents/${agentId}/chat` }),
    [agentId],
  );
  const { messages, sendMessage, status, error } = useChat({ transport });
  const busy = status === "submitted" || status === "streaming";

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void sendMessage({ text });
  }

  return (
    <section className="bg-card border-border flex flex-col gap-3 rounded-xl border p-5">
      <h2 className="text-foreground text-[14px] font-semibold">Test chat</h2>
      <div className="border-border bg-background flex max-h-80 min-h-24 flex-col gap-3 overflow-y-auto rounded-lg border p-3">
        {messages.length === 0 ? (
          <p className="text-muted-foreground text-[13px]">
            Ask {agentName} something to preview how it answers from the wiki.
          </p>
        ) : (
          messages.map((m) => {
            const text = m.parts
              .map((p) => (p.type === "text" ? p.text : ""))
              .join("");
            return (
              <div
                key={m.id}
                className={cn(
                  "text-[13px] leading-relaxed whitespace-pre-wrap",
                  m.role === "user"
                    ? "text-foreground font-medium"
                    : "text-muted-foreground",
                )}
              >
                <span className="text-[11px] opacity-60">
                  {m.role === "user" ? "You" : agentName}
                </span>
                <div>{text || (busy ? "…" : "")}</div>
              </div>
            );
          })
        )}
      </div>
      {error && (
        <p className="text-destructive text-[12px]">Something went wrong.</p>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask a question…"
          disabled={busy}
        />
        <Button size="icon" disabled={busy} onClick={submit}>
          {busy ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <SendIcon className="size-4" />
          )}
        </Button>
      </div>
    </section>
  );
}

function AgentConnections({ agentId }: { agentId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const connections = useQuery(
    trpc.agent.connections.queryOptions({ agentId }),
  );
  const revoke = useMutation(
    trpc.agent.revokeConnection.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries(
          trpc.agent.connections.queryFilter({ agentId }),
        ),
    }),
  );

  return (
    <section className="bg-card border-border flex flex-col gap-3 rounded-xl border p-5">
      <h2 className="text-foreground text-[14px] font-semibold">Deployments</h2>
      {connections.data && connections.data.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {connections.data.map((c) => (
            <li
              key={c.id}
              className="border-border flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex flex-col">
                <span className="text-foreground text-[13px] font-medium capitalize">
                  {c.platform}
                  {c.externalMeta?.teamName
                    ? ` · ${c.externalMeta.teamName}`
                    : ""}
                </span>
                <span className="text-muted-foreground text-[12px]">
                  {c.error ?? c.status}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={c.status === "active" ? "default" : "secondary"}
                >
                  {c.status}
                </Badge>
                {c.status === "active" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate({ connectionId: c.id })}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-[13px]">
          Not deployed anywhere yet.
        </p>
      )}
    </section>
  );
}

function AgentActivity({ agentId }: { agentId: string }) {
  const trpc = useTRPC();
  const turns = useQuery(trpc.agent.turns.queryOptions({ agentId, limit: 20 }));

  if (!turns.data || turns.data.length === 0) return null;

  return (
    <section className="bg-card border-border flex flex-col gap-3 rounded-xl border p-5">
      <h2 className="text-foreground text-[14px] font-semibold">
        Recent activity
      </h2>
      <ul className="flex flex-col gap-3">
        {turns.data.map((t) => (
          <li key={t.id} className="flex flex-col gap-1">
            <span className="text-foreground text-[13px] font-medium">
              {t.question}
            </span>
            <span className="text-muted-foreground line-clamp-2 text-[12px]">
              {t.error ? `error: ${t.error}` : t.answer}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
