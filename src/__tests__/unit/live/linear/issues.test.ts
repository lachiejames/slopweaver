import { describe, expect, it } from "vitest";

import { ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { LinearLiveError } from "../../../../live/linear/errors.js";
import {
  issueRowFrom,
  issuesFilterFor,
  issuesPageOf,
  type LinearIssuesSelection,
  readLinearIssues,
} from "../../../../live/linear/issues.js";
import { renderLinearIssuesText } from "../../../../live/linear/issuesRender.js";

const NOW = "2026-10-24T09:00:00.000Z";
const TEAM = { id: "team-sup", key: "SUP", name: "Ops & Access" };
const PROJECT = {
  id: "0f1e2d3c-4b5a-4697-8a1b-2c3d4e5f6a7b",
  name: "Widget rollout",
  url: "https://linear.app/p",
};

/** One issue node as `IssuesDocument` answers it, with only the fields the row reads. */
function node({
  identifier,
  createdAt,
  project = null,
}: {
  identifier: string;
  createdAt: string;
  project?: string | null;
}): Record<string, unknown> {
  return {
    addedToProjectAt: project === null ? null : createdAt,
    archivedAt: null,
    assignee: null,
    canceledAt: null,
    completedAt: null,
    createdAt,
    creator: { id: "me" },
    parent: null,
    cycle: null,
    id: `id-${identifier}`,
    identifier,
    labelIds: ["l-1"],
    project: project === null ? null : { id: project },
    state: { id: "s-1" },
    team: { id: TEAM.id },
    title: `title ${identifier}`,
    url: `https://linear.app/acme/issue/${identifier}`,
  };
}

/** One connection page. */
function page({
  nodes,
  endCursor,
}: {
  nodes: readonly Record<string, unknown>[];
  endCursor?: string;
}): Record<string, unknown> {
  return { issues: { nodes, pageInfo: { endCursor, hasNextPage: endCursor !== undefined } } };
}

type Seen = { query: string; variables: Readonly<Record<string, unknown>> }[];

/** A transport answering the team lookup, the project read, then issue pages from a queue. */
function transport({
  pages,
  seen,
}: {
  pages: Record<string, unknown>[];
  seen: Seen;
}): (args: {
  query: string;
  variables: Readonly<Record<string, unknown>>;
}) => Promise<Result<unknown, LinearLiveError>> {
  return ({ query, variables }) => {
    seen.push({ query, variables });
    if (query.includes("query issues(")) {
      return Promise.resolve(ok(pages.shift()));
    }
    if (query.includes("query project(")) {
      return Promise.resolve(ok({ project: PROJECT }));
    }
    return Promise.resolve(ok({ teams: { nodes: [TEAM] } }));
  };
}

const SELECTION: LinearIssuesSelection = {
  createdSinceIso: undefined,
  creator: "me",
  project: undefined,
  teamKey: "SUP",
};

describe("readLinearIssues", () => {
  it("follows every page under the team and creator filter, and lists oldest first", async () => {
    const seen: Seen = [];
    const result = await readLinearIssues({
      nowIso: () => NOW,
      request: transport({
        pages: [
          page({ endCursor: "c1", nodes: [node({ createdAt: "2026-10-23T08:00:00.000Z", identifier: "SUP-9" })] }),
          page({ nodes: [node({ createdAt: "2026-06-01T08:00:00.000Z", identifier: "SUP-2" })] }),
        ],
        seen,
      }),
      selection: SELECTION,
    });

    const document = unwrap(result);
    expect(document.issues.map((row) => row.identifier)).toEqual(["SUP-2", "SUP-9"]);
    expect(document.team).toEqual(TEAM);
    const issueRequests = seen.filter((request) => request.query.includes("query issues("));
    expect(issueRequests.map((request) => request.variables)).toEqual([
      {
        filter: { creator: { isMe: { eq: true } }, team: { id: { eq: "team-sup" } } },
        first: 50,
        includeArchived: true,
      },
      {
        after: "c1",
        filter: { creator: { isMe: { eq: true } }, team: { id: { eq: "team-sup" } } },
        first: 50,
        includeArchived: true,
      },
    ]);
  });

  it("resolves a project URL to its id before filtering on it", async () => {
    const seen: Seen = [];
    const result = await readLinearIssues({
      nowIso: () => NOW,
      request: transport({ pages: [page({ nodes: [] })], seen }),
      selection: {
        ...SELECTION,
        creator: "any",
        project: `https://linear.app/acme/project/${PROJECT.id}`,
        teamKey: undefined,
      },
    });

    expect(unwrap(result).project).toEqual(PROJECT);
    expect(seen.find((request) => request.query.includes("query project("))!.variables).toEqual({ id: PROJECT.id });
    expect(seen.find((request) => request.query.includes("query issues("))!.variables["filter"]).toEqual({
      project: { id: { eq: PROJECT.id } },
    });
  });

  it("refuses a selection naming neither a team nor a project", async () => {
    const result = await readLinearIssues({
      nowIso: () => NOW,
      request: transport({ pages: [], seen: [] }),
      selection: { ...SELECTION, teamKey: undefined },
    });

    expect(unwrapErr(result).message).toBe("linear issues needs --team, --project, or both");
  });

  it("refuses a page that does not say whether another follows, rather than reading it as the last", async () => {
    const result = await readLinearIssues({
      nowIso: () => NOW,
      request: transport({ pages: [{ issues: { nodes: [], pageInfo: {} } }], seen: [] }),
      selection: SELECTION,
    });

    expect(unwrapErr(result).message).toBe("Linear did not say whether issues has another page");
  });
});

describe("issuesPageOf", () => {
  it("refuses a next page with no cursor", () => {
    const result = issuesPageOf({ value: { issues: { nodes: [], pageInfo: { hasNextPage: true } } } });
    expect(unwrapErr(result).message).toBe("Linear said issues has another page and gave no cursor");
  });
});

describe("issueRowFrom", () => {
  it("reads the project, cycle and creator relations as ids or null", () => {
    const row = unwrap(issueRowFrom({ node: node({ createdAt: NOW, identifier: "RRRR-590", project: "p-1" }) }));
    expect(row).toEqual({
      addedToProjectAt: NOW,
      archivedAt: null,
      assigneeId: null,
      canceledAt: null,
      completedAt: null,
      createdAt: NOW,
      creatorId: "me",
      cycleId: null,
      id: "id-RRRR-590",
      identifier: "RRRR-590",
      labelIds: ["l-1"],
      parentId: null,
      projectId: "p-1",
      stateId: "s-1",
      teamId: "team-sup",
      teamKey: "RRRR",
      title: "title RRRR-590",
      url: "https://linear.app/acme/issue/RRRR-590",
    });
  });

  it("reads the assignee and parent as ids", () => {
    const row = unwrap(
      issueRowFrom({
        node: { ...node({ createdAt: NOW, identifier: "SUP-3" }), assignee: { id: "u-1" }, parent: { id: "i-0" } },
      }),
    );
    expect([row.assigneeId, row.parentId]).toEqual(["u-1", "i-0"]);
  });

  it("refuses an assignee it cannot read rather than reading it as unassigned", () => {
    const absent: Record<string, unknown> = { ...node({ createdAt: NOW, identifier: "SUP-4" }) };
    delete absent["assignee"];
    expect(unwrapErr(issueRowFrom({ node: absent })).message).toBe(
      "Linear returned SUP-4 with an unreadable assignee, parent, project or archivedAt",
    );
    const noId = { ...node({ createdAt: NOW, identifier: "SUP-5" }), parent: { name: "x" } };
    expect(unwrapErr(issueRowFrom({ node: noId })).message).toBe(
      "Linear returned SUP-5 with an unreadable assignee, parent, project or archivedAt",
    );
  });

  it("refuses a project or archivedAt it cannot read rather than reading it as none", () => {
    const projectNoId = { ...node({ createdAt: NOW, identifier: "SUP-6" }), project: { name: "Secret" } };
    expect(unwrapErr(issueRowFrom({ node: projectNoId })).message).toBe(
      "Linear returned SUP-6 with an unreadable assignee, parent, project or archivedAt",
    );
    const archivedAbsent: Record<string, unknown> = { ...node({ createdAt: NOW, identifier: "SUP-7" }) };
    delete archivedAbsent["archivedAt"];
    expect(unwrapErr(issueRowFrom({ node: archivedAbsent })).message).toBe(
      "Linear returned SUP-7 with an unreadable assignee, parent, project or archivedAt",
    );
  });

  it("refuses an issue with no team rather than dropping it from the set", () => {
    const result = issueRowFrom({ node: { ...node({ createdAt: NOW, identifier: "SUP-1" }), team: null } });
    expect(unwrapErr(result).message).toContain("missing its id, identifier, title, url, team");
  });
});

describe("issuesFilterFor", () => {
  it("sends only the clauses a selection names", () => {
    expect(issuesFilterFor({ createdSinceIso: undefined, creator: "any", projectId: undefined, teamId: "t" })).toEqual({
      team: { id: { eq: "t" } },
    });
    expect(issuesFilterFor({ createdSinceIso: NOW, creator: "me", projectId: "p", teamId: undefined })).toEqual({
      createdAt: { gte: NOW },
      creator: { isMe: { eq: true } },
      project: { id: { eq: "p" } },
    });
  });
});

describe("renderLinearIssuesText", () => {
  it("names the scope, the count and each issue with its project", () => {
    const text = renderLinearIssuesText({
      document: {
        createdSinceIso: undefined,
        creator: "me",
        issues: [unwrap(issueRowFrom({ node: node({ createdAt: NOW, identifier: "SUP-9", project: "p-1" }) }))],
        project: undefined,
        readAtIso: NOW,
        source: "linear",
        team: TEAM,
      },
    });
    expect(text).toBe(
      [
        "linear issues: team SUP (team-sup) · filed by the token's own user · archived included",
        `read at: ${NOW}`,
        "issues (1):",
        "  SUP-9  2026-10-24  project p-1  title SUP-9",
      ].join("\n"),
    );
  });
});
