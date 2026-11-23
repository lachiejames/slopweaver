/**
 * The PURE page-and-join primitives the Linear lanes are built from.
 *
 * Every case here is a shape the provider really returns. The join helpers matter most: they are what the
 * SDK migration's twelve `?? []`/`?? {}` expressions became, so their "nothing joined" answer is the one a
 * projector reads for an issue nobody commented on — an empty connection, never a missing one.
 */
import { describe, expect, it } from "vitest";

import {
  appendTo,
  clampPageSize,
  companionConnections,
  hydrateStatus,
  idsOf,
  issueNodeId,
  joinedNested,
  joinedRows,
  rootPage,
  touches,
} from "../../../../corpus/linear/fetchPages.js";
import type { LinearNameIndex, LinearRef, LinearRefKind } from "../../../../corpus/linear/names.js";

function connection({ nodes, hasNext, endCursor }: { nodes: unknown[]; hasNext?: boolean; endCursor?: string }) {
  return { nodes, pageInfo: { endCursor, hasNextPage: hasNext === true } };
}

describe("rootPage", () => {
  it("reads a connection's nodes off the root field it was asked for", () => {
    const page = rootPage({ data: { issues: connection({ nodes: [{ id: "a" }, { id: "b" }] }) }, key: "issues" });

    expect(page.nodes).toEqual([{ id: "a" }, { id: "b" }]);
    expect(page.nextCursor).toBe(undefined);
  });

  it("carries the cursor only when the connection reports another page AND names one", () => {
    const data = { issues: connection({ endCursor: "c1", hasNext: true, nodes: [] }) };

    expect(rootPage({ data, key: "issues" }).nextCursor).toBe("c1");
  });

  it("carries NO cursor when the page reports more but names none, which is the unfollowable case", () => {
    const data = { issues: connection({ hasNext: true, nodes: [] }) };

    expect(rootPage({ data, key: "issues" }).nextCursor).toBe(undefined);
  });

  it("carries NO cursor when the connection names one but reports no further page", () => {
    const data = { issues: connection({ endCursor: "c1", hasNext: false, nodes: [] }) };

    expect(rootPage({ data, key: "issues" }).nextCursor).toBe(undefined);
  });

  it("treats an EMPTY end cursor as no cursor, which is Linear's own last-page signal", () => {
    const data = { issues: connection({ endCursor: "", hasNext: true, nodes: [] }) };

    expect(rootPage({ data, key: "issues" }).nextCursor).toBe(undefined);
  });

  it("answers an empty page for a root field the response does not carry", () => {
    expect(rootPage({ data: { projects: connection({ nodes: [] }) }, key: "issues" }).nodes).toEqual([]);
  });

  it("answers an empty page for a response that is not an object at all", () => {
    expect(rootPage({ data: "not a response", key: "issues" }).nodes).toEqual([]);
  });
});

describe("joinedRows", () => {
  it("yields the holder's rows when the join has them", () => {
    const byId = new Map([["i1", [{ body: "hello" }]]]);

    expect(joinedRows({ byId, id: "i1" })).toEqual([{ body: "hello" }]);
  });

  it("yields an EMPTY list for a holder the join never saw — an issue nobody commented on", () => {
    const byId = new Map([["i1", [{ body: "hello" }]]]);

    expect(joinedRows({ byId, id: "i2" })).toEqual([]);
  });
});

describe("joinedNested", () => {
  it("yields the holder's connection bag when the join has one", () => {
    const byId = new Map([["i1", { history: [{ id: "h1" }] }]]);

    expect(joinedNested({ byId, id: "i1" })).toEqual({ history: [{ id: "h1" }] });
  });

  it("yields an EMPTY bag for a holder the join never saw", () => {
    const byId = new Map([["i1", { history: [{ id: "h1" }] }]]);

    expect(joinedNested({ byId, id: "i2" })).toEqual({});
  });
});

describe("clampPageSize", () => {
  it("takes the lane maximum when the caller asked for nothing", () => {
    expect(clampPageSize({ laneMax: 250, requested: undefined })).toBe(250);
  });

  it("takes the caller's size when it is under the lane maximum", () => {
    expect(clampPageSize({ laneMax: 250, requested: 40 })).toBe(40);
  });

  it("CLAMPS a --fetch-cap that would make one query more expensive than the lane measured safe", () => {
    expect(clampPageSize({ laneMax: 25, requested: 40 })).toBe(25);
  });
});

