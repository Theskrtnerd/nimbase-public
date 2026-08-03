import type { DeploymentSummary } from "@acme/api/deployment-control";

function widgetEmbed(request: Request, publicKey: string): string {
  const origin = new URL(request.url).origin;
  return `<script src="${origin}/widget.js" data-widget-key="${publicKey}" async></script>`;
}

export function deploymentHttpResponse<T extends DeploymentSummary>(
  request: Request,
  deployment: T,
) {
  return {
    ...deployment,
    targets: deployment.targets.map(
      ({
        widgetPublicKey,
        ...target
      }): Omit<(typeof deployment.targets)[number], "widgetPublicKey"> & {
        embed: string | null;
      } => ({
        ...target,
        embed: widgetPublicKey ? widgetEmbed(request, widgetPublicKey) : null,
      }),
    ),
  };
}
