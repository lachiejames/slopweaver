/**
 * `makeLinearApi`'s issues lane: a page and its joins in a fixed number of requests, whatever the page's size,
 * and the documents that lane sends for what the connector used to lose.
 */
import { describe, expect, it } from "vitest";

import { makeLinearApi } from "../../../../../corpus/linear/fetch.js";
import type { LinearRequest } from "../../../../../corpus/linear/transport.js";
import { conn, issueNode } from "./harness.js";

/** The four documents an issues page sends after the page itself, answered empty unless a test says more. */
function issueJoinReply({ label }: { label: string }): Record<string, unknown> | undefined {
  if (label === "comments") {
    return { comments: conn({ nodes: [] }) };
  }
  if (label === "issueActivity") {
    return { issues: conn({ nodes: [] }) };
  }
  return undefined;
}

/**
 * Which lane a query belongs to — the label a request-count assertion reads.
 *
 * The SDK's own documents name their operation in lower camel case (`query projects(`), and this repo's two
 * remaining companion documents carry a `Slopweaver` prefix. Matching on the operation NAME rather than on a
 * field keeps a companion apart from the SDK document it accompanies, which both select `projects`.
 */
function queryLabel({ query }: { query: string }): string {
  if (query.includes("query SlopweaverIssueActivity")) {
    return "issueActivity";
  }
  if (query.includes("query ParentConnection")) {
    return "nested";
  }
  if (query.includes("query issues(")) {
    return "issues";
  }
  if (query.includes("query SlopweaverProjectConnections")) {
    return "projectConnections";
  }
  if (query.includes("query SlopweaverInitiativeConnections")) {
    return "initiativeConnections";
  }
  if (query.includes("query projectUpdates(")) {
    return "projectUpdates";
  }
  if (query.includes("query comments(")) {
    return "comments";
  }
  if (query.includes("query initiatives(")) {
    return "initiatives";
  }
  return "projects";
}

