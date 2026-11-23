import { describe, expect, it } from "vitest";

import type { EntityKey } from "../../../footprint/entities.js";
import { componentsOf, HUB_THRESHOLD, hardEdges, hubEntities } from "../../../footprint/grouping.js";
import type { FootprintNode } from "../../../footprint/nodes.js";

const node = ({ id, entities }: { id: string; entities: readonly EntityKey[] }): FootprintNode => ({
  asksForSomething: false,
  entities: new Set(entities),
  hasDependentStep: false,
  hasResolution: false,
  id,
  label: id,
  lastMovedIso: "2026-09-01T00:00:00.000Z",
  ownerSpokeLast: true,
  provenance: { kind: "board", slug: id },
});

describe("hardEdges", () => {
  it("joins two nodes about the same pull request", () => {
    const nodes = [node({ entities: ["pr:o/r#1"], id: "a" }), node({ entities: ["pr:o/r#1"], id: "b" })];

    expect(hardEdges({ nodes })).toEqual([{ left: "a", right: "b", via: "pr:o/r#1" }]);
  });

  it("joins nothing when two nodes share no entity", () => {
    const nodes = [node({ entities: ["pr:o/r#1"], id: "a" }), node({ entities: ["pr:o/r#2"], id: "b" })];

    expect(hardEdges({ nodes })).toEqual([]);
  });

  it("drops an entity that joins more nodes than the hub threshold allows", () => {
    const nodes = Array.from({ length: HUB_THRESHOLD + 1 }, (_unused, index) =>
      node({ entities: ["linear:JJJJ-1552"], id: `n${String(index)}` }),
    );

    expect(hardEdges({ nodes })).toEqual([]);
  });

  it("keeps an entity that joins exactly the hub threshold", () => {
    const nodes = Array.from({ length: HUB_THRESHOLD }, (_unused, index) =>
      node({ entities: ["linear:JJJJ-1552"], id: `n${String(index)}` }),
    );

    expect(hardEdges({ nodes }).length).toBe(HUB_THRESHOLD - 1);
  });
});

describe("hubEntities", () => {
  it("names the over-shared entity and nothing else", () => {
    const nodes = Array.from({ length: HUB_THRESHOLD + 1 }, (_unused, index) =>
      node({ entities: ["linear:JJJJ-1552", "pr:o/r#9"], id: `n${String(index)}` }),
    );

    expect([...hubEntities({ nodes })].toSorted()).toEqual(["linear:JJJJ-1552", "pr:o/r#9"]);
  });

  it("names nothing when every entity is under the threshold", () => {
    const nodes = [node({ entities: ["pr:o/r#1"], id: "a" }), node({ entities: ["pr:o/r#1"], id: "b" })];

    expect([...hubEntities({ nodes })]).toEqual([]);
  });
});

describe("componentsOf", () => {
  it("puts a node joined to nothing in its own component, so the true yield is reportable", () => {
    const nodes = [node({ entities: [], id: "a" }), node({ entities: [], id: "b" })];

    expect(componentsOf({ nodes }).length).toBe(2);
  });

  it("merges a transitive chain into one component", () => {
    const nodes = [
      node({ entities: ["pr:o/r#1"], id: "a" }),
      node({ entities: ["pr:o/r#1", "linear:AB-2"], id: "b" }),
      node({ entities: ["linear:AB-2"], id: "c" }),
    ];
    const components = componentsOf({ nodes });

    expect(components.length).toBe(1);
    expect([...components[0]!.nodeIds].toSorted()).toEqual(["a", "b", "c"]);
  });

  it("carries the edges that justified a component", () => {
    const nodes = [node({ entities: ["pr:o/r#1"], id: "a" }), node({ entities: ["pr:o/r#1"], id: "b" })];
    const components = componentsOf({ nodes });

    expect(components[0]!.edges).toEqual([{ left: "a", right: "b", via: "pr:o/r#1" }]);
  });

  it("accounts for every node exactly once", () => {
    const nodes = [
      node({ entities: ["pr:o/r#1"], id: "a" }),
      node({ entities: ["pr:o/r#1"], id: "b" }),
      node({ entities: [], id: "c" }),
    ];
    const seen = componentsOf({ nodes }).flatMap((component) => component.nodeIds);

    expect(seen.length).toBe(3);
    expect([...seen].toSorted()).toEqual(["a", "b", "c"]);
  });
});
