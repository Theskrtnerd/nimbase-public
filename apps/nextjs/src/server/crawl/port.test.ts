import { beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCrawl } from "./dispatch";
import { crawlPort } from "./port";

vi.mock("./dispatch", () => ({ dispatchCrawl: vi.fn() }));

describe("crawlPort", () => {
  beforeEach(() => {
    vi.mocked(dispatchCrawl).mockReset();
  });

  it("returns the same run id that it dispatches", async () => {
    const result = await crawlPort.enqueue({
      connectionId: "31cbb4bf-6f2a-4d06-824f-e34898bd14a2",
      workspaceId: "09bd8306-fc65-44ab-99b3-f819810b0ee8",
    });
    expect(result.runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const dispatched = vi.mocked(dispatchCrawl).mock.calls[0]?.[0];
    expect(dispatched?.jobId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(dispatched).toEqual({
      jobId: dispatched?.jobId,
      runId: result.runId,
      connectionId: "31cbb4bf-6f2a-4d06-824f-e34898bd14a2",
      workspaceId: "09bd8306-fc65-44ab-99b3-f819810b0ee8",
    });
  });

  it("leaves the managed connector catalog empty in Community Edition", () => {
    expect(crawlPort.providers()).toEqual([]);
  });
});
