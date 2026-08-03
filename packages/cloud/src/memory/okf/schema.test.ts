import { describe, expect, it } from "vitest";

import {
  DB_OWNED_KEYS,
  DEFAULT_TYPE,
  FIELDS,
  isDbOwnedKey,
  isKnownKey,
  KEY_ORDER,
  kindForType,
  KNOWN_TYPES,
  OKF_VERSION,
  okfFrontmatterSchema,
  typeForKind,
} from "./schema";

describe("okf schema", () => {
  it("declares OKF v0.1", () => {
    expect(OKF_VERSION).toBe("0.1");
  });

  it("maps known types to node kinds", () => {
    expect(kindForType("Note")).toBe("note");
    expect(kindForType("Dataset")).toBe("dataset");
    expect(kindForType("Company Profile")).toBe("note");
  });

  it("maps unknown types to note (spec: tolerate unknown types)", () => {
    expect(kindForType("BigQuery Table")).toBe("note");
  });

  it("maps kinds back to canonical types", () => {
    expect(typeForKind("note")).toBe(DEFAULT_TYPE);
    expect(typeForKind("dataset")).toBe("Dataset");
    expect(typeForKind("folder")).toBe(DEFAULT_TYPE);
  });

  it("accepts full OKF frontmatter and preserves extension keys", () => {
    const parsed = okfFrontmatterSchema.parse({
      type: "Note",
      title: "T",
      description: "d",
      tags: ["a"],
      timestamp: "2026-07-18T00:00:00Z",
      sources: ["nimbase://source/8f14e45f-ceea-4e17-a0f6-2b7a1a2b3c4d"],
      custom_key: "kept",
    });
    expect(parsed.custom_key).toBe("kept");
  });

  it("rejects an empty type (OKF conformance rule)", () => {
    expect(okfFrontmatterSchema.safeParse({ type: "" }).success).toBe(false);
  });

  it("KNOWN_TYPES only contains valid kinds", () => {
    for (const kind of Object.values(KNOWN_TYPES)) {
      expect(["note", "dataset"]).toContain(kind);
    }
  });
});

describe("field registry", () => {
  it("stays exhaustive over the serialized key order", () => {
    // Compile-time enforced by Record<KnownKey, FieldSpec>; asserted here so
    // the failure is legible if the shape and the behavior table ever drift.
    expect(Object.keys(FIELDS).sort()).toEqual([...KEY_ORDER].sort());
  });

  it("keeps db-owned names out of the frontmatter field list", () => {
    for (const key of DB_OWNED_KEYS) {
      expect(isKnownKey(key)).toBe(false);
      expect(isDbOwnedKey(key)).toBe(true);
    }
  });

  it("gives every projected field a way back from the db", () => {
    // A field that projects into Postgres but can't be rebuilt from it would
    // make `reproject` lossy, so the two directions must be declared together.
    for (const [key, spec] of Object.entries(FIELDS)) {
      if (!spec.project) continue;
      expect(spec.fromDb, `${key} projects but has no fromDb`).toBeDefined();
    }
  });
});