describe("issueNodeId", () => {
  it("prefers the internal id, which is what every other lane joins against", () => {
    expect(issueNodeId({ node: { id: "uuid-1", identifier: "ENG-1" } })).toBe("uuid-1");
  });

  it("falls back to the identifier, named rather than coalesced, when the node carries no id", () => {
    expect(issueNodeId({ node: { identifier: "ENG-1" } })).toBe("ENG-1");
  });

  it("answers undefined for a node carrying neither", () => {
    expect(issueNodeId({ node: { title: "no ids here" } })).toBe(undefined);
  });

  it("answers undefined for a node that is not an object", () => {
    expect(issueNodeId({ node: null })).toBe(undefined);
  });
});

describe("touches", () => {
  const held = new Set(["i1"]);

  it("holds a relation whose FORWARD end is on the page", () => {
    expect(touches({ held, row: { issue: { id: "i1" }, relatedIssue: { id: "x" } } })).toBe(true);
  });

  it("holds a relation whose INVERSE end is on the page", () => {
    expect(touches({ held, row: { issue: { id: "x" }, relatedIssue: { id: "i1" } } })).toBe(true);
  });

  it("drops a relation between two issues this page does not carry", () => {
    expect(touches({ held, row: { issue: { id: "x" }, relatedIssue: { id: "y" } } })).toBe(false);
  });

  it("drops a row that is not an object", () => {
    expect(touches({ held, row: 7 })).toBe(false);
  });
});

describe("appendTo", () => {
  it("mints the list on first use and pushes onto it after", () => {
    const into = new Map<string, unknown[]>();
    appendTo({ into, key: "i1", value: "a" });
    appendTo({ into, key: "i1", value: "b" });
    appendTo({ into, key: "i2", value: "c" });

    expect(into.get("i1")).toEqual(["a", "b"]);
    expect(into.get("i2")).toEqual(["c"]);
  });
});

describe("companionConnections", () => {
  it("folds each holder's named connections off the companion document", () => {
    const data = {
      projects: connection({
        nodes: [{ id: "p1", members: connection({ nodes: [{ id: "u1" }] }), teams: connection({ nodes: [] }) }],
      }),
    };
    const warnings: string[] = [];

    const byHolder = companionConnections({ data, key: "projects", keys: ["teams", "members"], warnings });

    expect(byHolder.get("p1")).toEqual({ members: [{ id: "u1" }], teams: [] });
    expect(warnings).toEqual([]);
  });

  it("REPORTS a nested page that overflowed, because the companion document has no cursor to follow", () => {
    const data = {
      projects: connection({ nodes: [{ id: "p1", teams: connection({ hasNext: true, nodes: [{ id: "t1" }] }) }] }),
    };
    const warnings: string[] = [];

    companionConnections({ data, key: "projects", keys: ["teams"], warnings });

    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("linear projects p1 teams");
  });

  it("skips a holder carrying no id, which nothing could be joined back onto", () => {
    const data = { projects: connection({ nodes: [{ teams: connection({ nodes: [] }) }] }) };

    expect(companionConnections({ data, key: "projects", keys: ["teams"], warnings: [] }).size).toBe(0);
  });
});

describe("hydrateStatus", () => {
  const index: LinearNameIndex = new Map<LinearRefKind, ReadonlyMap<string, LinearRef>>([
    ["projectStatus", new Map([["s1", { id: "s1", name: "In progress", type: "started" }]])],
    ["workflowState", new Map([["s1", { id: "s1", name: "A WORKFLOW STATE", type: "started" }]])],
    ["user", new Map([["u1", { displayName: "ada", id: "u1" }]])],
  ]);

  it("resolves a project's `status` against the PROJECT-STATUS index, not the workflow-state one", () => {
    const hydrated = hydrateStatus({ index, node: { id: "p1", status: { id: "s1" } }, spec: {} });

    expect((hydrated as { status: { name: string } }).status.name).toBe("In progress");
  });

  it("resolves the spec's own references in the same pass", () => {
    const hydrated = hydrateStatus({ index, node: { id: "p1", lead: { id: "u1" } }, spec: { lead: "user" } });

    expect((hydrated as { lead: { displayName: string } }).lead.displayName).toBe("ada");
  });
});

describe("idsOf", () => {
  it("takes the ids in page order", () => {
    expect(idsOf({ nodes: [{ id: "a" }, { id: "b" }] })).toEqual(["a", "b"]);
  });

  it("SKIPS a node carrying no id rather than yielding a hole", () => {
    expect(idsOf({ nodes: [{ id: "a" }, { title: "no id" }, null, { id: "b" }] })).toEqual(["a", "b"]);
  });
});
