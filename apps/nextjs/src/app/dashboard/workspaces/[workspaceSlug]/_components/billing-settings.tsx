"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { usePostHog } from "posthog-js/react";

import type { RouterOutputs } from "@acme/api";
import { cn } from "@acme/ui";
import { Badge } from "@acme/ui/badge";
import { Button } from "@acme/ui/button";

import { useTRPC } from "~/trpc/react";

type BillingData = RouterOutputs["billing"]["get"];
type BillingPlan = BillingData["plan"];

const PLAN_BADGE: Record<
  BillingPlan,
  { label: string; variant: "default" | "secondary" }
> = {
  free: { label: "Free", variant: "secondary" },
  pro: { label: "Pro", variant: "default" },
  enterprise: { label: "Enterprise", variant: "default" },
};

const SALES_MAILTO =
  "mailto:nimbase.ai@gmail.com?subject=Nimbase%20Enterprise%20inquiry";

// Owner detection uses only data that already exists. members.list is loaded by
// the Members panel in the same Settings view, so react-query dedupes it here;
// WorkspaceMember.userId is the Clerk user id (see resolveAccess), so matching
// it against the Clerk session id yields the caller's role. Non-owners get a
// read-only view; the checkout/portal POSTs are still owner-gated server-side
// (403), surfaced as an inline error if the role check is ever wrong.
export function BillingSettings({ workspaceId }: { workspaceId: string }) {
  const trpc = useTRPC();
  const billingQuery = useQuery(trpc.billing.get.queryOptions({ workspaceId }));
  const membersQuery = useQuery(
    trpc.members.list.queryOptions({ workspaceId }),
  );
  const { user } = useUser();

  if (billingQuery.isError || !billingQuery.data) {
    return null;
  }

  const isOwner =
    membersQuery.data?.members.find((m) => m.userId === user?.id)?.role ===
    "owner";

  return (
    <BillingPanel
      data={billingQuery.data}
      workspaceId={workspaceId}
      isOwner={isOwner}
    />
  );
}

