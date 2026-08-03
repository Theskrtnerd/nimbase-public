import { describe, expect, it } from "vitest";

import { buildKnowledgeGraph } from "./knowledge-graph";

const note = (
  nodeId: string,
  path: string,
  body: string,
  title = `Title for ${path}`,
) => ({
  nodeId,
  path,
  body,
  title,
});

describe("buildKnowledgeGraph hiddenPaths", () => {
  it("drops ghost nodes and edges pointing at hidden notes", () => {
    const graph = buildKnowledgeGraph(
      [
        note(
          "1",
          "eng/api",
          "links to [[leadership/comp-bands]] and [[truly-missing]]",
        ),
      ],
      { hiddenPaths: ["leadership/comp-bands"] },
    );
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toContain("eng/api");
    expect(ids).toContain("truly-missing"); // genuine ghost survives
    expect(ids).not.toContain("leadership/comp-bands"); // hidden — no title leak
    expect(graph.links).toHaveLength(1);
  });

  it("suppresses basename-resolved hidden targets too", () => {
    const graph = buildKnowledgeGraph(
      [note("1", "eng/api", "see [[comp-bands]]")],
      { hiddenPaths: ["leadership/comp-bands"] },
    );
    expect(graph.nodes.map((n) => n.id)).toEqual(["eng/api"]);
    expect(graph.links).toHaveLength(0);
  });

  it("no opts → unchanged behavior (ghosts appear)", () => {
    const graph = buildKnowledgeGraph([
      note("1", "eng/api", "see [[missing-note]]"),
    ]);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual([
      "eng/api",
      "missing-note",
    ]);
  });

  it("hidden path with .md extension is stripped before comparison", () => {
    const graph = buildKnowledgeGraph(
      [note("1", "eng/api", "see [[leadership/comp-bands]]")],
      { hiddenPaths: ["leadership/comp-bands.md"] },
    );
    expect(graph.nodes.map((n) => n.id)).not.toContain("leadership/comp-bands");
    expect(graph.links).toHaveLength(0);
  });

  it("hidden path with .mdx extension is stripped before comparison", () => {
    const graph = buildKnowledgeGraph(
      [note("1", "eng/api", "see [[leadership/comp-bands]]")],
      { hiddenPaths: ["leadership/comp-bands.mdx"] },
    );
    expect(graph.nodes.map((n) => n.id)).not.toContain("leadership/comp-bands");
    expect(graph.links).toHaveLength(0);
  });

  it("wikilink with |alias pointing at hidden note is suppressed", () => {
    const graph = buildKnowledgeGraph(
      [
        note(
          "1",
          "eng/api",
          "see [[leadership/comp-bands|Compensation Bands]]",
        ),
      ],
      { hiddenPaths: ["leadership/comp-bands"] },
    );
    expect(graph.nodes.map((n) => n.id)).not.toContain("leadership/comp-bands");
    expect(graph.links).toHaveLength(0);
  });

  it("basename match is case-insensitive", () => {
    const graph = buildKnowledgeGraph(
      [note("1", "eng/api", "see [[Comp-Bands]]")],
      { hiddenPaths: ["leadership/comp-bands"] },
    );
    expect(graph.nodes.map((n) => n.id)).not.toContain("Comp-Bands");
    expect(graph.links).toHaveLength(0);
  });

  it("visible notes are not suppressed when hiddenPaths is provided", () => {
    const graph = buildKnowledgeGraph(
      [
        note("1", "eng/api", "links to [[eng/utils]]"),
        note("2", "eng/utils", "body"),
      ],
      { hiddenPaths: ["leadership/comp-bands"] },
    );
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toContain("eng/api");
    expect(ids).toContain("eng/utils");
    expect(graph.links).toHaveLength(1);
  });

  it("empty hiddenPaths array leaves ghosts intact", () => {
    const graph = buildKnowledgeGraph(
      [note("1", "eng/api", "see [[ghost-note]]")],
      { hiddenPaths: [] },
    );
    expect(graph.nodes.map((n) => n.id)).toContain("ghost-note");
    expect(graph.links).toHaveLength(1);
  });

  it("suppresses hidden targets written with a trailing slash", () => {
    const graph = buildKnowledgeGraph(
      [note("1", "eng/api", "see [[leadership/comp-bands/]]")],
      { hiddenPaths: ["leadership/comp-bands"] },
    );
    expect(graph.nodes.map((n) => n.id)).toEqual(["eng/api"]);
    expect(graph.links).toHaveLength(0);
  });

  it("suppresses hidden targets with extension plus trailing slash", () => {
    const graph = buildKnowledgeGraph(
      [note("1", "eng/api", "see [[leadership/comp-bands.md/]]")],
      { hiddenPaths: ["leadership/comp-bands"] },
    );
    expect(graph.nodes.map((n) => n.id)).toEqual(["eng/api"]);
    expect(graph.links).toHaveLength(0);
  });

  it("suppresses hidden targets with a #anchor fragment", () => {
    const graph = buildKnowledgeGraph(
      [note("1", "eng/api", "see [[leadership/comp-bands#section]]")],
      { hiddenPaths: ["leadership/comp-bands"] },
    );
    expect(graph.nodes.map((n) => n.id)).toEqual(["eng/api"]);
    expect(graph.links).toHaveLength(0);
  });

  it("genuine ghosts with those same shapes still appear", () => {
    const graph = buildKnowledgeGraph(
      [
        note(
          "1",
          "eng/api",
          "see [[missing/]] and [[missing.md/]] and [[missing#section]]",
        ),
      ],
      { hiddenPaths: ["leadership/comp-bands"] },
    );
    // One source node + three distinct ghost nodes, each still linked.
    expect(graph.nodes).toHaveLength(4);
    expect(graph.links).toHaveLength(3);
    expect(graph.nodes.filter((n) => n.ghost)).toHaveLength(3);
  });
});

describe("buildKnowledgeGraph titles", () => {
  it("uses the note's title directly — no path derivation for real notes", () => {
    const graph = buildKnowledgeGraph([
      note("1", "eng/api-gw", "no links here", "The API Gateway"),
    ]);
    expect(graph.nodes[0]?.title).toBe("The API Gateway");
  });

  it("ghost nodes (no WikiNode row) still get a path-derived label", () => {
    const graph = buildKnowledgeGraph([
      note("1", "eng/api-gw", "see [[missing-note]]", "The API Gateway"),
    ]);
    const ghost = graph.nodes.find((n) => n.ghost);
    expect(ghost?.title).toBe("Missing note");
  });
});
