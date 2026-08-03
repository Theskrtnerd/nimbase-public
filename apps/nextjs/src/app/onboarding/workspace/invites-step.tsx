"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";

import type { AppRouter } from "@acme/api";
import { Button } from "@acme/ui/button";
import { Field, FieldContent, FieldLabel } from "@acme/ui/field";
import { Textarea } from "@acme/ui/textarea";
import { toast } from "@acme/ui/toast";

import { useTRPC } from "~/trpc/react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InvitesStep({
  workspaceId,
  onDone,
}: {
  workspaceId: string;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const invite = useMutation(trpc.members.invite.mutationOptions());

  const submit = async () => {
    const emails = [
      ...new Set(
        raw
          .split(/[\s,;]+/)
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    if (emails.length === 0) {
      onDone();
      return;
    }
    const invalid = emails.filter((e) => !EMAIL_RE.test(e));
    if (invalid.length > 0) {
      setError(`Not a valid email: ${invalid.join(", ")}`);
      return;
    }
    setError(null);
    setSending(true);
    let sent = 0;
    let failed = 0;
    let planLimitReached = false;
    try {
      for (const email of emails) {
        try {
          await invite.mutateAsync({ workspaceId, email });
          sent += 1;
        } catch (err) {
          if (
            isTRPCClientError<AppRouter>(err) &&
            err.data?.code === "PAYMENT_REQUIRED"
          ) {
            // Plan's member cap is reached — every remaining invite would
            // fail identically, so stop early and surface a specific toast.
            planLimitReached = true;
            break;
          }
          // CONFLICT (duplicate pending invite) shouldn't strand onboarding —
          // keep going and report the tally.
          failed += 1;
        }
      }
      if (sent > 0) {
        toast.success(`Invited ${sent} teammate${sent === 1 ? "" : "s"}`);
      }
      if (planLimitReached) {
        toast.error(
          "Your plan's member limit is reached — you can invite teammates after upgrading",
        );
      } else if (failed > 0) {
        toast.error(
          `${failed} invite${failed === 1 ? "" : "s"} could not be sent`,
        );
      }
      onDone();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Field>
        <FieldContent>
          <FieldLabel htmlFor="invite-emails">Teammate emails</FieldLabel>
        </FieldContent>
        <Textarea
          id="invite-emails"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="ada@acme.com, grace@acme.com"
          rows={3}
          disabled={sending}
        />
        <p className="text-muted-foreground text-[13px]">
          Separate with commas, semicolons, or new lines. Everyone joins as a
          member with access to shared memory.
        </p>
        {error ? <p className="text-destructive text-[13px]">{error}</p> : null}
      </Field>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onDone}
          disabled={sending}
          className="text-muted-foreground text-[13px] underline-offset-4 hover:underline disabled:no-underline disabled:opacity-50"
        >
          Skip for now
        </button>
        <Button onClick={submit} disabled={sending}>
          {sending ? "Inviting…" : "Finish"}
        </Button>
      </div>
    </div>
  );
}