function BillingPanel({
  data,
  workspaceId,
  isOwner,
}: {
  data: BillingData;
  workspaceId: string;
  isOwner: boolean;
}) {
  const { plan, status, limits, usage, trialEnd, currentPeriodEnd } = data;
  const badge = PLAN_BADGE[plan];

  // Derived during render — no effect, no stored copy. `new Date()` here is a
  // display-only "now"; recomputed on each render, which is fine for a countdown.
  const trialDays =
    status === "trialing" && trialEnd ? daysLeft(trialEnd) : null;
  const cancelsOn =
    data.cancelAtPeriodEnd && currentPeriodEnd
      ? formatDate(currentPeriodEnd)
      : null;

  const posthog = usePostHog();
  const [redirecting, setRedirecting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function startBilling(endpoint: "checkout" | "portal") {
    setRedirecting(true);
    setActionError(null);
    try {
      const res = await fetch(
        endpoint === "checkout"
          ? "/api/workspaces/plan"
          : "/api/billing/portal",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            ...(endpoint === "checkout" ? { plan: "pro" } : {}),
          }),
        },
      );
      if (!res.ok) {
        setActionError(
          res.status === 403
            ? "Only the workspace owner can manage billing."
            : "Something went wrong. Please try again.",
        );
        setRedirecting(false);
        return;
      }
      const body = (await res.json()) as { url?: string };
      if (body.url) {
        if (endpoint === "checkout") {
          posthog.capture("upgrade_to_pro_clicked", {
            current_plan: plan,
            workspace_id: workspaceId,
          });
        }
        window.location.href = body.url;
        // Leave `redirecting` true — navigation is in flight.
        return;
      }
      setActionError("Something went wrong. Please try again.");
      setRedirecting(false);
    } catch {
      setActionError("Something went wrong. Please try again.");
      setRedirecting(false);
    }
  }

  return (
    <div className="bg-card border-border flex flex-col gap-4 rounded-xl border p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-foreground text-[13px] font-medium">
            Billing & plan
          </p>
          <p className="text-muted-foreground text-[12px] leading-5">
            Manage this workspace's subscription, plan limits, and usage.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={badge.variant}>{badge.label}</Badge>
          {trialDays !== null ? (
            <span className="text-muted-foreground text-[12px]">
              Trial — {trialDays} {trialDays === 1 ? "day" : "days"} left
            </span>
          ) : null}
          {cancelsOn ? (
            <span className="text-muted-foreground text-[12px]">
              Cancels on {cancelsOn}
            </span>
          ) : null}
        </div>
      </div>

      {status === "past_due" ? (
        <div className="border-destructive/30 bg-destructive/10 flex flex-col gap-1 rounded-lg border p-3">
          <p className="text-destructive text-[13px] font-medium">
            Payment failed
          </p>
          <p className="text-muted-foreground text-[12px] leading-5">
            Update your card to keep Pro. Use Manage billing below to fix your
            payment method.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <UsageMeter
          label="Members"
          used={usage.members}
          limit={limits.members}
        />
        <UsageMeter
          label="Captures"
          sublabel="this month"
          used={usage.captures}
          limit={limits.captures}
        />
        <UsageMeter
          label="Artifacts"
          sublabel="this month"
          used={usage.artifact}
          limit={limits.artifact}
        />
        <UsageMeter
          label="Storage"
          used={usage.storage}
          limit={limits.storageBytes}
          format={formatBytes}
        />
      </div>

      <div className="flex flex-col gap-2">
        {plan === "enterprise" ? (
          <>
            <p className="text-muted-foreground text-[12px]">
              You're on Enterprise.
            </p>
            <ContactSalesLink />
          </>
        ) : isOwner ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {plan === "free" ? (
                <Button
                  onClick={() => void startBilling("checkout")}
                  disabled={redirecting}
                >
                  {redirecting ? "Redirecting…" : "Upgrade to Pro — A$200/mo"}
                </Button>
              ) : (
                <Button
                  onClick={() => void startBilling("portal")}
                  disabled={redirecting}
                >
                  {redirecting ? "Redirecting…" : "Manage billing"}
                </Button>
              )}
              <ContactSalesLink />
            </div>
            {actionError ? (
              <p className="text-destructive text-[12px]">{actionError}</p>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-[12px]">
              Contact your workspace owner to manage billing.
            </p>
            <ContactSalesLink />
          </>
        )}
      </div>
    </div>
  );
}

function UsageMeter({
  label,
  sublabel,
  used,
  limit,
  format,
}: {
  label: string;
  sublabel?: string;
  used: number;
  limit: number | null;
  format?: (n: number) => string;
}) {
  const fmt = format ?? ((n: number) => n.toLocaleString());
  const unlimited = limit === null;
  const pct =
    unlimited || limit === 0 ? 0 : Math.min(100, (used / limit) * 100);
  const atLimit = !unlimited && limit > 0 && used >= limit;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-foreground text-[13px]">
          {label}
          {sublabel ? (
            <span className="text-muted-foreground"> {sublabel}</span>
          ) : null}
        </p>
        <p className="text-muted-foreground text-[12px] tabular-nums">
          {fmt(used)} / {unlimited ? "Unlimited" : fmt(limit)}
        </p>
      </div>
      {unlimited ? null : (
        <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
          <div
            className={cn(
              "h-full rounded-full",
              atLimit ? "bg-destructive" : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function ContactSalesLink() {
  return (
    <a
      href={SALES_MAILTO}
      className="text-muted-foreground hover:text-foreground text-[12px] underline underline-offset-4"
    >
      Contact sales about Enterprise
    </a>
  );
}

function daysLeft(target: Date): number {
  const ms = target.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  const kb = bytes / 1024;
  return `${Math.max(1, Math.round(kb))} KB`;
}
