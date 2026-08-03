import { describe, expect, it } from "vitest";

import { decideShareAccess } from "./access-decision";

describe("decideShareAccess", () => {
  it("a reader always sees it regardless of visibility", () => {
    for (const visibility of ["private", "public"] as const) {
      expect(decideShareAccess({ visibility, isReader: true })).toBe("serve");
    }
  });

  it("public serves anyone", () => {
    expect(
      decideShareAccess({
        visibility: "public",
        isReader: false,
      }),
    ).toBe("serve");
  });

  it("private forbids non-readers", () => {
    expect(
      decideShareAccess({
        visibility: "private",
        isReader: false,
      }),
    ).toBe("forbidden");
  });
});
