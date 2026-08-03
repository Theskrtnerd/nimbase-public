"use client";

import { useReducer, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, Loader2Icon } from "lucide-react";
import { usePostHog } from "posthog-js/react";

import type { RouterOutputs } from "@acme/api";
import type {
  ArtifactVisibility,
  GroupMcpTool,
  McpAuthMethod,
} from "@acme/db/schema";
import { GROUP_MCP_TOOLS } from "@acme/db/schema";
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

import { env } from "~/env";
import { useTRPC } from "~/trpc/react";

const AUTH_METHODS: McpAuthMethod[] = ["api_key", "oauth"];

type Proposal = RouterOutputs["groupMcp"]["propose"];
type GroupMcpRow = RouterOutputs["groupMcp"]["list"][number];

const TOOL_LABEL: Record<GroupMcpTool, string> = {
  search: "Search",
  get_note: "Read memory",
  list_sources: "List sources",
  capture: "Capture",
  create_artifact: "Build artifacts",
};

const AUTH_METHOD_LABEL: Record<McpAuthMethod, string> = {
  api_key: "API key",
  oauth: "OAuth",
};

function endpointUrl(orgSlug: string, slug: string) {
  const appHost = env.NEXT_PUBLIC_APP_HOST ?? "nimbase.ai";
  return `https://mcp.${appHost}/${orgSlug}/${slug}/mcp`;
}

interface GroupMcpFormState {
  prompt: string;
  proposal: Proposal | null;
  name: string;
  slug: string;
  folderPath: string;
  instructions: string;
  tools: GroupMcpTool[];
  authMethods: McpAuthMethod[];
  freshToken: { url: string; token: string | null } | null;
}

const INITIAL_GROUP_MCP_FORM_STATE: GroupMcpFormState = {
  prompt: "",
  proposal: null,
  name: "",
  slug: "",
  folderPath: "",
  instructions: "",
  tools: [],
  authMethods: ["api_key"],
  freshToken: null,
};

type GroupMcpFormAction =
  | { type: "promptChanged"; prompt: string }
  | { type: "proposalReceived"; proposal: Proposal }
  | { type: "nameChanged"; name: string }
  | { type: "slugChanged"; slug: string }
  | { type: "folderPathChanged"; folderPath: string }
  | { type: "instructionsChanged"; instructions: string }
  | { type: "toolToggled"; tool: GroupMcpTool }
  | { type: "authMethodToggled"; method: McpAuthMethod }
  | { type: "created"; freshToken: { url: string; token: string | null } }
  | { type: "cancelled" }
  | { type: "tokenDismissed" };

function groupMcpFormReducer(
  state: GroupMcpFormState,
  action: GroupMcpFormAction,
): GroupMcpFormState {
  switch (action.type) {
    case "promptChanged":
      return { ...state, prompt: action.prompt };
    case "proposalReceived":
      return {
        ...state,
        proposal: action.proposal,
        name: action.proposal.name,
        slug: action.proposal.slug,
        folderPath: action.proposal.folderPath,
        instructions: action.proposal.instructions,
        tools: action.proposal.tools,
        freshToken: null,
      };
    case "nameChanged":
      return { ...state, name: action.name };
    case "slugChanged":
      return { ...state, slug: action.slug };
    case "folderPathChanged":
      return { ...state, folderPath: action.folderPath };
    case "instructionsChanged":
      return { ...state, instructions: action.instructions };
    case "toolToggled":
      return {
        ...state,
        tools: state.tools.includes(action.tool)
          ? state.tools.filter((t) => t !== action.tool)
          : [...state.tools, action.tool],
      };
    case "authMethodToggled":
      return {
        ...state,
        authMethods: state.authMethods.includes(action.method)
          ? state.authMethods.filter((m) => m !== action.method)
          : [...state.authMethods, action.method],
      };
    case "created":
      return {
        ...state,
        freshToken: action.freshToken,
        proposal: null,
        prompt: "",
      };
    case "cancelled":
      return { ...state, proposal: null, prompt: "" };
    case "tokenDismissed":
      return { ...state, freshToken: null };
  }
}

