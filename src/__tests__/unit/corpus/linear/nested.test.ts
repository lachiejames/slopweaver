import { describe, expect, it } from "vitest";
import { absentAs } from "#lib/absent.js";
import {
  collectNestedConnection,
  completeNestedConnections,
  connectionPage,
  overflowingConnectionCount,
} from "../../../../corpus/linear/nested.js";
import {
  ISSUE_ACTIVITY_CONNECTIONS,
  type NestedConnection,
  nestedConnectionQuery,
} from "../../../../corpus/linear/queries.js";
import type { LinearRequest } from "../../../../corpus/linear/transport.js";

/** The registry entry for one connection, by name. */
function conn({ key }: { key: string }) {
  return ISSUE_ACTIVITY_CONNECTIONS.find((entry) => entry.key === key)!;
}

describe("connectionPage (pure)", () => {
  it("reads nodes plus the next-page cursor", () => {
    expect(
      connectionPage({
        holder: { comments: { nodes: [{ id: "c1" }], pageInfo: { endCursor: "cur", hasNextPage: true } } },
        key: "comments",
      }),
    ).toEqual({ endCursor: "cur", hasNext: true, nodes: [{ id: "c1" }] });
  });

  it("treats an absent or malformed connection as an empty TERMINAL page", () => {
    expect(connectionPage({ holder: {}, key: "comments" })).toEqual({ hasNext: false, nodes: [] });
    expect(connectionPage({ holder: { comments: "nope" }, key: "comments" })).toEqual({ hasNext: false, nodes: [] });
    expect(connectionPage({ holder: undefined, key: "comments" })).toEqual({ hasNext: false, nodes: [] });
  });

  it("keeps the nodes but reports terminal when pageInfo is missing", () => {
    expect(connectionPage({ holder: { labels: { nodes: [{ name: "bug" }] } }, key: "labels" })).toEqual({
      hasNext: false,
      nodes: [{ name: "bug" }],
    });
  });

  it("drops an empty-string cursor rather than following it", () => {
    const page = connectionPage({
      holder: { comments: { nodes: [], pageInfo: { endCursor: "", hasNextPage: true } } },
      key: "comments",
    });
    expect(page.hasNext).toBe(true);
    expect(page.endCursor).toBeUndefined();
  });
});

describe("collectNestedConnection", () => {
  it("makes NO request when the inline page did not overflow", async () => {
    const calls: string[] = [];
    const call: LinearRequest = async ({ query }) => {
      calls.push(query);
      return {};
    };
    const nodes = await collectNestedConnection({
      call,
      conn: conn({ key: "attachments" }),
      id: "i1",
      inline: { hasNext: false, nodes: [{ id: "c1" }] },
      warnings: [],
    });
    expect(calls).toEqual([]); // the inline page rides the issue query and costs nothing extra
    expect(nodes).toEqual([{ id: "c1" }]);
  });

  it("pages to exhaustion, concatenating in page order", async () => {
    const pages: Record<string, { nodes: readonly unknown[]; next: string | null }> = {
      p1: { next: "p2", nodes: [{ id: "c2" }] },
      p2: { next: null, nodes: [{ id: "c3" }] },
    };
    const seenCursors: (string | undefined)[] = [];
    const call: LinearRequest = async ({ variables }) => {
      const after = typeof variables["after"] === "string" ? variables["after"] : undefined;
      seenCursors.push(after);
      const page = pages[absentAs({ value: after, whenAbsent: "p1" })]!;
      return {
        issue: {
          attachments: { nodes: page.nodes, pageInfo: { endCursor: page.next, hasNextPage: page.next !== null } },
        },
      };
    };
    const nodes = await collectNestedConnection({
      call,
      conn: conn({ key: "attachments" }),
      id: "i1",
      inline: { endCursor: "p1", hasNext: true, nodes: [{ id: "c1" }] },
      warnings: [],
    });
    expect(nodes).toEqual([{ id: "c1" }, { id: "c2" }, { id: "c3" }]);
    expect(seenCursors).toEqual(["p1", "p2"]);
  });

  it("treats hasNext with NO cursor as terminal rather than requesting page one forever", async () => {
    const calls: string[] = [];
    const call: LinearRequest = async ({ query }) => {
      calls.push(query);
      return {};
    };
    const nodes = await collectNestedConnection({
      call,
      conn: conn({ key: "history" }),
      id: "i1",
      inline: { hasNext: true, nodes: [{ id: "h1" }] },
      warnings: [],
    });
    expect(calls).toEqual([]);
    expect(nodes).toEqual([{ id: "h1" }]);
  });

  it("asks for the connection it is paging, with includeArchived where the schema allows it", async () => {
    const queries: string[] = [];
    const call: LinearRequest = async ({ query }) => {
      queries.push(query);
      return { issue: { history: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false } } } };
    };
    await collectNestedConnection({
      call,
      conn: conn({ key: "history" }),
      id: "i1",
      inline: { endCursor: "c", hasNext: true, nodes: [] },
      warnings: [],
    });
    expect(queries[0]!).toContain("history(includeArchived: true");

    queries.length = 0;
    const stateCall: LinearRequest = async ({ query }) => {
      queries.push(query);
      return { issue: { stateHistory: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false } } } };
    };
    await collectNestedConnection({
      call: stateCall,
      conn: conn({ key: "stateHistory" }),
      id: "i1",
      inline: { endCursor: "c", hasNext: true, nodes: [] },
      warnings: [],
    });
    // `stateHistory` takes no such argument; passing it fails the whole query rather than one connection.
    expect(queries[0]!.includes("includeArchived")).toBe(false);
  });
});

