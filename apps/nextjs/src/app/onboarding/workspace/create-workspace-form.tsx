"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePostHog } from "posthog-js/react";

import { CreateWorkspaceSchema } from "@acme/db/schema";
import { Button } from "@acme/ui/button";
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@acme/ui/field";
import { Input } from "@acme/ui/input";
import { toast } from "@acme/ui/toast";

import { useTRPC } from "~/trpc/react";

function getValue(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function CreateWorkspaceForm({
  onCreated,
}: {
  onCreated: (workspace: { id: string; slug: string }) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const posthog = usePostHog();
  const [formError, setFormError] = useState<string | null>(null);

  const createWorkspace = useMutation(trpc.workspace.create.mutationOptions());

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const formData = new FormData(event.currentTarget);
    const result = CreateWorkspaceSchema.safeParse({
      name: getValue(formData, "name"),
    });

    if (!result.success) {
      setFormError(result.error.issues[0]?.message ?? "Check your workspace.");
      return;
    }

    // Optional identity inputs the Biographer seeds company.md from.
    const websiteRaw = getValue(formData, "website");
    const websiteUrl = websiteRaw
      ? websiteRaw.startsWith("http://") || websiteRaw.startsWith("https://")
        ? websiteRaw
        : `https://${websiteRaw}`
      : undefined;
    let workspace;
    try {
      workspace = await createWorkspace.mutateAsync({
        ...result.data,
        website: websiteUrl,
      });
    } catch {
      toast.error("Failed to create workspace");
      return;
    }
    posthog.capture("workspace_created", { workspace_id: workspace.id });
    await queryClient.invalidateQueries(trpc.workspace.pathFilter());
    toast.success("Workspace created");

    // Brain init runs server-side: it enriches this company from Context.dev,
    // drafts company.md, and saves the discovered logo without holding up the
    // rest of onboarding.
    onCreated({ id: workspace.id, slug: workspace.slug });
  };

  const busy = createWorkspace.isPending;

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="flex flex-col gap-5"
    >
      <FieldGroup className="gap-4">
        <Field data-invalid={!!formError}>
          <FieldContent>
            <FieldLabel htmlFor="workspace-name">Company name</FieldLabel>
          </FieldContent>
          <Input
            id="workspace-name"
            name="name"
            required
            autoFocus
            maxLength={120}
            aria-invalid={!!formError}
            placeholder="Acme Inc."
          />
        </Field>
        <Field>
          <FieldContent>
            <FieldLabel htmlFor="workspace-website">Website</FieldLabel>
          </FieldContent>
          <Input
            id="workspace-website"
            name="website"
            type="text"
            required
            inputMode="url"
            maxLength={500}
            placeholder="acme.com"
          />
        </Field>
        {formError ? <FieldError>{formError}</FieldError> : null}
      </FieldGroup>

      <Button type="submit" disabled={busy} className="h-10 w-full">
        {busy ? "Creating…" : "Continue"}
      </Button>
    </form>
  );
}
