import { describe, expect, it } from "vitest";

import {
  currentMatches,
  type LinearQueryFilter,
  linearQueryHit,
  matchesLinearQuery,
  noteNewestCapture,
  rankLinearMatches,
} from "../../../../corpus/linear/query.js";
import type { CorpusAttributeValue, CorpusKind, CorpusRecord } from "../../../../corpus/types.js";

const issue = ({
  sourceId = "ENG-1",
  tsIso = "2026-09-01T00:00:00.000Z",
  title = "ENG-1 Fix the pool",
  attrs = {},
  kind = "issue" as const,
  text = "body",
}: {
  sourceId?: string;
  tsIso?: string;
  title?: string;
  attrs?: Record<string, CorpusAttributeValue>;
  kind?: CorpusKind;
  text?: string;
} = {}): CorpusRecord => ({
  attrs,
  container: "linear/ENG",
  kind,
  refs: [],
  source: "linear",
  sourceId,
  text,
  title,
  tsIso,
  url: `https://linear.app/acme/issue/${sourceId}`,
});

const ISSUE_FILTER: LinearQueryFilter = { kind: "issue" };

describe("matchesLinearQuery", () => {
  it("keeps a Linear issue when every constrained facet agrees", () => {
    const record = issue({
      attrs: {
        assignee: "kim.lee",
        cycleNumber: 134,
        labels: ["/ship", "backend"],
        priority: 2,
        state: "In Review",
        stateType: "started",
        team: "ENG",
      },
    });
    expect(
      matchesLinearQuery({
        filter: {
          assignee: "kim.lee",
          cycle: 134,
          kind: "issue",
          labels: ["/ship", "backend"],
          priority: 2,
          state: "In Review",
          stateType: "started",
          team: "ENG",
        },
        record,
      }),
    ).toBe(true);
  });

  it("rejects a record from another source even when every facet agrees", () => {
    const record = { ...issue({ attrs: { assignee: "kim.lee" } }), source: "github" as const };
    expect(matchesLinearQuery({ filter: { assignee: "kim.lee", kind: "issue" }, record })).toBe(false);
  });

  it("rejects a Linear record of a different kind", () => {
    expect(matchesLinearQuery({ filter: ISSUE_FILTER, record: issue({ kind: "comment" }) })).toBe(false);
  });

  it("matches an open-set facet case-insensitively", () => {
    const record = issue({ attrs: { state: "In Review" } });
    expect(matchesLinearQuery({ filter: { kind: "issue", state: "in review" }, record })).toBe(true);
  });

  it("matches an open-set facet WHOLE, never as a prefix", () => {
    const record = issue({ attrs: { team: "INS" } });
    expect(matchesLinearQuery({ filter: { kind: "issue", team: "IN" }, record })).toBe(false);
  });

  it("requires EVERY label, not any of them", () => {
    const record = issue({ attrs: { labels: ["/ship"] } });
    expect(matchesLinearQuery({ filter: { kind: "issue", labels: ["/ship", "backend"] }, record })).toBe(false);
  });

  it("rejects an issue whose facet is absent when that facet is constrained", () => {
    expect(matchesLinearQuery({ filter: { assignee: "kim.lee", kind: "issue" }, record: issue() })).toBe(false);
  });

  it("keeps an issue on or after the --updated-since boundary and drops one before it", () => {
    const boundary = "2026-09-01T00:00:00.000Z";
    expect(
      matchesLinearQuery({ filter: { kind: "issue", updatedSinceIso: boundary }, record: issue({ tsIso: boundary }) }),
    ).toBe(true);
    expect(
      matchesLinearQuery({
        filter: { kind: "issue", updatedSinceIso: boundary },
        record: issue({ tsIso: "2026-08-31T23:59:59.999Z" }),
      }),
    ).toBe(false);
  });

  it("matches --text as a substring of the title or the body, case-insensitively", () => {
    expect(matchesLinearQuery({ filter: { kind: "issue", text: "POOL" }, record: issue() })).toBe(true);
    expect(matchesLinearQuery({ filter: { kind: "issue", text: "unrelated" }, record: issue() })).toBe(false);
  });

  it("reads a project's OWNER off `lead` and its team off the `teams` list", () => {
    const project = issue({
      attrs: { lead: "kim.lee", teams: ["ENG", "INS"] },
      kind: "project",
      sourceId: "project:abc",
      title: "Pool rewrite",
    });
    expect(matchesLinearQuery({ filter: { assignee: "kim.lee", kind: "project", team: "INS" }, record: project })).toBe(
      true,
    );
    expect(matchesLinearQuery({ filter: { assignee: "kim.lee", kind: "project", team: "OPS" }, record: project })).toBe(
      false,
    );
  });

  it("matches a project's --project facet against its own title", () => {
    const project = issue({ kind: "project", sourceId: "project:abc", title: "Pool rewrite" });
    expect(matchesLinearQuery({ filter: { kind: "project", project: "pool rewrite" }, record: project })).toBe(true);
  });

  it("matches --project on the project's id, which a second project sharing the title does not carry", () => {
    const ours = issue({ attrs: { project: "Pool rewrite", projectId: "p-1" } });
    const theirs = issue({ attrs: { project: "Pool rewrite", projectId: "p-2" } });
    expect(matchesLinearQuery({ filter: { kind: "issue", project: "p-1" }, record: ours })).toBe(true);
    expect(matchesLinearQuery({ filter: { kind: "issue", project: "p-1" }, record: theirs })).toBe(false);
  });

  it("matches a project record's --project facet on its own id", () => {
    const project = issue({ kind: "project", sourceId: "project:abc", title: "Pool rewrite" });
    expect(matchesLinearQuery({ filter: { kind: "project", project: "abc" }, record: project })).toBe(true);
  });
});

