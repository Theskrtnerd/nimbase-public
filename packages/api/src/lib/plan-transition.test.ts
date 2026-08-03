import { describe, expect, it } from "vitest";

import type { BillingPlan, BillingStatus } from "@acme/db/schema";

import type { BillingSnapshot, PlanTransition } from "./plan-transition";
import { decidePlanTransition } from "./plan-transition";

function snapshot(
  plan: BillingPlan,
  status: BillingStatus | null = null,
  stripeSubscriptionId: string | null = null,
): BillingSnapshot {
  return { plan, status, stripeSubscriptionId };
}

describe("decidePlanTransition", () => {
  it.each<{
    label: string;
    current: BillingSnapshot;
    target: BillingPlan;
    expected: PlanTransition;
  }>([
    {
      label: "keeps Free unchanged",
      current: snapshot("free"),
      target: "free",
      expected: { action: "unchanged" },
    },
    {
      label: "starts Checkout from Free",
      current: snapshot("free"),
      target: "pro",
      expected: { action: "checkout" },
    },
    {
      label: "sends Enterprise inquiries to sales",
      current: snapshot("free"),
      target: "enterprise",
      expected: { action: "contact_sales" },
    },
    {
      label: "keeps active Pro unchanged",
      current: snapshot("pro", "active", "sub_1"),
      target: "pro",
      expected: { action: "unchanged" },
    },
    {
      label: "uses Portal to downgrade Pro",
      current: snapshot("pro", "active", "sub_1"),
      target: "free",
      expected: { action: "portal" },
    },
    {
      label: "allows a new Checkout after cancellation",
      current: snapshot("pro", "canceled", "sub_1"),
      target: "pro",
      expected: { action: "checkout" },
    },
    {
      label: "keeps Enterprise unchanged",
      current: snapshot("enterprise"),
      target: "enterprise",
      expected: { action: "unchanged" },
    },
    {
      label: "routes Enterprise downgrades to support",
      current: snapshot("enterprise"),
      target: "pro",
      expected: { action: "contact_support" },
    },
  ])("$label", ({ current, target, expected }) => {
    expect(decidePlanTransition({ current, target, staff: false })).toEqual(
      expected,
    );
  });

  it.each<BillingStatus | null>(["unpaid", "incomplete", "paused", null])(
    "uses Portal instead of Checkout for a live %s subscription",
    (status) => {
      expect(
        decidePlanTransition({
          current: snapshot("pro", status, "sub_1"),
          target: "pro",
          staff: false,
        }),
      ).toEqual({ action: "portal" });
    },
  );

  it("allows a new Checkout after an incomplete subscription expires", () => {
    expect(
      decidePlanTransition({
        current: snapshot("pro", "incomplete_expired", "sub_1"),
        target: "pro",
        staff: false,
      }),
    ).toEqual({ action: "checkout" });
  });

  it("uses Portal to cancel a live subscription that is effectively Free", () => {
    expect(
      decidePlanTransition({
        current: snapshot("pro", "unpaid", "sub_1"),
        target: "free",
        staff: false,
      }),
    ).toEqual({ action: "portal" });
  });

  it("lets staff directly override a different manual plan", () => {
    expect(
      decidePlanTransition({
        current: snapshot("free"),
        target: "enterprise",
        staff: true,
      }),
    ).toEqual({ action: "override", stripeManaged: false });
  });

  it("warns staff when Stripe can overwrite a direct override", () => {
    expect(
      decidePlanTransition({
        current: snapshot("pro", "past_due", "sub_1"),
        target: "enterprise",
        staff: true,
      }),
    ).toEqual({ action: "override", stripeManaged: true });
  });
});
