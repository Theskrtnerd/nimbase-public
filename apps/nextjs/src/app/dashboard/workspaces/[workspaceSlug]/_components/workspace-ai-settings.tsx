"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@acme/ui/button";
import { Label } from "@acme/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@acme/ui/select";

import { useTRPC } from "~/trpc/react";

const INHERIT = "__inherit__";

interface ModelOption {
  id: string;
  label: string;
}

interface WorkspaceConfig {
  override: { chatModel: string | null; normalizeModel: string | null };
  inherited: { chatModel: string; normalizeModel: string };
}

// Per-workspace model overrides (chat + normalize). The `get` query is gated to
// workspace admins, so for everyone else it errors and this panel renders
// nothing. embed is global-only and not shown here.
export function WorkspaceAiSettings({ workspaceId }: { workspaceId: string }) {
  const trpc = useTRPC();
  const configQuery = useQuery(
    trpc.workspaceAiConfig.get.queryOptions({ workspaceId }, { retry: false }),
  );
  const optionsQuery = useQuery(
    trpc.workspaceAiConfig.options.queryOptions({ workspaceId }),
  );

  if (configQuery.isError || !configQuery.data || !optionsQuery.data) {
    return null;
  }

  return (
    <WorkspaceAiForm
      workspaceId={workspaceId}
      data={configQuery.data}
      chatOptions={optionsQuery.data.chat}
      normalizeOptions={optionsQuery.data.normalize}
    />
  );
}

function WorkspaceAiForm({
  workspaceId,
  data,
  chatOptions,
  normalizeOptions,
}: {
  workspaceId: string;
  data: WorkspaceConfig;
  chatOptions: ModelOption[];
  normalizeOptions: ModelOption[];
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [chatModel, setChatModel] = useState<string | null>(
    () => data.override.chatModel,
  );
  const [normalizeModel, setNormalizeModel] = useState<string | null>(
    () => data.override.normalizeModel,
  );

  const updateMutation = useMutation(
    trpc.workspaceAiConfig.update.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(
          trpc.workspaceAiConfig.get.queryFilter({ workspaceId }),
        );
      },
    }),
  );

  return (
    <div className="bg-card border-border flex flex-col gap-4 rounded-xl border p-5">
      <div className="flex flex-col gap-1">
        <p className="text-foreground text-[13px] font-medium">
          AI models (this workspace)
        </p>
        <p className="text-muted-foreground text-[12px] leading-5">
          Override the chat and normalize models for this workspace, or inherit
          the global defaults. Embeddings always use the global model.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-[160px_1fr] sm:items-center">
        <Label htmlFor="ws-ai-chat-model">Chat model</Label>
        <OverrideSelect
          id="ws-ai-chat-model"
          value={chatModel}
          onChange={setChatModel}
          options={chatOptions}
          inheritedId={data.inherited.chatModel}
        />

        <Label htmlFor="ws-ai-normalize-model">Normalize model</Label>
        <OverrideSelect
          id="ws-ai-normalize-model"
          value={normalizeModel}
          onChange={setNormalizeModel}
          options={normalizeOptions}
          inheritedId={data.inherited.normalizeModel}
        />
      </div>

      <div className="flex items-center gap-3">
        <Button
          onClick={() =>
            updateMutation.mutate({ workspaceId, chatModel, normalizeModel })
          }
          disabled={updateMutation.isPending}
        >
          {updateMutation.isPending ? "Saving…" : "Save"}
        </Button>
        {updateMutation.isError ? (
          <p className="text-destructive text-[12px]">
            {updateMutation.error.message}
          </p>
        ) : updateMutation.isSuccess ? (
          <p className="text-muted-foreground text-[12px]">Saved.</p>
        ) : null}
      </div>
    </div>
  );
}

function OverrideSelect({
  id,
  value,
  onChange,
  options,
  inheritedId,
}: {
  id: string;
  value: string | null;
  onChange: (v: string | null) => void;
  options: ModelOption[];
  inheritedId: string;
}) {
  const inheritedLabel =
    options.find((o) => o.id === inheritedId)?.label ?? inheritedId;
  return (
    <Select
      value={value ?? INHERIT}
      onValueChange={(v) => onChange(v === INHERIT ? null : v)}
    >
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={INHERIT}>Inherit ({inheritedLabel})</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
