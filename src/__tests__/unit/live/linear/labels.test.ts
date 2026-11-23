import { describe, expect, it } from "vitest";

import { ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { LinearLiveError } from "../../../../live/linear/errors.js";
import {
  nameParentsAndSort,
  readLinearLabels,
  renderLinearLabelsJson,
  renderLinearLabelsText,
} from "../../../../live/linear/labels.js";

const NOW = "2026-10-24T09:00:00.000Z";
const TEAM = { id: "team-uuid", key: "SOPS", name: "Security" };
const APPLICABLE = { or: [{ team: { null: true } }, { team: { id: { in: ["team-uuid"] } } }] };

/** One connection page, the shape both label documents answer in. */
function page({
  nodes,
  endCursor,
}: {
  nodes: readonly Record<string, unknown>[];
  endCursor?: string;
}): Record<string, unknown> {
  return { nodes, pageInfo: { endCursor, hasNextPage: endCursor !== undefined } };
}

/**
 * A transport answering the team lookup, then each label document from a queue of pages, and recording
 * every request's variables in the order they were sent.
 */
function labelTransport({
  issuePages,
  projectPages,
  seen,
  parents = {},
}: {
  issuePages: Record<string, unknown>[];
  projectPages: Record<string, unknown>[];
  seen: { query: string; variables: Readonly<Record<string, unknown>> }[];
  /** Each team id's parent as Linear answers it; a team absent here is a root. */
  parents?: Readonly<Record<string, unknown>>;
}): (args: {
  query: string;
  variables: Readonly<Record<string, unknown>>;
}) => Promise<Result<unknown, LinearLiveError>> {
  return ({ query, variables }) => {
    seen.push({ query, variables });
    if (query.includes("query team(")) {
      const id = String(variables["id"]);
      const parent = id in parents ? parents[id] : null;
      return Promise.resolve(ok({ team: { id, parent } }));
    }
    if (query.includes("query issueLabels")) {
      return Promise.resolve(ok({ issueLabels: issuePages.shift() }));
    }
    if (query.includes("query projectLabels")) {
      return Promise.resolve(ok({ projectLabels: projectPages.shift() }));
    }
    return Promise.resolve(ok({ teams: { nodes: [TEAM] } }));
  };
}

describe("readLinearLabels", () => {
  it("asks both vocabularies for the team's own labels AND the workspace's, and follows every page", async () => {
    const seen: { query: string; variables: Readonly<Record<string, unknown>> }[] = [];
    const result = await readLinearLabels({
      nowIso: () => NOW,
      request: labelTransport({
        issuePages: [
          page({ endCursor: "c1", nodes: [{ id: "i-2", name: "Security", team: null }] }),
          page({ nodes: [{ id: "i-1", name: "Can drive", team: { id: "team-uuid" } }] }),
        ],
        projectPages: [page({ nodes: [{ id: "p-1", name: "Audit", team: null }] })],
        seen,
      }),
      teamKey: "SOPS",
    });

    expect(seen.map((request) => request.variables)).toEqual([
      { filter: { key: { eq: "SOPS" } }, first: 2, includeArchived: true },
      { id: "team-uuid" },
      { filter: APPLICABLE, first: 250 },
      { after: "c1", filter: APPLICABLE, first: 250 },
      { filter: APPLICABLE, first: 250 },
    ]);
    expect(unwrap(result)).toEqual({
      issueLabels: [
        { id: "i-2", isGroup: false, name: "Security", parent: undefined, scope: { kind: "workspace" } },
        {
          id: "i-1",
          isGroup: false,
          name: "Can drive",
          parent: undefined,
          scope: { kind: "team", teamId: "team-uuid" },
        },
      ],
      projectLabels: [{ id: "p-1", isGroup: false, name: "Audit", parent: undefined, scope: { kind: "workspace" } }],
      readAtIso: NOW,
      source: "linear",
      team: TEAM,
    });
  });

  it("asks for every ancestor team's labels too, because a sub-team inherits them", async () => {
    const seen: { query: string; variables: Readonly<Record<string, unknown>> }[] = [];
    const result = await readLinearLabels({
      nowIso: () => NOW,
      request: labelTransport({
        issuePages: [page({ nodes: [{ id: "i-9", name: "Platform", team: { id: "parent-uuid" } }] })],
        parents: { "parent-uuid": { id: "root-uuid" }, "team-uuid": { id: "parent-uuid" } },
        projectPages: [page({ nodes: [] })],
        seen,
      }),
      teamKey: "SOPS",
    });
    const lineage = {
      or: [{ team: { null: true } }, { team: { id: { in: ["team-uuid", "parent-uuid", "root-uuid"] } } }],
    };

    expect(seen.map((request) => request.variables)).toEqual([
      { filter: { key: { eq: "SOPS" } }, first: 2, includeArchived: true },
      { id: "team-uuid" },
      { id: "parent-uuid" },
      { id: "root-uuid" },
      { filter: lineage, first: 250 },
      { filter: lineage, first: 250 },
    ]);
    expect(renderLinearLabelsText({ document: unwrap(result) })).toContain("  i-9  inherited  Platform");
  });

  it("refuses a team whose parent Linear did not report, rather than reading it as a root", async () => {
    const result = await readLinearLabels({
      nowIso: () => NOW,
      request: labelTransport({
        issuePages: [],
        parents: { "team-uuid": { name: "no id" } },
        projectPages: [],
        seen: [],
      }),
      teamKey: "SOPS",
    });

    expect(unwrapErr(result).message).toBe("Linear returned an unreadable parent for team team-uuid");
  });

  it("refuses a parent chain that loops back on itself", async () => {
    const result = await readLinearLabels({
      nowIso: () => NOW,
      request: labelTransport({
        issuePages: [],
        parents: { "parent-uuid": { id: "team-uuid" }, "team-uuid": { id: "parent-uuid" } },
        projectPages: [],
        seen: [],
      }),
      teamKey: "SOPS",
    });

    expect(unwrapErr(result).message).toBe("Linear returned an unreadable parent for team parent-uuid");
  });

  it("refuses a page that says there is more and gives no cursor, rather than returning what it has", async () => {
    const result = await readLinearLabels({
      nowIso: () => NOW,
      request: labelTransport({
        issuePages: [{ nodes: [{ id: "i-1", name: "Can drive" }], pageInfo: { hasNextPage: true } }],
        projectPages: [],
        seen: [],
      }),
      teamKey: "SOPS",
    });

    expect(unwrapErr(result).message).toBe("Linear said issueLabels has another page and gave no cursor");
  });

  it("refuses a page with no pageInfo, rather than reading it as the last page", async () => {
    const result = await readLinearLabels({
      nowIso: () => NOW,
      request: labelTransport({
        issuePages: [{ nodes: [{ id: "i-1", name: "Can drive" }] }],
        projectPages: [page({ nodes: [] })],
        seen: [],
      }),
      teamKey: "SOPS",
    });

    expect(unwrapErr(result).message).toBe("Linear did not say whether issueLabels has another page");
  });

  it("refuses a page carrying a label with no name, rather than showing the rest as the whole set", async () => {
    const result = await readLinearLabels({
      nowIso: () => NOW,
      request: labelTransport({
        issuePages: [page({ nodes: [{ id: "i-1", name: "Can drive" }, { id: "i-2" }] })],
        projectPages: [page({ nodes: [] })],
        seen: [],
      }),
      teamKey: "SOPS",
    });

    expect(unwrapErr(result).message).toBe("Linear returned a label in issueLabels with no id or name");
  });

  it("refuses a vocabulary that is still going after twenty pages, rather than showing it incomplete", async () => {
    const endless = Array.from({ length: 21 }, (_, index) =>
      page({ endCursor: `c${String(index)}`, nodes: [{ id: `i-${String(index)}`, name: `L${String(index)}` }] }),
    );
    const result = await readLinearLabels({
      nowIso: () => NOW,
      request: labelTransport({ issuePages: endless, projectPages: [], seen: [] }),
      teamKey: "SOPS",
    });

    expect(unwrapErr(result).message).toBe(
      "issueLabels still had more after 5000 labels; refused rather than shown incomplete",
    );
  });

  it("refuses a response with no connection at all", async () => {
    const result = await readLinearLabels({
      nowIso: () => NOW,
      request: labelTransport({ issuePages: [], projectPages: [], seen: [] }),
      teamKey: "SOPS",
    });

    expect(unwrapErr(result).message).toBe("Linear returned no issueLabels connection");
  });
});

describe("nameParentsAndSort", () => {
  it("names a parent from the same set, keeps an unnamed one by id, and puts workspace labels first", () => {
    const sorted = nameParentsAndSort({
      raw: [
        { id: "b", isGroup: false, name: "Can drive", parentId: "g", scope: { kind: "team", teamId: "t" } },
        { id: "g", isGroup: true, name: "Bucket", parentId: undefined, scope: { kind: "team", teamId: "t" } },
        { id: "z", isGroup: false, name: "Audit", parentId: "outside", scope: { kind: "workspace" } },
      ],
    });

    expect(sorted.map((label) => [label.id, label.parent])).toEqual([
      ["z", { id: "outside", name: undefined }],
      ["g", undefined],
      ["b", { id: "g", name: "Bucket" }],
    ]);
  });

  it("returns an empty list for an empty vocabulary", () => {
    expect(nameParentsAndSort({ raw: [] })).toEqual([]);
  });
});

describe("renderLinearLabelsText", () => {
  it("prints every id in full beside its scope, name and group", () => {
    const text = renderLinearLabelsText({
      document: {
        issueLabels: [
          { id: "g-1", isGroup: true, name: "Bucket", parent: undefined, scope: { kind: "team", teamId: "team-uuid" } },
          {
            id: "i-1",
            isGroup: false,
            name: "Can drive",
            parent: { id: "g-1", name: "Bucket" },
            scope: { kind: "team", teamId: "team-uuid" },
          },
        ],
        projectLabels: [],
        readAtIso: NOW,
        source: "linear",
        team: TEAM,
      },
    });

    expect(text).toBe(
      [
        "linear labels: SOPS — Security (team-uuid)",
        `read at: ${NOW}`,
        "issue labels (2):",
        "  g-1  team       Bucket  [group]",
        "  i-1  team       Can drive  (in Bucket)",
        "project labels (0):",
      ].join("\n"),
    );
  });
});

describe("renderLinearLabelsJson", () => {
  it("round-trips the document unchanged", () => {
    const document = {
      issueLabels: [],
      projectLabels: [
        { id: "p-1", isGroup: false, name: "Audit", parent: undefined, scope: { kind: "workspace" as const } },
      ],
      readAtIso: NOW,
      source: "linear" as const,
      team: TEAM,
    };

    expect(JSON.parse(renderLinearLabelsJson({ document }))).toEqual({
      ...document,
      projectLabels: [{ id: "p-1", isGroup: false, name: "Audit", scope: { kind: "workspace" } }],
    });
  });
});
