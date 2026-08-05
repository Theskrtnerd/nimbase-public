import { describe, expect, it } from "vitest";

import {
  frontmatterFromDb,
  parseOkf,
  projectToDb,
  serializeOkf,
  sourceIdFromUri,
  sourceUriFor,
  stampServerFields,
} from "./codec";

const UUID = "8f14e45f-ceea-4e17-a0f6-2b7a1a2b3c4d";

describe("parseOkf", () => {
  it("parses full OKF frontmatter", () => {
    const body = `---\ntype: Dataset\ntitle: Pricing\ndescription: Plans\ntags: [pricing]\ntimestamp: "2026-07-18T00:00:00.000Z"\nsources:\n  - nimbase://source/${UUID}\n---\n# Body\n`;
    const { meta, content } = parseOkf(body);
    expect(meta.type).toBe("Dataset");
    expect(meta.title).toBe("Pricing");
    expect(meta.description).toBe("Plans");
    expect(meta.tags).toEqual(["pricing"]);
    expect(meta.timestamp).toBe("2026-07-18T00:00:00.000Z");
    expect(meta.sources).toEqual([`nimbase://source/${UUID}`]);
    expect(content).toBe("# Body\n");
  });

  it("reports whether the body declared its own frontmatter", () => {
    expect(parseOkf("---\ntitle: T\n---\nx").declared).toBe(true);
    expect(parseOkf("plain prose").declared).toBe(false);
  });

  it("defaults type to Note on legacy bodies (permissive read)", () => {
    const { meta } = parseOkf("---\ntitle: Old\n---\nhello");
    expect(meta.type).toBe("Note");
    expect(meta.title).toBe("Old");
  });

  it("tolerates a body with no frontmatter at all", () => {
    const { meta, content } = parseOkf("just prose");
    expect(meta.type).toBe("Note");
    expect(meta.title).toBeUndefined();
    expect(content).toBe("just prose");
  });

  it("normalizes tags and drops non-string junk", () => {
    const { meta } = parseOkf('---\ntitle: T\ntags: ["My Tag", 3]\n---\nx');
    expect(meta.tags).toEqual(["my-tag"]);
  });

  it("preserves unknown extension keys", () => {
    const { meta } = parseOkf(
      "---\ntype: Note\ntitle: T\nresource: https://x\n---\nx",
    );
    expect(meta.resource).toBe("https://x");
  });

  it("drops malformed source URIs", () => {
    const { meta } = parseOkf(
      "---\ntitle: T\nsources: [https://x, nimbase://source/a/b]\n---\nx",
    );
    expect(meta.sources).toBeUndefined();
  });
});

describe("serializeOkf + round-trip", () => {
  it("serializes with deterministic key order", () => {
    const body = serializeOkf(
      {
        sources: [sourceUriFor(UUID)],
        title: "T",
        custom: "kept",
        type: "Note",
        tags: ["a"],
        description: "d",
        timestamp: "2026-07-18T00:00:00.000Z",
      },
      "content\n",
    );
    const keys = [...body.matchAll(/^(\w+):/gm)].map((m) => m[1]);
    expect(keys).toEqual([
      "type",
      "title",
      "description",
      "tags",
      "timestamp",
      "sources",
      "custom",
    ]);
  });

  it("round-trips: parse(serialize(meta)) is stable", () => {
    const meta = {
      type: "Dataset",
      title: "T",
      description: "d",
      tags: ["a"],
      timestamp: "2026-07-18T00:00:00.000Z",
      sources: [sourceUriFor(UUID)],
      custom: "kept",
    };
    const once = serializeOkf(meta, "content\n");
    const { meta: reparsed, content } = parseOkf(once);
    expect(serializeOkf(reparsed, content)).toBe(once);
  });

  it("omits empty optional fields", () => {
    const body = serializeOkf({ type: "Note", title: "T", tags: [] }, "x");
    expect(body).not.toContain("tags:");
    expect(body).not.toContain("description:");
  });
});

describe("source URIs", () => {
  it("round-trips a uuid", () => {
    expect(sourceIdFromUri(sourceUriFor(UUID))).toBe(UUID);
  });
  it("rejects non-source URIs and malformed id segments", () => {
    expect(sourceIdFromUri("https://example.com")).toBeNull();
    expect(sourceIdFromUri("nimbase://source/")).toBeNull();
    expect(sourceIdFromUri("nimbase://source/a/b")).toBeNull();
  });
});

describe("projectToDb", () => {
  it("projects frontmatter into the derived index shape", () => {
    const { meta } = parseOkf(
      `---\ntype: Dataset\ntitle: T\ndescription: d\ntags: [a]\nsources: [nimbase://source/${UUID}]\n---\nx`,
    );
    expect(projectToDb(meta)).toEqual({
      title: "T",
      kind: "dataset",
      summary: "d",
      tags: ["a"],
      sourceIds: [UUID],
    });
  });
});