describe("currentMatches", () => {
  /** The per-identity newest instant over every row given, the way the scan folds it. */
  const newestOf = ({ records }: { records: readonly CorpusRecord[] }): Map<string, string> => {
    const newest = new Map<string, string>();
    for (const record of records) {
      noteNewestCapture({ kind: "issue", newest, record });
    }
    return newest;
  };

  // The defect: an issue that LEFT a project still answered `--project` through its old capture, because the
  // newer capture that stopped matching was never retained for the collapse to see.
  it("drops a match whose object has a newer capture that no longer matches", () => {
    const old = issue({ attrs: { project: "Pool rewrite" }, tsIso: "2026-09-01T00:00:00.000Z" });
    const moved = issue({ attrs: { project: "Elsewhere" }, tsIso: "2026-09-02T00:00:00.000Z" });
    const matched = [old, moved].filter((record) =>
      matchesLinearQuery({ filter: { kind: "issue", project: "Pool rewrite" }, record }),
    );
    expect(matched.length).toBe(1);
    expect(currentMatches({ newest: newestOf({ records: [old, moved] }), records: matched })).toEqual([]);
  });

  it("keeps a match that is its object's newest capture", () => {
    const old = issue({ attrs: { project: "Elsewhere" }, tsIso: "2026-09-01T00:00:00.000Z" });
    const now = issue({ attrs: { project: "Pool rewrite" }, tsIso: "2026-09-02T00:00:00.000Z" });
    expect(currentMatches({ newest: newestOf({ records: [old, now] }), records: [now] })).toEqual([now]);
  });

  it("folds only rows of the queried kind into the newest instant", () => {
    const newest = newestOf({
      records: [issue({ kind: "comment", sourceId: "ENG-1", tsIso: "2026-09-09T00:00:00.000Z" })],
    });
    expect(newest.size).toBe(0);
  });
});

describe("linearQueryHit", () => {
  it("strips the identifier prefix the bronze projection puts on an issue title", () => {
    const hit = linearQueryHit({ kind: "issue", record: issue({ sourceId: "ENG-1", title: "ENG-1 Fix the pool" }) });
    expect(hit.title).toBe("Fix the pool");
    expect(hit.identifier).toBe("ENG-1");
  });

  it("leaves a title that does not carry the prefix untouched", () => {
    const hit = linearQueryHit({ kind: "issue", record: issue({ sourceId: "ENG-1", title: "Fix the pool" }) });
    expect(hit.title).toBe("Fix the pool");
  });

  it("strips the `project:` prefix off a project identifier", () => {
    const hit = linearQueryHit({
      kind: "project",
      record: issue({ kind: "project", sourceId: "project:abc-123", title: "Pool rewrite" }),
    });
    expect(hit.identifier).toBe("abc-123");
    expect(hit.title).toBe("Pool rewrite");
  });

  it("carries every facet a reader and the verifier both need", () => {
    const hit = linearQueryHit({
      kind: "issue",
      record: issue({
        attrs: {
          assignee: "kim.lee",
          cycleNumber: 134,
          labels: ["/ship"],
          priority: 2,
          project: "Pool rewrite",
          projectId: "p-1",
          state: "In Review",
          stateType: "started",
          team: "ENG",
        },
      }),
    });
    expect(hit.assignee).toBe("kim.lee");
    expect(hit.state).toBe("In Review");
    expect(hit.stateType).toBe("started");
    expect(hit.team).toBe("ENG");
    expect(hit.project).toBe("Pool rewrite");
    expect(hit.projectId).toBe("p-1");
    expect(hit.cycleNumber).toBe(134);
    expect(hit.priority).toBe(2);
    expect(hit.labels).toEqual(["/ship"]);
  });
});

