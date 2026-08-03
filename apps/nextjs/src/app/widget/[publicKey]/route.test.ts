import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  loadWidgetInterfaceContext: vi.fn(),
  widgetPanelHtml: vi.fn(),
}));

vi.mock("~/server/agent/interfaces/widget/access", () => ({
  loadWidgetInterfaceContext: mocks.loadWidgetInterfaceContext,
}));

vi.mock("~/server/agent/interfaces/widget/panel-html", () => ({
  frameAncestorsValue: vi.fn(),
  widgetPanelHtml: mocks.widgetPanelHtml,
}));

describe("GET /widget/[publicKey]", () => {
  beforeEach(() => {
    mocks.loadWidgetInterfaceContext.mockReset();
    mocks.widgetPanelHtml.mockReset();
    mocks.widgetPanelHtml.mockReturnValue("<main>Chat unavailable</main>");
  });

  it("renders an inert fallback panel for an unknown widget", async () => {
    mocks.loadWidgetInterfaceContext.mockResolvedValue(null);

    const response = await GET(new Request("https://app.test/widget/unknown"), {
      params: Promise.resolve({ publicKey: "unknown" }),
    });
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toBe(
      "frame-ancestors *",
    );
    expect(html).toContain("Chat unavailable");
    expect(mocks.widgetPanelHtml).toHaveBeenCalledWith({
      name: "Chat unavailable",
      greeting: "",
      accent: "#14707e",
      position: "right",
      publicKey: "unknown",
      state: "unavailable",
    });
    expect(html).not.toContain("<form");
  });

  it("keeps a whole-KB agent interface available", async () => {
    mocks.loadWidgetInterfaceContext.mockResolvedValue({
      agent: { name: "Support", enabled: true },
      connection: { status: "active" },
      config: {
        greeting: "Hello",
        allowedDomains: ["example.com"],
        theme: {},
      },
      folderPath: "",
    });
    mocks.widgetPanelHtml.mockReturnValue("<form>chat</form>");

    const response = await GET(new Request("https://app.test/widget/key"), {
      params: Promise.resolve({ publicKey: "key" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.widgetPanelHtml).toHaveBeenCalledWith(
      expect.objectContaining({ state: "active" }),
    );
  });
});