describe("completeNestedConnections", () => {
  it("returns an entry for EVERY registered connection, even the absent ones", async () => {
    const call: LinearRequest = async () => ({});
    const nested = await completeNestedConnections({ call, id: "i1", node: {}, warnings: [] });
    expect(Object.keys(nested).toSorted()).toEqual(ISSUE_ACTIVITY_CONNECTIONS.map((c) => c.key).toSorted());
    expect(Object.values(nested).every((nodes) => nodes.length === 0)).toBe(true);
  });

  it("pages each overflowing connection independently", async () => {
    const asked: string[] = [];
    const call: LinearRequest = async ({ query }) => {
      const key = /\w+\(id: \$id\) \{\s+(\w+)\(/.exec(query)![1]!;
      asked.push(key);
      return { issue: { [key]: { nodes: [{ paged: key }], pageInfo: { endCursor: null, hasNextPage: false } } } };
    };
    const nested = await completeNestedConnections({
      call,
      id: "i1",
      node: {
        attachments: { nodes: [{ id: "a1" }], pageInfo: { endCursor: "a", hasNextPage: true } },
        stateHistory: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false } },
        subscribers: { nodes: [{ id: "u1" }], pageInfo: { endCursor: "b", hasNextPage: true } },
      },
      warnings: [],
    });
    expect(asked.toSorted()).toEqual(["attachments", "subscribers"]);
    expect(nested["attachments"]).toEqual([{ id: "a1" }, { paged: "attachments" }]);
    expect(nested["subscribers"]).toEqual([{ id: "u1" }, { paged: "subscribers" }]);
    expect(nested["stateHistory"]).toEqual([]);
  });
});

describe("overflowingConnectionCount (pure)", () => {
  it("counts the connections that reported another page — the honest extra-request count", () => {
    expect(
      overflowingConnectionCount({
        node: {
          attachments: { nodes: [], pageInfo: { endCursor: "a", hasNextPage: true } },
          history: { nodes: [], pageInfo: { endCursor: "b", hasNextPage: true } },
          subscribers: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false } },
        },
      }),
    ).toBe(2);
  });

  it("is zero for an issue whose every connection fitted", () => {
    expect(overflowingConnectionCount({ node: { attachments: { nodes: [{ id: "a1" }] } } })).toBe(0);
  });
});

describe("a connection's inline page and its follow-up must be the SAME connection", () => {
  // The defect this pins was found by review and is worse than truncation: `Initiative.projects` selected
  // `includeSubInitiatives: true` inline while the generic follow-up emitted only `includeArchived`/`first`/
  // `after`, so page two queried the direct-projects connection using a cursor minted by the wider one. Both
  // argument lists now come from the descriptor, and these assertions are what keep them there.
  it("carries an extra argument into the follow-up query", () => {
    // The registry holds no extra-argument connection today — `Initiative.projects` was the only one, and
    // that connection is now a local join over the root `initiativeToProjects` edges. The mechanism is still
    // the one that keeps an inline page and its continuation the SAME connection, so it is exercised against
    // a constructed descriptor rather than deleted with the last real user of it.
    const withExtra: NestedConnection = {
      acceptsIncludeArchived: true,
      extraArgs: "includeSubIssues: true",
      fields: `id`,
      key: "children",
      pageSize: 10,
    };

    expect(nestedConnectionQuery({ conn: withExtra }).includes("includeSubIssues: true")).toBe(true);
  });

  it("holds no extra-argument connection in the live registry, so nothing can drift apart unnoticed", () => {
    expect(ISSUE_ACTIVITY_CONNECTIONS.filter((candidate) => candidate.extraArgs !== undefined)).toEqual([]);
  });
});

describe("collectNestedConnection when the endpoint gives no cursor", () => {
  // Linear's Relay pageInfo can say `hasNextPage: true` with a null `endCursor`. Cursor logic cannot follow
  // that — there is nothing to advance to — so the only honest response is to SAY the read is short. Returning
  // the prefix silently is the defect this module was rewritten for, wearing a different hat.
  it("warns by name rather than returning the prefix silently", async () => {
    const calls: string[] = [];
    const call: LinearRequest = async ({ query }) => {
      calls.push(query);
      return {};
    };
    const warnings: string[] = [];
    const nodes = await collectNestedConnection({
      call,
      conn: conn({ key: "attachments" }),
      id: "i1",
      inline: { hasNext: true, nodes: [{ id: "c1" }] },
      warnings,
    });
    expect(nodes).toEqual([{ id: "c1" }]);
    expect(calls).toEqual([]); // there is no cursor to ask with, so no request is made
    expect(warnings).toEqual([
      "linear issue i1 attachments is incomplete: the endpoint reported another page but gave no cursor to reach it",
    ]);
  });

  it("stays silent when the inline page simply did not overflow", async () => {
    const call: LinearRequest = async () => ({});
    const warnings: string[] = [];
    await collectNestedConnection({
      call,
      conn: conn({ key: "attachments" }),
      id: "i1",
      inline: { hasNext: false, nodes: [{ id: "c1" }] },
      warnings,
    });
    expect(warnings).toEqual([]);
  });
});
