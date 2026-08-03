import { describe, expect, it } from "vitest";

import { escapeLikePrefix } from "@acme/db";

import {
  computeScopes,
  hasRoleAtPath,
  pathInScopes,
  prefixCovers,
  roleAtPath,
} from "./access-core";

const g = (prefix: string, role: "viewer" | "contributor" | "manager") => ({
  prefix,
  role,
});

describe("prefixCovers", () => {
  it("root covers everything", () => {
    expect(prefixCovers("", "a/b")).toBe(true);
    expect(prefixCovers("", "")).toBe(true);
  });
  it("covers self and descendants, not siblings/prefix-strings", () => {
    expect(prefixCovers("sales", "sales")).toBe(true);
    expect(prefixCovers("sales", "sales/playbooks/q3")).toBe(true);
    expect(prefixCovers("sales", "salesforce")).toBe(false);
    expect(prefixCovers("sales/playbooks", "sales")).toBe(false);
  });
  // Edge case: a prefix that is a string-prefix of another but not a path-prefix
  it("does not false-positive on string-prefix collisions", () => {
    expect(prefixCovers("lead", "leadership")).toBe(false);
    expect(prefixCovers("lead", "leadership/comp")).toBe(false);
    expect(prefixCovers("comp", "competition/results")).toBe(false);
  });
});

describe("roleAtPath — additive grants", () => {
  it("root grant reaches all paths when nothing is restricted", () => {
    expect(roleAtPath([g("", "contributor")], [], "eng/api")).toBe(
      "contributor",
    );
  });
  it("no grant → null", () => {
    expect(roleAtPath([g("sales", "viewer")], [], "eng/api")).toBeNull();
  });
  it("union takes the highest role", () => {
    const grants = [g("", "viewer"), g("sales", "manager")];
    expect(roleAtPath(grants, [], "sales/q3")).toBe("manager");
    expect(roleAtPath(grants, [], "eng/api")).toBe("viewer");
  });
  // Edge cases
  it("empty grants array → null", () => {
    expect(roleAtPath([], [], "anything")).toBeNull();
    expect(roleAtPath([], ["restricted"], "restricted/path")).toBeNull();
  });
  it("grant prefix deeper than the path does not apply", () => {
    expect(roleAtPath([g("sales/sub", "manager")], [], "sales")).toBeNull();
    expect(roleAtPath([g("sales/sub", "manager")], [], "sales/sub")).toBe(
      "manager",
    );
  });
  it("multiple disjoint grants each cover their own subtree", () => {
    const grants = [g("eng", "contributor"), g("marketing", "viewer")];
    expect(roleAtPath(grants, [], "eng/api")).toBe("contributor");
    expect(roleAtPath(grants, [], "marketing/blog")).toBe("viewer");
    expect(roleAtPath(grants, [], "sales/crm")).toBeNull();
  });
  it("same-prefix grant with higher role wins", () => {
    const grants = [
      g("sales", "viewer"),
      g("sales", "manager"),
      g("sales", "contributor"),
    ];
    expect(roleAtPath(grants, [], "sales/q3")).toBe("manager");
  });
  it("root grant at path root itself (empty path)", () => {
    expect(roleAtPath([g("", "viewer")], [], "")).toBe("viewer");
  });
});

