import { randomBytes } from "node:crypto";

import type { DeploymentPlatform } from "@acme/validators/cli";

import { openBrowser } from "./browser";
import { waitForLoopbackCallback } from "./loopback";

const DEPLOY_TIMEOUT_MS = 10 * 60 * 1000;

export function connectDeployment(args: {
  baseUrl: string;
  agentId: string;
  slug: string;
  platform: DeploymentPlatform;
  open: boolean;
}): Promise<string> {
  const state = randomBytes(24).toString("base64url");
  return waitForLoopbackCallback({
    state,
    valueParam: "slug",
    timeoutMs: DEPLOY_TIMEOUT_MS,
    successTitle: "Agent deployed",
    failureTitle: "Deployment failed",
    invalidMessage: "Deployment failed: invalid callback",
    timeoutMessage: "Deployment timed out",
    exitCode: 1,
    onReady(redirectUrl) {
      const redirect = new URL(redirectUrl);
      redirect.searchParams.set("state", state);
      const install = new URL(
        `/api/agents/${args.platform}/install`,
        args.baseUrl,
      );
      install.searchParams.set("agentId", args.agentId);
      install.searchParams.set("redirect", redirect.toString());

      process.stderr.write(
        `Deploy ${args.slug} to ${args.platform} in your browser. If it does not open, visit:\n${install.toString()}\n`,
      );
      if (args.open) openBrowser(install.toString());
    },
  });
}
