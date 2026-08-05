import { describe, expect, it } from "vitest";

import { gardenerContextBlocks } from "./gardener-context";

describe("gardenerContextBlocks", () => {
  it("emits nothing for a canonical root compile", () => {
    expect(gardenerContextBlocks({ fencePrefix: "" })).toEqual([]);
  });

  it("omits the fence notice at root but keeps company context", () => {
    const blocks = gardenerContextBlocks({
      fencePrefix: "",
      companyContext: "We build rockets.",
    });
    const joined = blocks.join("\n\n");
    expect(blocks).toHaveLength(1);
    expect(joined).not.toContain("You are working inside");
    expect(joined).toContain("We build rockets.");
  });

  it("orders company context before the fence", () => {
    const blocks = gardenerContextBlocks({
      fencePrefix: "projects",
      companyContext: "ctx",
    });
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("<company-context>");
    expect(blocks[1]).toContain("You are working inside");
  });

  it("names wiki-relative paths by default", () => {
    const [fence] = gardenerContextBlocks({ fencePrefix: "projects" });
    expect(fence).toContain('"projects/"');
  });

  it("names mounted paths for the harness runner", () => {
    const [fence] = gardenerContextBlocks({
      fencePrefix: "projects",
      mountPrefix: "/wiki/",
    });
    expect(fence).toContain('"/wiki/projects/"');
  });

  it("treats an empty company context as absent", () => {
    expect(
      gardenerContextBlocks({ fencePrefix: "", companyContext: "" }),
    ).toEqual([]);
  });

  it("gives both runners identical text apart from the mount prefix", () => {
    const args = {
      fencePrefix: "projects",
      companyContext: "ctx",
    };
    const legacy = gardenerContextBlocks(args).join("\n\n");
    const harness = gardenerContextBlocks({
      ...args,
      mountPrefix: "/wiki/",
    }).join("\n\n");
    expect(harness.replace('"/wiki/projects/"', '"projects/"')).toBe(legacy);
  });
});