describe("rankLinearMatches", () => {
  it("collapses a superseded capture of the same issue and counts the survivors once", () => {
    const ranked = rankLinearMatches({
      kind: "issue",
      limit: 10,
      records: [
        issue({ attrs: { state: "Todo" }, sourceId: "ENG-1", tsIso: "2026-09-01T00:00:00.000Z" }),
        issue({ attrs: { state: "Done" }, sourceId: "ENG-1", tsIso: "2026-09-02T00:00:00.000Z" }),
      ],
    });
    expect(ranked.matched).toBe(1);
    expect(ranked.hits.length).toBe(1);
    expect(ranked.hits[0]!.state).toBe("Done");
  });

  it("ranks newest first and pages without changing the match total", () => {
    const ranked = rankLinearMatches({
      kind: "issue",
      limit: 2,
      records: [
        issue({ sourceId: "ENG-1", tsIso: "2026-09-01T00:00:00.000Z" }),
        issue({ sourceId: "ENG-2", tsIso: "2026-09-03T00:00:00.000Z" }),
        issue({ sourceId: "ENG-3", tsIso: "2026-09-02T00:00:00.000Z" }),
      ],
    });
    expect(ranked.matched).toBe(3);
    expect(ranked.hits.map((hit) => hit.identifier)).toEqual(["ENG-2", "ENG-3"]);
  });

  it("returns an empty page and a zero total for no matches", () => {
    const ranked = rankLinearMatches({ kind: "issue", limit: 10, records: [] });
    expect(ranked.matched).toBe(0);
    expect(ranked.hits).toEqual([]);
  });
});

describe("a record written without `attrs`, and a filter without `labels`", () => {
  /** The same issue with its `attrs` key removed entirely, as a record written without any would read back. */
  function bare(): CorpusRecord {
    const { attrs: _attrs, ...rest } = issue();
    return rest;
  }

  it("matches an unconstrained filter and fails every constrained facet, exactly as an empty attrs map", () => {
    const filters: readonly LinearQueryFilter[] = [
      ISSUE_FILTER,
      { assignee: "kim.lee", kind: "issue" },
      { kind: "issue", state: "Done" },
      { kind: "issue", team: "ENG" },
      { kind: "issue", project: "Search" },
      { cycle: 1, kind: "issue" },
      { kind: "issue", labels: ["bug"] },
    ];
    expect(filters.length).toBeGreaterThan(0);
    const without = filters.map((filter) => matchesLinearQuery({ filter, record: bare() }));
    const empty = filters.map((filter) => matchesLinearQuery({ filter, record: issue({ attrs: {} }) }));
    expect(without).toEqual([true, false, false, false, false, false, false]);
    expect(without).toEqual(empty);
  });

  it("flattens to a hit whose facets are all absent, exactly as an empty attrs map", () => {
    const hit = linearQueryHit({ kind: "issue", record: bare() });
    expect(hit).toEqual(linearQueryHit({ kind: "issue", record: issue({ attrs: {} }) }));
    expect(hit.assignee).toBeUndefined();
    expect(hit.labels).toEqual([]);
    expect(hit.projectId).toBeUndefined();
  });

  it("treats an absent `labels` facet as unconstrained, exactly as an empty one", () => {
    const record = issue({ attrs: { labels: ["backend"] } });
    expect(matchesLinearQuery({ filter: ISSUE_FILTER, record })).toBe(true);
    expect(matchesLinearQuery({ filter: { kind: "issue", labels: [] }, record })).toBe(true);
    expect(matchesLinearQuery({ filter: { kind: "issue", labels: ["backend"] }, record })).toBe(true);
    expect(matchesLinearQuery({ filter: { kind: "issue", labels: ["frontend"] }, record })).toBe(false);
  });
});
