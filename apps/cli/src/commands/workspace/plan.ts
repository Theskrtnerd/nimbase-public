import type { Command } from "commander";

import {
  billingPlanSchema,
  workspacePlanSetResponseSchema,
} from "@acme/validators/cli";

import { openBrowser } from "../../browser";
import { createContext } from "../../context";
import { requireSession } from "../../credentials";
import { usageError } from "../../errors";
import { printJson, printLine } from "../../output";
import { resolveWorkspace } from "../../workspace";

interface PlanOptions {
  open: boolean;
}

export function registerWorkspacePlan(program: Command): void {
  program
    .command("plan")
    .description(
      "Move toward a plan through Stripe, support, or staff override",
    )
    .argument("<plan>", billingPlanSchema.options.join(" | "))
    .option("--no-open", "print the next-step URL without opening it")
    .action(async (rawPlan: string, options: PlanOptions, command: Command) => {
      const parsed = billingPlanSchema.safeParse(rawPlan);
      if (!parsed.success) {
        throw usageError(
          `plan must be one of: ${billingPlanSchema.options.join(", ")}`,
        );
      }

      const ctx = await createContext(command);
      requireSession(ctx.config, "`nimbase workspace plan`");
      const workspaceId = await resolveWorkspace(ctx);
      const result = await ctx.client.request("POST", "/api/workspaces/plan", {
        body: { workspaceId, plan: parsed.data },
        schema: workspacePlanSetResponseSchema,
      });

      if (ctx.globals.json) {
        printJson(result);
        return;
      }
      switch (result.action) {
        case "unchanged":
          printLine(`Workspace is already on ${result.plan}. No changes made.`);
          return;
        case "override":
          printLine(
            `Workspace plan set to ${result.plan}${result.status ? ` (${result.status})` : ""}.`,
          );
          printLine("Recorded in the operator audit log.");
          if (result.warning) printLine(`Warning: ${result.warning}`);
          return;
        case "checkout":
          printLine("Complete the Pro upgrade in Stripe Checkout:");
          break;
        case "portal":
          printLine("Complete the plan change in Stripe Billing Portal:");
          break;
        case "contact":
          printLine(
            result.reason === "enterprise_sales"
              ? "Contact Nimbase about an Enterprise plan:"
              : "Contact Nimbase support to change this Enterprise plan:",
          );
          break;
      }

      printLine(result.url);
      if (options.open) openBrowser(result.url);
    });
}
