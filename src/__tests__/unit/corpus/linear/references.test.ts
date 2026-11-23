/**
 * The PURE indexers inside the Linear reference pass.
 *
 * Each one turns a root connection the pass walked once into the join a lane reads per page, and each is the
 * replacement for a nested connection `@linear/sdk`'s fragments no longer carry. The direction cases are the
 * load-bearing ones: a relation read from the inverse side has its direction reversed, and a membership edge
 * indexed by the wrong end would place people on the wrong teams.
 */
import { describe, expect, it } from "vitest";

import type { LinearNameIndex, LinearRef, LinearRefKind } from "../../../../corpus/linear/names.js";
import { edgesBy, REFERENCE_LANES, relationsByEndpoint, userTeamsFrom } from "../../../../corpus/linear/references.js";

const INDEX: LinearNameIndex = new Map<LinearRefKind, ReadonlyMap<string, LinearRef>>([
  [
    "team",
    new Map([
      ["t1", { id: "t1", key: "ENG", name: "Engineering" }],
      ["t2", { id: "t2", key: "DATA", name: "Data" }],
    ]),
  ],
  ["initiative", new Map([["n1", { id: "n1", name: "Reliability" }]])],
  ["project", new Map([["p1", { id: "p1", name: "Pooling" }]])],
]);

describe("REFERENCE_LANES", () => {
  it("declares lanes at all, so every guard below is over a non-empty registry", () => {
    expect(REFERENCE_LANES.length).toBeGreaterThan(0);
  });

  it("walks TEAM first, because an issue identifier is derived from a team key", () => {
    expect(REFERENCE_LANES[0]!.kind).toBe("team");
  });

  it("names a distinct kind per lane, so one lane's nodes never overwrite another's map", () => {
    expect(new Set(REFERENCE_LANES.map((lane) => lane.kind)).size).toBe(REFERENCE_LANES.length);
  });
});

describe("relationsByEndpoint", () => {
  const rows = [
    { id: "r1", issue: { id: "i1" }, relatedIssue: { id: "i2" }, type: "blocks" },
    { id: "r2", issue: { id: "i2" }, relatedIssue: { id: "i3" }, type: "related" },
  ];

  it("files a relation under BOTH of its endpoints, which is how one walk serves both directions", () => {
    const byIssue = relationsByEndpoint({ nodes: rows });

    expect(byIssue.get("i1")).toEqual([rows[0]]);
    expect(byIssue.get("i3")).toEqual([rows[1]]);
  });

  it("gives an issue at both ends of two different relations both of them", () => {
    expect(relationsByEndpoint({ nodes: rows }).get("i2")).toEqual([rows[0], rows[1]]);
  });

  it("skips a row that is not an object, and one whose endpoint carries no id", () => {
    const byIssue = relationsByEndpoint({ nodes: [null, { id: "r3", issue: {}, relatedIssue: { id: "i9" } }] });

    expect(byIssue.get("i9")).toEqual([{ id: "r3", issue: {}, relatedIssue: { id: "i9" } }]);
    expect(byIssue.size).toBe(1);
  });
});

describe("edgesBy", () => {
  const links = [
    { initiative: { id: "n1" }, project: { id: "p1" } },
    { initiative: { id: "n1" }, project: { id: "p9" } },
  ];

  it("keys by the `from` end and RESOLVES the `to` end into a named reference", () => {
    const byProject = edgesBy({ from: "project", index: INDEX, nodes: links, to: "initiative" });

    expect(byProject.get("p1")).toEqual([{ id: "n1", name: "Reliability" }]);
  });

  it("reads the SAME rows from the other end, which is why the pass walks them once", () => {
    const byInitiative = edgesBy({ from: "initiative", index: INDEX, nodes: links, to: "project" });

    expect(byInitiative.get("n1")).toEqual([{ id: "p1", name: "Pooling" }]);
  });

  it("DROPS an edge whose target the index cannot name, rather than filing a bare id as a reference", () => {
    const byInitiative = edgesBy({ from: "initiative", index: INDEX, nodes: links, to: "project" });

    expect(byInitiative.get("n1")!.length).toBe(1);
  });

  it("drops a row that is not an object", () => {
    expect(edgesBy({ from: "project", index: INDEX, nodes: [null], to: "initiative" }).size).toBe(0);
  });
});

describe("userTeamsFrom", () => {
  const memberships = [
    { team: { id: "t1" }, user: { id: "u1" } },
    { team: { id: "t2" }, user: { id: "u1" } },
    { team: { id: "t9" }, user: { id: "u2" } },
  ];

  it("indexes the membership edges by USER, in the order the walk saw them", () => {
    const byUser = userTeamsFrom({ index: INDEX, nodes: memberships });

    expect(byUser.get("u1")).toEqual([
      { id: "t1", key: "ENG", name: "Engineering" },
      { id: "t2", key: "DATA", name: "Data" },
    ]);
  });

  it("DROPS an edge whose team the index cannot name — a bare id is not a team reference", () => {
    expect(userTeamsFrom({ index: INDEX, nodes: memberships }).get("u2")).toBe(undefined);
  });

  it("drops an edge carrying no user id at all", () => {
    expect(userTeamsFrom({ index: INDEX, nodes: [{ team: { id: "t1" }, user: {} }] }).size).toBe(0);
  });
});