export function CreateGroupMcpPanel({
  workspaceId,
  orgSlug,
}: {
  workspaceId: string;
  orgSlug: string | undefined;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const posthog = usePostHog();
  const [form, dispatch] = useReducer(
    groupMcpFormReducer,
    INITIAL_GROUP_MCP_FORM_STATE,
  );

  const propose = useMutation(
    trpc.groupMcp.propose.mutationOptions({
      onSuccess: (data) => {
        dispatch({ type: "proposalReceived", proposal: data });
      },
    }),
  );

  const create = useMutation(
    trpc.groupMcp.create.mutationOptions({
      onSuccess: async (res) => {
        posthog.capture("group_mcp_created", { workspaceId });
        await queryClient.invalidateQueries(
          trpc.groupMcp.list.queryFilter({ workspaceId }),
        );
        dispatch({
          type: "created",
          freshToken: {
            url: endpointUrl(orgSlug ?? "workspace", form.slug),
            token: res.token,
          },
        });
      },
    }),
  );

  function toggleTool(tool: GroupMcpTool) {
    dispatch({ type: "toolToggled", tool });
  }

  function toggleAuthMethod(method: McpAuthMethod) {
    dispatch({ type: "authMethodToggled", method });
  }

  return (
    <div className="bg-card border-border flex flex-col gap-3 rounded-xl border p-5">
      {!form.proposal ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-mcp-prompt">Describe the endpoint</Label>
            <Textarea
              id="group-mcp-prompt"
              value={form.prompt}
              onChange={(e) =>
                dispatch({ type: "promptChanged", prompt: e.target.value })
              }
              placeholder="An MCP for the design team, read-only access to the design system and brand docs"
              rows={3}
            />
          </div>
          {propose.isError && (
            <p className="text-destructive text-[12px]">
              Could not generate a proposal. Try rephrasing.
            </p>
          )}
          <div>
            <Button
              size="sm"
              disabled={!form.prompt.trim() || propose.isPending}
              onClick={() =>
                propose.mutate({ workspaceId, prompt: form.prompt.trim() })
              }
            >
              {propose.isPending && (
                <Loader2Icon className="size-4 animate-spin" />
              )}
              Propose
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-[11px] font-semibold">
            Review proposal
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="group-mcp-name">Name</Label>
              <Input
                id="group-mcp-name"
                value={form.name}
                onChange={(e) =>
                  dispatch({ type: "nameChanged", name: e.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="group-mcp-slug">Slug</Label>
              <Input
                id="group-mcp-slug"
                value={form.slug}
                onChange={(e) =>
                  dispatch({ type: "slugChanged", slug: e.target.value })
                }
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-mcp-folder">Folder</Label>
            <Input
              id="group-mcp-folder"
              value={form.folderPath}
              onChange={(e) =>
                dispatch({
                  type: "folderPathChanged",
                  folderPath: e.target.value,
                })
              }
              placeholder="workspace root"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="group-mcp-instructions">Instructions</Label>
            <Textarea
              id="group-mcp-instructions"
              value={form.instructions}
              onChange={(e) =>
                dispatch({
                  type: "instructionsChanged",
                  instructions: e.target.value,
                })
              }
              rows={3}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Tools</Label>
            <div className="flex flex-wrap gap-4">
              {GROUP_MCP_TOOLS.map((tool) => (
                <label
                  key={tool}
                  className="flex items-center gap-2 text-[13px]"
                >
                  <input
                    type="checkbox"
                    className="accent-primary size-4"
                    checked={form.tools.includes(tool)}
                    onChange={() => toggleTool(tool)}
                  />
                  {TOOL_LABEL[tool]}
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Auth methods</Label>
            <div className="flex flex-wrap gap-4">
              {AUTH_METHODS.map((method) => (
                <label
                  key={method}
                  className="flex items-center gap-2 text-[13px]"
                >
                  <input
                    type="checkbox"
                    className="accent-primary size-4"
                    checked={form.authMethods.includes(method)}
                    onChange={() => toggleAuthMethod(method)}
                  />
                  {AUTH_METHOD_LABEL[method]}
                </label>
              ))}
            </div>
          </div>
          {create.isError && (
            <p className="text-destructive text-[12px]">
              Could not create the endpoint. The slug or folder may already be
              in use.
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={
                !form.name.trim() ||
                !form.slug.trim() ||
                form.tools.length === 0 ||
                form.authMethods.length === 0 ||
                !orgSlug ||
                create.isPending
              }
              onClick={() =>
                create.mutate({
                  workspaceId,
                  slug: form.slug.trim(),
                  name: form.name.trim(),
                  instructions: form.instructions.trim(),
                  folderPath: form.folderPath.trim() || undefined,
                  tools: form.tools,
                  authMethods: form.authMethods,
                })
              }
            >
              {create.isPending && (
                <Loader2Icon className="size-4 animate-spin" />
              )}
              Create
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => dispatch({ type: "cancelled" })}
            >
              Cancel
            </Button>
          </div>
        </>
      )}

      {form.freshToken && (
        <CopyBlock
          url={form.freshToken.url}
          token={form.freshToken.token}
          onDismiss={() => dispatch({ type: "tokenDismissed" })}
        />
      )}
    </div>
  );
}

export function GroupMcpRowCard({
  workspaceId,
  orgSlug,
  row,
}: {
  workspaceId: string;
  orgSlug: string | undefined;
  row: GroupMcpRow;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const posthog = usePostHog();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const url = endpointUrl(orgSlug ?? "workspace", row.slug);

  const invalidateList = () =>
    queryClient.invalidateQueries(
      trpc.groupMcp.list.queryFilter({ workspaceId }),
    );

  const setEnabled = useMutation(
    trpc.groupMcp.setEnabled.mutationOptions({
      onSuccess: (_data, variables) => {
        posthog.capture("group_mcp_enabled_changed", {
          workspaceId,
          enabled: variables.enabled,
        });
        void invalidateList();
      },
    }),
  );
  const rotateKey = useMutation(
    trpc.groupMcp.rotateKey.mutationOptions({
      onSuccess: (res) => {
        posthog.capture("group_mcp_key_rotated", { workspaceId });
        setFreshToken(res.token);
      },
    }),
  );
  const update = useMutation(
    trpc.groupMcp.update.mutationOptions({
      onSuccess: () => void invalidateList(),
    }),
  );
  const del = useMutation(
    trpc.groupMcp.delete.mutationOptions({
      onSuccess: () => {
        posthog.capture("group_mcp_deleted", { workspaceId });
        void invalidateList();
      },
    }),
  );

  return (
    <div className="bg-card border-border flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-foreground text-[14px] font-medium">
            {row.name}
          </span>
          <span
            data-testid="group-mcp-url"
            className="text-muted-foreground truncate font-mono text-[11px]"
          >
            {url}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              checked={row.enabled}
              disabled={setEnabled.isPending}
              onCheckedChange={(checked) =>
                setEnabled.mutate({ workspaceId, id: row.id, enabled: checked })
              }
            />
            <span className="text-muted-foreground text-[12px]">
              {row.enabled ? "Enabled" : "Disabled"}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={rotateKey.isPending || !orgSlug}
            onClick={() => rotateKey.mutate({ workspaceId, id: row.id })}
          >
            {rotateKey.isPending && (
              <Loader2Icon className="size-4 animate-spin" />
            )}
            Regenerate key
          </Button>
          {confirmingDelete ? (
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="destructive"
                disabled={del.isPending}
                onClick={() => del.mutate({ workspaceId, id: row.id })}
              >
                Confirm delete
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      {row.tools.includes("create_artifact") && (
        <div className="border-border flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-muted-foreground text-[12px]">
            Artifacts this endpoint builds are
          </span>
          <Select
            value={row.artifactVisibility}
            disabled={update.isPending}
            onValueChange={(value) =>
              update.mutate({
                workspaceId,
                id: row.id,
                artifactVisibility: value as ArtifactVisibility,
              })
            }
          >
            <SelectTrigger size="sm" className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="private">Just me</SelectItem>
              <SelectItem value="public">Anyone with the link</SelectItem>
            </SelectContent>
          </Select>
          {row.artifactVisibility === "private" && (
            <span className="text-muted-foreground text-[11px]">
              Most callers have no Nimbase session, so a private artifact will
              404 for them.
            </span>
          )}
        </div>
      )}

      {freshToken && (
        <CopyBlock
          url={url}
          token={freshToken}
          onDismiss={() => setFreshToken(null)}
        />
      )}
    </div>
  );
}

function CopyBlock({
  url,
  token,
  onDismiss,
}: {
  url: string;
  token: string | null;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="border-border bg-background flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-[11px] font-semibold">
          {token ? "New key — shown once, copy it now" : "Endpoint"}
        </p>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      <pre className="text-foreground overflow-x-auto font-mono text-[12px] whitespace-pre-wrap">
        <span>URL: {url}</span>
        {token && (
          <>
            {"\n"}
            <span data-testid="group-mcp-token">Key: {token}</span>
          </>
        )}
      </pre>
      <div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(
              token ? `${url}\n${token}` : url,
            );
            setCopied(true);
          }}
        >
          {copied ? (
            <CheckIcon className="size-4" />
          ) : (
            <CopyIcon className="size-4" />
          )}
          Copy
        </Button>
      </div>
      {token && (
        <p className="text-muted-foreground text-[11px]">
          This key will not be shown again. Store it somewhere safe.
        </p>
      )}
    </div>
  );
}
