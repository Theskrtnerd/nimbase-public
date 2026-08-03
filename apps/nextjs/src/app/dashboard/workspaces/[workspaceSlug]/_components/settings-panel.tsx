"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { XIcon } from "lucide-react";

import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";
import { toast } from "@acme/ui/toast";

import type { SettingsSection, SettingsSectionId } from "./settings-sections";
import { formatDate } from "~/lib/format-date";
import { useTRPC } from "~/trpc/react";
import { AiModelsSettings } from "./ai-models-settings";
import { AppearanceSettings } from "./appearance-settings";
import { BillingSettings } from "./billing-settings";
import { IntegrationsSettings } from "./integrations-settings";
import { McpSettings } from "./mcp-settings";
import { MembersSettings } from "./members-settings";
import { PlanOverrideSettings } from "./plan-override-settings";
import { WorkspaceAiSettings } from "./workspace-ai-settings";

interface Workspace {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
}

// Sub-section navigation lives in the activity bar (see settings-sections.ts);
// this component renders whichever pane the bar has selected.
export function SettingsPanel({
  workspace,
  section,
  onClose,
}: {
  workspace: Workspace;
  section: SettingsSection;
  onClose: () => void;
}) {
  const panes: Record<SettingsSectionId, ReactNode> = {
    general: <GeneralSection workspace={workspace} />,
    people: <MembersSettings workspaceId={workspace.id} />,
    integrations: (
      <>
        <IntegrationsSettings workspaceId={workspace.id} />
        <McpSettings />
      </>
    ),
    ai: <WorkspaceAiSettings workspaceId={workspace.id} />,
    billing: <BillingSettings workspaceId={workspace.id} />,
    god: (
      <>
        <AiModelsSettings />
        <PlanOverrideSettings workspaceId={workspace.id} />
      </>
    ),
  };

  const Icon = section.icon;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="border-sidebar-border flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3">
        <div className="flex items-center gap-3">
          <Icon className="text-sidebar-accent-foreground size-4" />
          <div className="flex flex-col">
            <h1 className="text-foreground text-[15px] font-semibold tracking-tight">
              {section.label}
            </h1>
            <p className="text-muted-foreground text-[12px] leading-none">
              {section.hint}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <XIcon className="size-4" />
          <span className="sr-only">Close settings</span>
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-6 pb-10">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {panes[section.id]}
        </div>
      </div>
    </div>
  );
}

function GeneralSection({ workspace }: { workspace: Workspace }) {
  return (
    <>
      <SettingsRow
        label="Workspace name"
        value={workspace.name}
        hint="Rename your workspace anytime."
      />
      <SettingsRow
        label="Description"
        value={workspace.description ?? "—"}
        hint="What lives in this workspace?"
      />
      <SettingsRow
        label="Created"
        value={formatDate(workspace.createdAt)}
        hint="The day this workspace was set up."
      />
      <AppearanceSettings />
      <DeleteWorkspaceSection workspace={workspace} />
    </>
  );
}

function DeleteWorkspaceSection({ workspace }: { workspace: Workspace }) {
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [confirmationName, setConfirmationName] = useState("");
  const deleteWorkspace = useMutation(
    trpc.workspace.delete.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.workspace.pathFilter());
        toast.success("Workspace deleted");
        router.replace("/dashboard");
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );
  const nameMatches = confirmationName === workspace.name;

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="danger-zone-heading"
    >
      <h2
        id="danger-zone-heading"
        className="text-foreground text-[13px] font-medium"
      >
        Danger zone
      </h2>
      <div className="border-destructive/30 bg-destructive/5 flex flex-col gap-4 rounded-xl border p-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-destructive text-[13px] font-medium">
            Delete workspace
          </h3>
          <p className="text-muted-foreground text-[12px] leading-5">
            This permanently deletes the workspace. Type{" "}
            <strong>{workspace.name}</strong> to confirm.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="delete-workspace-confirmation">
            Workspace name
          </label>
          <Input
            id="delete-workspace-confirmation"
            value={confirmationName}
            onChange={(event) => setConfirmationName(event.target.value)}
            placeholder={workspace.name}
            autoComplete="off"
          />
          <Button
            type="button"
            variant="destructive"
            disabled={!nameMatches || deleteWorkspace.isPending}
            onClick={() =>
              deleteWorkspace.mutate({
                id: workspace.id,
                confirmationName,
              })
            }
          >
            {deleteWorkspace.isPending ? "Deleting…" : "Delete workspace"}
          </Button>
        </div>
      </div>
    </section>
  );
}

function SettingsRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="bg-card border-border grid gap-1 rounded-xl border p-5 sm:grid-cols-[200px_1fr] sm:items-center sm:gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-foreground text-[13px] font-medium">{label}</p>
        <p className="text-muted-foreground text-[12px] leading-5">{hint}</p>
      </div>
      <p className="text-foreground text-[13.5px] leading-6">{value}</p>
    </div>
  );
}