describe("roleAtPath — restricted boundaries", () => {
  const restricted = ["leadership"];
  it("root grant does NOT flow into a restricted folder", () => {
    expect(
      roleAtPath([g("", "contributor")], restricted, "leadership/comp"),
    ).toBeNull();
    expect(
      roleAtPath([g("", "contributor")], restricted, "leadership"),
    ).toBeNull();
  });
  it("grant rooted AT the restricted folder works inside it", () => {
    expect(
      roleAtPath([g("leadership", "viewer")], restricted, "leadership/comp"),
    ).toBe("viewer");
  });
  it("grant rooted INSIDE the restricted folder works in its subtree only", () => {
    const grants = [g("leadership/board", "viewer")];
    expect(roleAtPath(grants, restricted, "leadership/board/minutes")).toBe(
      "viewer",
    );
    expect(roleAtPath(grants, restricted, "leadership/comp")).toBeNull();
  });
  it("nested restricted: outer grant stops at the inner boundary", () => {
    const nested = ["leadership", "leadership/comp"];
    const grants = [g("leadership", "manager")];
    expect(roleAtPath(grants, nested, "leadership/okrs")).toBe("manager");
    expect(roleAtPath(grants, nested, "leadership/comp/bands")).toBeNull();
  });
  it("restricted elsewhere does not affect unrelated paths", () => {
    expect(roleAtPath([g("", "viewer")], restricted, "eng/api")).toBe("viewer");
  });
  // Edge case: string-prefix confusion for restricted folder names
  it("restricted 'lead' does not block access to 'leadership'", () => {
    expect(roleAtPath([g("", "viewer")], ["lead"], "leadership/comp")).toBe(
      "viewer",
    );
  });
  it("restricted 'leadership/comp' does not block 'leadership/competition'", () => {
    expect(
      roleAtPath(
        [g("leadership", "viewer")],
        ["leadership", "leadership/comp"],
        "leadership/competition",
      ),
    ).toBe("viewer");
  });
  it("grant exactly at restricted boundary satisfies the restricted-folder rule", () => {
    // Grant is rooted at "leadership" which equals the restricted folder → allowed
    expect(
      roleAtPath(
        [g("leadership", "contributor")],
        ["leadership"],
        "leadership",
      ),
    ).toBe("contributor");
  });
  it("root grant does not reach restricted folder at root level", () => {
    expect(roleAtPath([g("", "manager")], ["secret"], "secret")).toBeNull();
    expect(
      roleAtPath([g("", "manager")], ["secret"], "secret/nested"),
    ).toBeNull();
  });
});

describe("hasRoleAtPath", () => {
  it("returns false when role is below the minimum", () => {
    expect(hasRoleAtPath([g("", "viewer")], [], "eng", "contributor")).toBe(
      false,
    );
    expect(hasRoleAtPath([g("", "contributor")], [], "eng", "manager")).toBe(
      false,
    );
  });
  it("returns true when role meets the minimum exactly", () => {
    expect(
      hasRoleAtPath([g("", "contributor")], [], "eng", "contributor"),
    ).toBe(true);
    expect(hasRoleAtPath([g("", "viewer")], [], "eng", "viewer")).toBe(true);
  });
  it("returns true when role exceeds the minimum", () => {
    expect(hasRoleAtPath([g("", "manager")], [], "eng", "viewer")).toBe(true);
  });
  it("returns false when no grant covers the path", () => {
    expect(hasRoleAtPath([g("sales", "manager")], [], "eng", "viewer")).toBe(
      false,
    );
  });
});

describe("computeScopes", () => {
  it("filters by minimum role", () => {
    const scopes = computeScopes([g("sales", "viewer")], [], "contributor");
    expect(scopes).toEqual([]);
  });
  it("root grant excludes restricted subtrees it is not rooted in", () => {
    const scopes = computeScopes(
      [g("", "contributor")],
      ["leadership"],
      "viewer",
    );
    expect(scopes).toEqual([{ prefix: "", exclude: ["leadership"] }]);
  });
  it("grant at the restricted folder itself has no exclusion for it", () => {
    const scopes = computeScopes(
      [g("leadership", "viewer")],
      ["leadership"],
      "viewer",
    );
    expect(scopes).toEqual([{ prefix: "leadership", exclude: [] }]);
  });
  it("nested restricted inside a grant is excluded; re-allowed by inner grant as its own scope", () => {
    const scopes = computeScopes(
      [g("leadership", "viewer"), g("leadership/comp", "viewer")],
      ["leadership", "leadership/comp"],
      "viewer",
    );
    expect(scopes).toEqual([
      { prefix: "leadership", exclude: ["leadership/comp"] },
      { prefix: "leadership/comp", exclude: [] },
    ]);
  });
  // Edge cases
  it("empty grants → empty scopes", () => {
    expect(computeScopes([], ["restricted"], "viewer")).toEqual([]);
  });
  it("restricted folder outside grant prefix is not included in exclusions", () => {
    // Grant covers only "sales", restricted "leadership" is unrelated → no exclusion needed
    const scopes = computeScopes(
      [g("sales", "viewer")],
      ["leadership"],
      "viewer",
    );
    expect(scopes).toEqual([{ prefix: "sales", exclude: [] }]);
  });
  it("multiple grants each get their own scope", () => {
    const scopes = computeScopes(
      [g("eng", "contributor"), g("sales", "viewer")],
      [],
      "viewer",
    );
    expect(scopes).toEqual([
      { prefix: "eng", exclude: [] },
      { prefix: "sales", exclude: [] },
    ]);
  });
  it("string-prefix collision: restricted 'lead' does not carve out 'leadership'", () => {
    const scopes = computeScopes([g("", "viewer")], ["lead"], "viewer");
    // "lead" is inside the root grant → should be excluded
    expect(scopes).toEqual([{ prefix: "", exclude: ["lead"] }]);
    // But "leadership" is NOT the restricted folder, so pathInScopes should be true
    const pathScope = computeScopes([g("", "viewer")], ["lead"], "viewer");
    expect(pathInScopes(pathScope, "leadership/comp")).toBe(true);
    expect(pathInScopes(pathScope, "lead/secret")).toBe(false);
  });
});

