/** The live reads `linear move-issues` plans from, over a plain fake transport. */
import { describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";
import { type LinearLiveError, LinearLiveErrors } from "../../../../live/linear/errors.js";
import {
  identifierNumbersByKey,
  readLinearIssueChildren,
  readLinearIssueMoveInputs,
  readLinearIssuesByIdentifiers,
} from "../../../../live/linear/issueMoveRead.js";

const NOW = "2026-10-24T09:00:00.000Z";

/** One issue node as `IssuesDocument` answers it. */
function issueNode({ identifier, team, parent = null }: { identifier: string; team: string; parent?: string | null }) {
  return {
    addedToProjectAt: null,
    archivedAt: null,
    assignee: null,
    canceledAt: null,
    completedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    creator: { id: "me" },
    cycle: null,
    id: `id-${identifier}`,
    identifier,
    labelIds: [],
    parent: parent === null ? null : { id: parent },
    project: null,
    state: { id: `s-${team}` },
    team: { id: `team-${team}` },
    title: `title ${identifier}`,
    url: `https://linear.app/acme/issue/${identifier}`,
  };
}

/** One issues connection page. */
function issuesPage({ nodes, endCursor }: { nodes: readonly unknown[]; endCursor?: string }) {
  return { issues: { nodes, pageInfo: { endCursor, hasNextPage: endCursor !== undefined } } };
}

type Seen = { query: string; variables: Readonly<Record<string, unknown>> }[];
type Request = (args: {
  query: string;
  variables: Readonly<Record<string, unknown>>;
}) => Promise<Result<unknown, LinearLiveError>>;

/** A transport answering teams, states, members and the viewer by query, and issue pages from a queue. */
function transport({ issuePages, seen }: { issuePages: unknown[]; seen: Seen }): Request {
  return ({ query, variables }) => {
    seen.push({ query, variables });
    if (query.includes("query issues(")) {
      return Promise.resolve(ok(issuePages.shift()));
    }
    if (query.includes("query teams(")) {
      const filter = variables["filter"] as { key: { eq: string } };
      const key = filter.key.eq;
      return Promise.resolve(ok({ teams: { nodes: [{ id: `team-${key}`, key, name: key }] } }));
    }
    if (query.includes("query workflowStates(")) {
      return Promise.resolve(
        ok({
          workflowStates: {
            nodes: [{ id: "s-1", name: "Todo", position: 1, type: "unstarted" }],
            pageInfo: { hasNextPage: false },
          },
        }),
      );
    }
    if (query.includes("query team_members(")) {
      return Promise.resolve(ok({ team: { members: { nodes: [] } } }));
    }
    if (query.includes("query viewer")) {
      return Promise.resolve(ok({ viewer: { id: "me", name: "Me", url: "https://linear.app/me" } }));
    }
    if (query.includes("query LinearOrganization")) {
      return Promise.resolve(ok({ organization: { id: "org-1", urlKey: "acme" } }));
    }
    return Promise.resolve(err(LinearLiveErrors.readFailed({ message: `unexpected query ${query.slice(0, 40)}` })));
  };
}

/** The filters every issues request carried, in order. */
function issueFilters({ seen }: { seen: Seen }): readonly unknown[] {
  return seen.filter((call) => call.query.includes("query issues(")).map((call) => call.variables["filter"]);
}

describe("identifierNumbersByKey", () => {
  it("groups numbers under their team key in caller order", () => {
    const grouped = unwrap(identifierNumbersByKey({ identifiers: ["SUP-9", "SOPS-2", "SUP-3"] }));
    expect([...grouped.entries()]).toEqual([
      ["SUP", [9, 3]],
      ["SOPS", [2]],
    ]);
  });

  it("refuses a string that is not an identifier", () => {
    const error = unwrapErr(identifierNumbersByKey({ identifiers: ["sup-9"] }));
    expect(error.message).toContain("sup-9 is not an issue identifier");
  });
});

describe("readLinearIssuesByIdentifiers", () => {
  it("sends one team-and-number filter per key, archived included, and follows a page cursor", async () => {
    const seen: Seen = [];
    const request = transport({
      issuePages: [
        issuesPage({ endCursor: "c1", nodes: [issueNode({ identifier: "SUP-9", team: "SUP" })] }),
        issuesPage({ nodes: [issueNode({ identifier: "SUP-3", team: "SUP" })] }),
        issuesPage({ nodes: [] }),
      ],
      seen,
    });

    const rows = unwrap(await readLinearIssuesByIdentifiers({ identifiers: ["SUP-9", "SOPS-2", "SUP-3"], request }));

    expect(rows.map((row) => row.identifier)).toEqual(["SUP-9", "SUP-3"]);
    expect(issueFilters({ seen })).toEqual([
      { number: { in: [9, 3] }, team: { key: { eq: "SUP" } } },
      { number: { in: [9, 3] }, team: { key: { eq: "SUP" } } },
      { number: { in: [2] }, team: { key: { eq: "SOPS" } } },
    ]);
    expect(seen[0]!.variables["includeArchived"]).toBe(true);
    expect(seen[1]!.variables["after"]).toBe("c1");
  });

  it("refuses a malformed page rather than returning a short set", async () => {
    const request = transport({ issuePages: [{ issues: "nope" }], seen: [] });
    const error = unwrapErr(await readLinearIssuesByIdentifiers({ identifiers: ["SUP-9"], request }));
    expect(error.code).toBe("READ_FAILED");
  });
});

describe("readLinearIssueChildren", () => {
  it("sends no request for no parents", async () => {
    const seen: Seen = [];
    expect(
      unwrap(await readLinearIssueChildren({ parentIds: [], request: transport({ issuePages: [], seen }) })),
    ).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("filters children by their parent's UUID", async () => {
    const seen: Seen = [];
    const request = transport({
      issuePages: [issuesPage({ nodes: [issueNode({ identifier: "SUP-10", parent: "id-SUP-9", team: "SUP" })] })],
      seen,
    });

    const rows = unwrap(await readLinearIssueChildren({ parentIds: ["id-SUP-9"], request }));

    expect(rows.map((row) => [row.identifier, row.parentId])).toEqual([["SUP-10", "id-SUP-9"]]);
    expect(issueFilters({ seen })).toEqual([{ parent: { id: { in: ["id-SUP-9"] } } }]);
  });
});

describe("readLinearIssueMoveInputs", () => {
  it("reads the destination's states, the issues, their children, the viewer and each source team's states", async () => {
    const seen: Seen = [];
    const request = transport({
      issuePages: [issuesPage({ nodes: [issueNode({ identifier: "SUP-9", team: "SUP" })] }), issuesPage({ nodes: [] })],
      seen,
    });

    const inputs = unwrap(
      await readLinearIssueMoveInputs({
        destinationTeamKey: "SOPS",
        identifiers: ["SUP-9"],
        nowIso: () => NOW,
        request,
      }),
    );

    expect(inputs.destination.team).toEqual({ id: "team-SOPS", key: "SOPS", name: "SOPS" });
    expect(inputs.destination.workspace).toBe("acme");
    expect(inputs.issues.map((row) => row.identifier)).toEqual(["SUP-9"]);
    expect(inputs.children).toEqual([]);
    expect(inputs.viewer.id).toBe("me");
    expect(inputs.sources.map((document) => document.team.key)).toEqual(["SUP"]);
  });

  it("stops at the first failed read", async () => {
    const failing: Request = () => Promise.resolve(err(LinearLiveErrors.readFailed({ message: "transport down" })));
    const error = unwrapErr(
      await readLinearIssueMoveInputs({
        destinationTeamKey: "SOPS",
        identifiers: ["SUP-9"],
        nowIso: () => NOW,
        request: failing,
      }),
    );
    expect(error.message).toBe("transport down");
  });

  it("refuses a destination lookup answered with another team, and reads no issue", async () => {
    const seen: Seen = [];
    const honest = transport({ issuePages: [], seen });
    const wrongTeam: Request = ({ query, variables }) => {
      if (query.includes("query teams(")) {
        seen.push({ query, variables });
        return Promise.resolve(ok({ teams: { nodes: [{ id: "team-OPS", key: "OPS", name: "Operations" }] } }));
      }
      return honest({ query, variables });
    };
    const error = unwrapErr(
      await readLinearIssueMoveInputs({
        destinationTeamKey: "SOPS",
        identifiers: ["SUP-9"],
        nowIso: () => NOW,
        request: wrongTeam,
      }),
    );
    expect(error.message).toBe(
      "Linear answered a lookup for team SOPS with team OPS; refusing to move anything into a team that was not asked for",
    );
    expect(issueFilters({ seen })).toEqual([]);
  });
});
