"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { RouterOutputs } from "@acme/api";
import { Badge } from "@acme/ui/badge";
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

type BillingPlan = RouterOutputs["billing"]["get"]["plan"];

const PLAN_LABEL: Record<BillingPlan, string> = {
  free: "Free",
  pro: "Pro",
  enterprise: "Enterprise",
};

// Operator-only plan grant for the CURRENT workspace: sets the plan directly in
// WorkspaceSubscription with no Stripe checkout, which is how gods (and comped
// Enterprise customers) hold a paid plan. Gated server-side by assertGod on
// billing.setPlanOverride — this panel only renders inside the god settings
// section, but the mutation is the real boundary.
export function PlanOverrideSettings({ workspaceId }: { workspaceId: string }) {
  const trpc = useTRPC();
  const billingQuery = useQuery(trpc.billing.get.queryOptions({ workspaceId }));

  if (billingQuery.isError || !billingQuery.data) {
    return null;
  }

  return (
    <PlanOverrideForm
      workspaceId={workspaceId}
      currentPlan={billingQuery.data.plan}
      stripeBacked={billingQuery.data.status !== null}
    />
  );
}

function PlanOverrideForm({
  workspaceId,
  currentPlan,
  stripeBacked,
}: {
  workspaceId: string;
  currentPlan: BillingPlan;
  stripeBacked: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // Lazy-init from the loaded plan once at mount — no effect-based syncing.
  const [plan, setPlan] = useState<BillingPlan>(() => currentPlan);

  const overrideMutation = useMutation(
    trpc.billing.setPlanOverride.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.billing.get.queryFilter());
      },
    }),
  );

  return (
    <div className="bg-card border-border flex flex-col gap-4 rounded-xl border p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-foreground text-[13px] font-medium">
            Plan override
          </p>
          <p className="text-muted-foreground text-[12px] leading-5">
            Grant this workspace a plan directly, with no Stripe checkout. Use
            it for your own workspace and for comped Enterprise customers.
          </p>
        </div>
        <Badge variant={currentPlan === "free" ? "secondary" : "default"}>
          {PLAN_LABEL[currentPlan]}
        </Badge>
      </div>

      <div className="grid gap-2 sm:grid-cols-[160px_1fr] sm:items-center">
        <Label htmlFor="plan-override">Plan</Label>
        <Select value={plan} onValueChange={(v) => setPlan(v as BillingPlan)}>
          <SelectTrigger id="plan-override">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="free">Free</SelectItem>
            <SelectItem value="pro">Pro</SelectItem>
            <SelectItem value="enterprise">Enterprise</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {stripeBacked ? (
        <p className="text-muted-foreground text-[12px] leading-5">
          This workspace has a Stripe-backed subscription. An override changes
          the plan now, but the next Stripe webhook for that subscription will
          overwrite it — cancel in Stripe first if the change should stick.
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          onClick={() => overrideMutation.mutate({ workspaceId, plan })}
          disabled={overrideMutation.isPending || plan === currentPlan}
        >
          {overrideMutation.isPending ? "Applying…" : "Apply plan"}
        </Button>
        {overrideMutation.isError ? (
          <p className="text-destructive text-[12px]">
            {overrideMutation.error.message}
          </p>
        ) : overrideMutation.isSuccess ? (
          <p className="text-muted-foreground text-[12px]">
            Applied. Limits take effect immediately.
          </p>
        ) : null}
      </div>
    </div>
  );
}
