/**
 * The crawl's id-to-name index, and the rehydration that puts `@linear/sdk`'s bare `{ id }` references back
 * into the objects this connector's projectors read.
 *
 * Every case is a plain value: the index is pure, and so is every function over it. No mocks, no I/O.
 */
import { describe, expect, it } from "vitest";

import {
  hydrateNode,
  issueRefsFrom,
  linearNameIndexFrom,
  refsForIds,
  refsFrom,
} from "../../../../corpus/linear/names.js";

const TEAMS = [{ id: "t1", key: "ENG", name: "Engineering" }];
const USERS = [
  { displayName: "kim.lee", id: "u1", name: "Kim Lee" },
  { displayName: "ada", id: "u2", name: "Ada Lovelace" },
];

describe("refsFrom", () => {
  it("keeps exactly the fields the replaced document used to select", () => {
    const refs = refsFrom({ kind: "user", nodes: USERS });

    expect(refs.get("u1")).toEqual({ displayName: "kim.lee", id: "u1", name: "Kim Lee" });
  });

  it("drops a field the node does not carry rather than defaulting it", () => {
    const refs = refsFrom({ kind: "team", nodes: [{ id: "t9", key: "OPS" }] });

    expect(refs.get("t9")).toEqual({ id: "t9", key: "OPS" });
  });

  it("treats an explicit null exactly as an absent field", () => {
    const refs = refsFrom({ kind: "cycle", nodes: [{ id: "c1", name: null, number: 12 }] });

    expect(refs.get("c1")).toEqual({ id: "c1", number: 12 });
  });

  it("SKIPS a node with no id rather than keying on undefined", () => {
    const refs = refsFrom({ kind: "user", nodes: [{ displayName: "nobody" }, "not a node", null] });

    expect(refs.size).toBe(0);
  });
});

describe("issueRefsFrom", () => {
  it("takes the identifier the document carried", () => {
    const refs = issueRefsFrom({ nodes: [{ id: "i1", identifier: "ENG-42" }], teams: new Map() });

    expect(refs.get("i1")).toEqual({ id: "i1", identifier: "ENG-42" });
  });

  it("DERIVES the identifier from the team key and the number when the node carries neither", () => {
    const teams = refsFrom({ kind: "team", nodes: TEAMS });
    const refs = issueRefsFrom({ nodes: [{ id: "i2", number: 7, team: { id: "t1" } }], teams });

    expect(refs.get("i2")).toEqual({ id: "i2", identifier: "ENG-7" });
  });

  it("keeps the id alone when the team is not in the index, rather than inventing a key", () => {
    const refs = issueRefsFrom({ nodes: [{ id: "i3", number: 7, team: { id: "unknown" } }], teams: new Map() });

    expect(refs.get("i3")).toEqual({ id: "i3" });
  });
});

describe("hydrateNode", () => {
  const index = linearNameIndexFrom({
    lanes: { project: [{ id: "p1", name: "Pool rewrite" }], team: TEAMS, user: USERS },
  });

  it("puts the resolved fields back under the key the reference arrived under", () => {
    const node = hydrateNode({
      index,
      node: { creator: { id: "u2" }, id: "x", team: { id: "t1" } },
      spec: { creator: "user", team: "team" },
    });

    expect(node).toEqual({
      creator: { displayName: "ada", id: "u2", name: "Ada Lovelace" },
      id: "x",
      team: { id: "t1", key: "ENG", name: "Engineering" },
    });
  });

  it("resolves the same kind under DIFFERENT field names, which is why the spec is per lane", () => {
    const node = hydrateNode({
      index,
      node: { assignee: { id: "u1" }, creator: { id: "u2" } },
      spec: { assignee: "user", creator: "user" },
    });

    expect(node).toEqual({
      assignee: { displayName: "kim.lee", id: "u1", name: "Kim Lee" },
      creator: { displayName: "ada", id: "u2", name: "Ada Lovelace" },
    });
  });

  it("KEEPS the bare reference when the index has never seen that id — absent, never wrong", () => {
    const node = hydrateNode({ index, node: { creator: { id: "u-gone" } }, spec: { creator: "user" } });

    expect(node).toEqual({ creator: { id: "u-gone" } });
  });

  it("leaves a null reference alone rather than turning it into an object", () => {
    const node = hydrateNode({ index, node: { lead: null }, spec: { lead: "user" } });

    expect(node).toEqual({ lead: null });
  });

  it("leaves every key the spec does not name untouched", () => {
    const node = hydrateNode({ index, node: { body: "hi", id: "c1" }, spec: { user: "user" } });

    expect(node).toEqual({ body: "hi", id: "c1" });
  });

  it("returns a non-record unchanged", () => {
    expect(hydrateNode({ index, node: "not a node", spec: { user: "user" } })).toBe("not a node");
  });
});

describe("refsForIds", () => {
  const index = linearNameIndexFrom({
    lanes: {
      issueLabel: [
        { id: "l1", name: "bug" },
        { id: "l2", name: "ship" },
      ],
    },
  });

  it("rebuilds a connection from the scalar id list the fragment carries instead", () => {
    expect(refsForIds({ ids: ["l2", "l1"], index, kind: "issueLabel" })).toEqual([
      { id: "l2", name: "ship" },
      { id: "l1", name: "bug" },
    ]);
  });

  it("drops an id the index does not know rather than emitting a nameless label", () => {
    expect(refsForIds({ ids: ["l1", "l-gone"], index, kind: "issueLabel" })).toEqual([{ id: "l1", name: "bug" }]);
  });

  it("answers empty for a missing or non-array id list", () => {
    expect(refsForIds({ ids: undefined, index, kind: "issueLabel" })).toEqual([]);
    expect(refsForIds({ ids: "l1", index, kind: "issueLabel" })).toEqual([]);
  });

  it("answers empty for a kind no reference lane supplied", () => {
    expect(refsForIds({ ids: ["c1"], index, kind: "customer" })).toEqual([]);
  });
});

describe("linearNameIndexFrom", () => {
  it("derives issue identifiers against the TEAM lane it was given in the same call", () => {
    const index = linearNameIndexFrom({ lanes: { issue: [{ id: "i1", number: 3, team: { id: "t1" } }], team: TEAMS } });

    expect(index.get("issue")!.get("i1")).toEqual({ id: "i1", identifier: "ENG-3" });
  });

  it("holds no map at all for a kind whose lane was not supplied", () => {
    expect(linearNameIndexFrom({ lanes: { team: TEAMS } }).get("user")).toBe(undefined);
  });
});