describe("pathInScopes", () => {
  it("matches roleAtPath semantics", () => {
    const scopes = computeScopes(
      [g("", "contributor")],
      ["leadership"],
      "viewer",
    );
    expect(pathInScopes(scopes, "eng/api")).toBe(true);
    expect(pathInScopes(scopes, "leadership/comp")).toBe(false);
  });
  // Edge cases
  it("empty scopes → always false", () => {
    expect(pathInScopes([], "anything")).toBe(false);
  });
  it("excluded prefix does not block sibling with similar name", () => {
    const scopes = [{ prefix: "", exclude: ["secret"] }];
    expect(pathInScopes(scopes, "secret-docs")).toBe(true);
    expect(pathInScopes(scopes, "secret")).toBe(false);
    expect(pathInScopes(scopes, "secret/nested")).toBe(false);
  });
});

describe("escapeLikePrefix", () => {
  it("escapes %, _, and \\ characters", () => {
    // Input:  a%b_c\d
    // Output: a\%b\_c\\d
    expect(escapeLikePrefix("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
  });

  it("leaves clean names unchanged", () => {
    expect(escapeLikePrefix("sales/playbooks")).toBe("sales/playbooks");
    expect(escapeLikePrefix("")).toBe("");
    expect(escapeLikePrefix("eng")).toBe("eng");
  });

  it("escapes multiple consecutive special chars", () => {
    expect(escapeLikePrefix("a%%b")).toBe("a\\%\\%b");
    expect(escapeLikePrefix("__")).toBe("\\_\\_");
    expect(escapeLikePrefix("\\\\")).toBe("\\\\\\\\");
  });

  // Equivalence property: for every (prefix, path) pair built from tricky
  // names, the SQL LIKE predicate (using escapeLikePrefix + a tiny LIKE
  // interpreter that honours \ escapes) agrees with prefixCovers(prefix, path).
  it("SQL LIKE semantics match prefixCovers for paths containing %/_/\\", () => {
    // A tiny LIKE interpreter that supports only the ESCAPE '\' form we emit:
    // pattern is always escapeLikePrefix(prefix) + "/%" (or an equality check).
    function likeMatch(str: string, pattern: string): boolean {
      // We only emit patterns ending in "/%" with \ as escape for special chars.
      // Walk char-by-char: escaped chars are literal, % matches any suffix.
      let si = 0;
      let pi = 0;
      while (pi < pattern.length) {
        const pc = pattern[pi];
        if (pc === "\\") {
          // Next char is literal
          pi++;
          const literal = pattern[pi];
          if (literal === undefined) return false;
          if (str[si] !== literal) return false;
          si++;
          pi++;
        } else if (pc === "%") {
          // Match remaining str (we only ever emit % at the end)
          return true;
        } else {
          if (str[si] !== pc) return false;
          si++;
          pi++;
        }
      }
      return si === str.length;
    }

    function sqlPrefixCovers(prefix: string, path: string): boolean {
      if (prefix === "") return true;
      if (path === prefix) return true;
      return likeMatch(path, `${escapeLikePrefix(prefix)}/%`);
    }

    // Vocabulary of tricky folder-name segments
    const vocab = ["a%", "ax", "a_b", "axb", "a\\b", "sales"];

    // Build all single-segment and two-segment paths
    const paths: string[] = [...vocab];
    for (const a of vocab) {
      for (const b of vocab) {
        paths.push(`${a}/${b}`);
      }
    }

    // Every (prefix, path) combination: SQL and pure algebra must agree
    for (const prefix of vocab) {
      for (const path of paths) {
        const expected = prefixCovers(prefix, path);
        const actual = sqlPrefixCovers(prefix, path);
        expect(actual).toBe(expected);
      }
    }
    // Also verify root prefix
    for (const path of paths) {
      expect(sqlPrefixCovers("", path)).toBe(prefixCovers("", path));
    }
  });
});