describe("stampServerFields", () => {
  const now = () => new Date("2026-07-20T12:00:00.000Z");

  it("fills title and description only when the body declares none", () => {
    const meta = parseOkf("# just content").meta;
    stampServerFields(meta, {
      fallbackTitle: "From Node",
      fallbackDescription: "Synthesized",
      now,
    });
    expect(meta.title).toBe("From Node");
    expect(meta.description).toBe("Synthesized");
  });

  // The regression this whole change exists for: an agent-synthesized summary
  // used to overwrite a human-written description on every touch.
  it("never overwrites a declared description", () => {
    const meta = parseOkf(
      "---\ntitle: Kept\ndescription: Human wrote this\n---\nbody",
    ).meta;
    stampServerFields(meta, {
      fallbackTitle: "Ignored",
      fallbackDescription: "Agent synthesized this",
      now,
    });
    expect(meta.description).toBe("Human wrote this");
    expect(meta.title).toBe("Kept");
  });

  it("always overwrites timestamp — authors cannot set it", () => {
    const meta = parseOkf(
      '---\ntimestamp: "1999-01-01T00:00:00.000Z"\n---\nb',
    ).meta;
    stampServerFields(meta, { now });
    expect(meta.timestamp).toBe("2026-07-20T12:00:00.000Z");
  });

  it("unions the job source into sources without dropping existing ones", () => {
    const meta = parseOkf(
      `---\nsources:\n  - nimbase://source/${UUID}\n---\nb`,
    ).meta;
    stampServerFields(meta, { sourceId: "abc123", now });
    expect(meta.sources).toEqual([
      `nimbase://source/${UUID}`,
      "nimbase://source/abc123",
    ]);
  });

  it("leaves authored fields alone", () => {
    const meta = parseOkf("---\ntype: Dataset\ntags: [a]\n---\nb").meta;
    stampServerFields(meta, { now });
    expect(meta.type).toBe("Dataset");
    expect(meta.tags).toEqual(["a"]);
  });
});

describe("frontmatterFromDb", () => {
  it("rebuilds frontmatter from the derived index", () => {
    const meta = frontmatterFromDb({
      title: "Product Positioning",
      kind: "note",
      summary: "Public-facing pitch",
      tags: ["product", "vision"],
      sourceIds: [UUID],
    });
    expect(meta.type).toBe("Note");
    expect(meta.title).toBe("Product Positioning");
    expect(meta.description).toBe("Public-facing pitch");
    expect(meta.tags).toEqual(["product", "vision"]);
    expect(meta.sources).toEqual([`nimbase://source/${UUID}`]);
    // The server clock owns freshness; the body's timestamp is a different
    // fact and is supplied by the write path, not rebuilt from the DB.
    expect(meta.timestamp).toBeUndefined();
  });

  it("maps dataset kind back to its type", () => {
    expect(
      frontmatterFromDb({
        title: "T",
        kind: "dataset",
        summary: null,
        tags: [],
        sourceIds: [],
      }).type,
    ).toBe("Dataset");
  });

  it("round-trips through the projection", () => {
    const row = {
      title: "T",
      kind: "dataset" as const,
      summary: "S",
      tags: ["a", "b"],
      sourceIds: [UUID],
    };
    expect(projectToDb(frontmatterFromDb(row))).toEqual(row);
  });
});

describe("db-owned keys", () => {
  it("drops path and access if a body tries to declare them", () => {
    const { meta } = parseOkf(
      "---\ntitle: T\npath: ../../etc/secrets\naccess: admin\n---\nb",
    );
    expect(meta.path).toBeUndefined();
    expect(meta.access).toBeUndefined();
  });

  it("never serializes them even if injected downstream", () => {
    const meta = parseOkf("---\ntitle: T\n---\nb").meta;
    (meta as Record<string, unknown>).access = "admin";
    expect(serializeOkf(meta, "b")).not.toContain("access");
  });
});

describe("extension keys", () => {
  it("round-trips idempotently, including empty values", () => {
    const body = "---\ntitle: T\nowner: alice\nreviewers: []\nnote: ''\n---\nb";
    const once = serializeOkf(parseOkf(body).meta, "b");
    const twice = serializeOkf(parseOkf(once).meta, "b");
    expect(twice).toBe(once);
    expect(parseOkf(once).meta.owner).toBe("alice");
    // Empty extension values are dropped on the same rule as known keys.
    expect(once).not.toContain("reviewers");
    expect(once).not.toContain("note:");
  });
});