/** A fake GraphQL transport: records every request, returns fixture data per query. */
function fakeRequest({
  calls,
  issueNodes,
  nestedNodes = [],
}: {
  calls: string[];
  issueNodes: readonly Record<string, unknown>[];
  /** The nodes a follow-up nested-connection request returns (one page, then terminal). */
  nestedNodes?: readonly unknown[];
}): LinearRequest {
  let issuePages = 0;
  return async ({ query }) => {
    const label = queryLabel({ query });
    calls.push(label);
    if (label === "issues") {
      // The SAME document fetches the page and then its children, so the fake answers the page once and
      // every later ask with nothing — which is what a page whose issues have no children looks like.
      issuePages += 1;
      return { issues: conn({ nodes: issuePages === 1 ? issueNodes : [] }) };
    }
    if (label === "issueActivity") {
      return { issues: conn({ nodes: issueNodes.map((node) => ({ id: node["id"] })) }) };
    }
    if (label === "nested") {
      // Whichever connection asked, hand back one page then stop. The key is derived from the query text so
      // the fake stays honest about which connection it is answering.
      const key = /\w+\(id: \$id\) \{\s+(\w+)\(/.exec(query)?.[1];
      if (key === undefined) {
        throw new Error(`a follow-up whose connection this fake cannot read: ${query.slice(0, 120)}`);
      }
      return { issue: { [key]: conn({ nodes: nestedNodes }) } };
    }
    // A lane this fake scripts no reply for gets an EMPTY projects page — the shape every unscripted lane in
    // these cases asks for, so an unexpected request shows up as a lane with no rows rather than as a throw.
    const scripted = issueJoinReply({ label });
    if (scripted !== undefined) {
      return scripted;
    }
    return { projects: conn({ nodes: [] }) };
  };
}

describe("makeLinearApi keeps the issue crawl per-PAGE, never per-issue", () => {
  /**
   * FOUR requests per page, and that is the shape the move onto `@linear/sdk` bought: the page itself, its
   * comments, its children (the same document again, filtered by `parent.id.in`) and the activity companion.
   * None of them scales with the number of ISSUES on the page — a per-issue fetch is what this connector
   * exists to refuse, and the old inline query bought its single request by carrying nine nested connections
   * the SDK's `Issue` fragment simply does not have.
   */
  it("fetches a page of N issues and their joins in a FIXED number of requests", async () => {
    const calls: string[] = [];
    const nodes = [issueNode({ id: "ENG-1" }), issueNode({ id: "ENG-2" }), issueNode({ id: "ENG-3" })];
    const api = makeLinearApi({ request: fakeRequest({ calls, issueNodes: nodes }) });
    const page = await api.issues({ since: "2026-01-01" });

    expect(page.issues.map((issue) => issue.identifier)).toEqual(["ENG-1", "ENG-2", "ENG-3"]);
    expect(calls).toEqual(["issues", "comments", "issues", "issueActivity"]);
  });

  it("joins each issue's comments off the ROOT walk, by the issueId the fragment carries", async () => {
    const calls: string[] = [];
    const nodes = [issueNode({ id: "ENG-1" }), issueNode({ id: "ENG-2" })];
    const request: LinearRequest = async ({ query, variables }) => {
      const label = queryLabel({ query });
      calls.push(label);
      if (label === "comments") {
        expect(variables["filter"]).toEqual({ issue: { id: { in: ["ENG-1", "ENG-2"] } } });
        return {
          comments: conn({
            nodes: [
              { body: "hi", createdAt: "2026-05-02T00:00:00.000Z", id: "c1", issueId: "ENG-1", url: "u" },
              { body: "later", createdAt: "2026-05-03T00:00:00.000Z", id: "c2", issueId: "ENG-1", url: "u" },
              { body: "other", createdAt: "2026-05-03T00:00:00.000Z", id: "c3", issueId: "ENG-2", url: "u" },
            ],
          }),
        };
      }
      if (label === "issueActivity") {
        return { issues: conn({ nodes: [] }) };
      }
      return { issues: conn({ nodes: calls.filter((call) => call === "issues").length === 1 ? nodes : [] }) };
    };
    const page = await makeLinearApi({ request }).issues({ since: "2026-01-01" });

    expect(page.issues.find((issue) => issue.identifier === "ENG-1")!.comments.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(page.issues.find((issue) => issue.identifier === "ENG-2")!.comments.map((c) => c.id)).toEqual(["c3"]);
  });

  it("pages an ACTIVITY connection that overflowed, and only that one", async () => {
    // Before the generalised collector this was ZERO: only `comments` had a paging loop, and everything else
    // was silently truncated at its inline cap.
    const calls: string[] = [];
    const request: LinearRequest = async ({ query }) => {
      const label = queryLabel({ query });
      calls.push(label);
      if (label === "comments") {
        return { comments: conn({ nodes: [] }) };
      }
      if (label === "issueActivity") {
        return {
          issues: conn({
            nodes: [
              {
                attachments: conn({ hasNext: true, nodes: [{ id: "a1", title: "Spec", url: "https://example/s" }] }),
                id: "ENG-1",
                subscribers: conn({ nodes: [] }),
              },
            ],
          }),
        };
      }
      if (label === "nested") {
        return { issue: { attachments: conn({ nodes: [{ id: "a2", title: "Second", url: "https://example/2" }] }) } };
      }
      const firstPage = calls.filter((call) => call === "issues").length === 1;
      return { issues: conn({ nodes: firstPage ? [issueNode({ id: "ENG-1" })] : [] }) };
    };
    const page = await makeLinearApi({ request }).issues({ since: "2026-01-01" });

    expect(calls.filter((call) => call === "nested").length).toBe(1);
    // Sorted, because `./curated.ts` dedupes and sorts an issue's attachment refs.
    expect(page.issues[0]!.attachments).toEqual(["Second (https://example/2)", "Spec (https://example/s)"]);
  });

  it("treats `hasNextPage` with a NULL cursor as terminal rather than spinning", async () => {
    // Following a null cursor re-serves page one forever — which under the integration lane's lenient
    // method+path replay is a genuine infinite loop, not a hypothetical one.
    const calls: string[] = [];
    const request: LinearRequest = async ({ query }) => {
      const label = queryLabel({ query });
      calls.push(label);
      if (label === "comments") {
        return { comments: conn({ nodes: [] }) };
      }
      if (label === "issueActivity") {
        return {
          issues: conn({
            nodes: [{ attachments: { nodes: [], pageInfo: { endCursor: null, hasNextPage: true } }, id: "ENG-1" }],
          }),
        };
      }
      const firstPage = calls.filter((call) => call === "issues").length === 1;
      return { issues: conn({ nodes: firstPage ? [issueNode({ id: "ENG-1" })] : [] }) };
    };
    const page = await makeLinearApi({ request }).issues({ since: "2026-01-01" });

    expect(calls.filter((call) => call === "nested").length).toBe(0);
    expect(page.issues[0]!.attachments).toBe(undefined);
  });
});

describe("the issues lane asks for what the connector used to lose", () => {
  /** Every document one issues page sends, in order, against a transport that answers every lane empty. */
  async function issuesPageQueries(): Promise<readonly string[]> {
    const queries: string[] = [];
    const request: LinearRequest = async ({ query }) => {
      queries.push(query);
      const label = queryLabel({ query });
      if (label === "comments") {
        return { comments: conn({ nodes: [] }) };
      }
      if (label === "issueActivity") {
        return { issues: conn({ nodes: [] }) };
      }
      // The page has to carry an issue, or none of the join documents is sent at all.
      const firstPage = queries.filter((sent) => queryLabel({ query: sent }) === "issues").length === 1;
      return { issues: conn({ nodes: firstPage ? [issueNode({ id: "ENG-1" })] : [] }) };
    };
    await makeLinearApi({ request }).issues({ since: "2026-01-01" });
    return queries;
  }

  it("sends includeArchived on the root issues lane", async () => {
    // Without this argument a quarter's control window of hundreds of issues showed only a fraction of them.
    const [first] = await issuesPageQueries();
    expect(first).toContain("query issues(");
    expect(first).toContain("includeArchived: $includeArchived");
  });

  it("asks the ACTIVITY companion for both history streams and the two connections with no root", async () => {
    const activity = (await issuesPageQueries()).find((query) => query.includes("SlopweaverIssueActivity"))!;

    expect(activity).toContain("history(");
    expect(activity).toContain("stateHistory(");
    expect(activity).toContain("subscribers(");
    expect(activity).toContain("attachments(");
  });

  it("does NOT pass includeArchived to stateHistory, which the schema rejects it on", async () => {
    // Verified by introspecting the argument list: `stateHistory` takes before/after/first/last only, and
    // passing includeArchived is a validation error that fails the WHOLE page rather than one connection.
    const activity = (await issuesPageQueries()).find((query) => query.includes("SlopweaverIssueActivity"))!;
    const stateHistory = /stateHistory\([^)]*\)/.exec(activity)![0];

    expect(stateHistory.includes("includeArchived")).toBe(false);
  });

  it("reads an issue's comments and children from the ROOT, filtered to the page in hand", async () => {
    const queries = await issuesPageQueries();

    expect(queries.some((query) => query.includes("query comments("))).toBe(true);
    // Children are issues, so they come back through the SAME document the page itself was fetched with.
    expect(queries.filter((query) => query.includes("query issues(")).length).toBe(2);
  });
});
