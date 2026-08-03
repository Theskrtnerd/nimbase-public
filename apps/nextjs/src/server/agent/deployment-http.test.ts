import { describe, expect, it } from "vitest";

import { deploymentHttpResponse } from "./deployment-http";

describe("deploymentHttpResponse", () => {
  it("renders a widget interface embed without exposing its route key", () => {
    const result = deploymentHttpResponse(
      new Request("https://app.nimbase.ai/api/deployments"),
      {
        slug: "support",
        name: "Support",
        enabled: true,
        targetPath: "",
        targets: [
          {
            platform: "widget",
            status: "active",
            name: null,
            error: null,
            widgetPublicKey: "nb_wgt_public",
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    );

    expect(result.targets[0]).not.toHaveProperty("widgetPublicKey");
    expect(result.targets[0]?.embed).toBe(
      '<script src="https://app.nimbase.ai/widget.js" data-widget-key="nb_wgt_public" async></script>',
    );
  });

  it("does not expose a Slack tenant route key", () => {
    const result = deploymentHttpResponse(
      new Request("https://app.nimbase.ai/api/deployments"),
      {
        slug: "support",
        name: "Support",
        enabled: true,
        targetPath: "",
        targets: [
          {
            platform: "slack",
            status: "active",
            name: "Acme",
            error: null,
            widgetPublicKey: null,
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    );

    expect(result.targets[0]?.embed).toBeNull();
  });
});
