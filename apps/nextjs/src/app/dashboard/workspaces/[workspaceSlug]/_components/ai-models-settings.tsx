"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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

import { useTRPC } from "~/trpc/react";

interface ModelOption {
  id: string;
  label: string;
}

interface ModelOptions {
  chat: ModelOption[];
  normalize: ModelOption[];
  embed: ModelOption[];
}

interface GlobalConfig {
  providerKind: "gateway" | "openai-compatible";
  baseUrl: string;
  chatModel: string;
  normalizeModel: string;
  embedModel: string;
}

// Global, operator-level AI model config. The `get` query is operator-gated, so
// for everyone else it errors and this panel renders nothing. Per-workspace
// overrides (Phase 2) live in a separate, canManage-gated panel.
export function AiModelsSettings() {
  const trpc = useTRPC();
  const configQuery = useQuery(
    trpc.aiConfig.get.queryOptions(undefined, { retry: false }),
  );
  const optionsQuery = useQuery(trpc.aiConfig.options.queryOptions());

  if (configQuery.isError || !configQuery.data || !optionsQuery.data) {
    return null;
  }

  return <AiModelsForm config={configQuery.data} options={optionsQuery.data} />;
}

function AiModelsForm({
  config,
  options,
}: {
  config: GlobalConfig;
  options: ModelOptions;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // Lazy-init from the loaded config once at mount — no effect-based syncing.
  const [providerKind, setProviderKind] = useState(() => config.providerKind);
  const [baseUrl, setBaseUrl] = useState(() => config.baseUrl);
  const [chatModel, setChatModel] = useState(() => config.chatModel);
  const [normalizeModel, setNormalizeModel] = useState(
    () => config.normalizeModel,
  );
  const [embedModel, setEmbedModel] = useState(() => config.embedModel);

  const updateMutation = useMutation(
    trpc.aiConfig.update.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.aiConfig.get.queryFilter());
      },
    }),
  );

  return (
    <div className="bg-card border-border flex flex-col gap-4 rounded-xl border p-5">
      <div className="flex flex-col gap-1">
        <p className="text-foreground text-[13px] font-medium">
          AI models (global)
        </p>
        <p className="text-muted-foreground text-[12px] leading-5">
          Applies to every workspace unless overridden. Changing the embedding
          model requires re-indexing existing notes.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-[160px_1fr] sm:items-center">
        <Label htmlFor="ai-provider-kind">Provider</Label>
        <Select
          value={providerKind}
          onValueChange={(v) =>
            setProviderKind(v as GlobalConfig["providerKind"])
          }
        >
          <SelectTrigger id="ai-provider-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="gateway">Vercel AI Gateway</SelectItem>
            <SelectItem value="openai-compatible">
              Self-hosted (OpenAI-compatible)
            </SelectItem>
          </SelectContent>
        </Select>

        <Label htmlFor="ai-base-url">Base URL</Label>
        <Input
          id="ai-base-url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://ai-gateway.vercel.sh"
        />

        <Label htmlFor="ai-chat-model">Chat model</Label>
        <ModelSelect
          id="ai-chat-model"
          value={chatModel}
          onChange={setChatModel}
          options={options.chat}
        />

        <Label htmlFor="ai-normalize-model">Normalize model</Label>
        <ModelSelect
          id="ai-normalize-model"
          value={normalizeModel}
          onChange={setNormalizeModel}
          options={options.normalize}
        />

        <Label htmlFor="ai-embed-model">Embedding model</Label>
        <ModelSelect
          id="ai-embed-model"
          value={embedModel}
          onChange={setEmbedModel}
          options={options.embed}
        />
      </div>

      <div className="flex items-center gap-3">
        <Button
          onClick={() =>
            updateMutation.mutate({
              providerKind,
              baseUrl,
              chatModel,
              normalizeModel,
              embedModel,
            })
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

function ModelSelect({
  id,
  value,
  onChange,
  options,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: ModelOption[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
