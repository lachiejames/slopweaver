import { describe, expect, it } from "vitest";
import type { GithubActivity } from "../../../../corpus/github/activity.js";
import { type GithubExportItem, projectGithubRecords } from "../../../../corpus/github/project.js";
import { CAPTURE_ATTR } from "../../../../corpus/types.js";

const rawPr = {
  body: "closes #7",
  html_url: "pr-url",
  number: 42,
  rawMarker: "github-pr",
  title: "Add thing",
  updated_at: "2024-01-29T00:00:00Z",
};
const rawReview = { body: "lgtm", rawMarker: "github-review", state: "APPROVED" };
const rawComment = { body: "nice work", rawMarker: "github-comment" };
const rawState = { __typename: "MergedEvent", rawMarker: "github-state" };

const activity: GithubActivity = {
  checks: "SUCCESS",
  comments: [
    { author: "c1", body: "nice work", raw: rawComment, tsIso: "2024-01-30T00:00:00Z", url: "c-url" },
    { author: "c2", body: "", resolved: true, tsIso: "2024-01-30T01:00:00Z", url: "c2-url" },
  ],
  isDraft: false,
  mergeable: "MERGEABLE",
  reviewDecision: "APPROVED",
  reviews: [
    { author: "rev", body: "lgtm", raw: rawReview, state: "APPROVED", tsIso: "2024-01-31T00:00:00Z", url: "r-url" },
  ],
  state: "MERGED",
  timeline: [{ actor: "merger", raw: rawState, tsIso: "2024-02-01T00:00:00Z", type: "Merged" }],
  truncated: [],
  updatedAtIso: "2024-02-01T00:00:00Z",
};

const prItem: GithubExportItem = {
  activity,
  author: "alice",
  body: "closes #7",
  kind: "pr",
  number: 42,
  raw: rawPr,
  title: "Add thing",
  tsIso: "2024-01-29T00:00:00Z",
  url: "pr-url",
};

describe("projectGithubRecords", () => {
  it("fans a PR into atom + review + comment + state records", () => {
    const ids = projectGithubRecords({ items: [prItem], repo: "o/r" }).map((r) => r.sourceId);
    expect(ids).toContain("#42");
    expect(ids).toContain("#42:review:0");
    expect(ids).toContain("#42:comment:0");
    expect(ids).toContain("#42:state");
    // the empty-body comment (second comment id) is skipped
    expect(ids).not.toContain("#42:comment:1");
  });

  it("builds a state-prefixed title, a gate summary, and refs on the atom", () => {
    const atom = projectGithubRecords({ items: [prItem], repo: "o/r" }).find((r) => r.sourceId === "#42")!;
    expect(atom.title).toBe("[MERGED] Add thing");
    expect(atom.text).toContain("Review: APPROVED");
    expect(atom.text).toContain("Checks: SUCCESS");
    expect(atom.tsIso).toBe("2024-02-01T00:00:00Z"); // activity updatedAt wins
    expect(atom.refs).toContain("#7");
  });

  it("threads raw payloads onto atom, review, comment, and state records", () => {
    const records = projectGithubRecords({ items: [prItem], repo: "o/r" });
    expect(records.find((r) => r.sourceId === "#42")!.raw).toEqual(rawPr);
    expect(records.find((r) => r.sourceId === "#42:review:0")!.raw).toEqual(rawReview);
    expect(records.find((r) => r.sourceId === "#42:comment:0")!.raw).toEqual(rawComment);
    expect(records.find((r) => r.sourceId === "#42:state")!.raw).toEqual(rawState);
  });

  it("an item without activity yields just the atom with its raw body", () => {
    const bare: GithubExportItem = {
      body: "hello",
      kind: "issue",
      number: 1,
      title: "T",
      tsIso: "2024-01-01T00:00:00Z",
      url: "u",
    };
    const records = projectGithubRecords({ items: [bare], repo: "o/r" });
    expect(records).toHaveLength(1);
    expect(records[0]!.text).toBe("hello");
    expect(records[0]!.title).toBe("T");
  });
});

describe("the widened capture reaches bronze", () => {
  const wideActivity: GithubActivity = {
    ...activity,
    additions: 412,
    baseRefName: "main",
    baseRefOid: "b".repeat(40),
    changedFiles: 9,
    comments: [
      {
        author: "c2",
        body: "this will break under load",
        commitOid: "d".repeat(40),
        diffHunk: "@@ -1,3 +1,4 @@",
        line: 42,
        outdated: false,
        path: "src/lib/paging.ts",
        resolved: false,
        tsIso: "2026-09-12T07:00:00Z",
        url: "c-url",
      },
    ],
    deletions: 87,
    headRefName: "widen-the-selection-set",
    headRefOid: "h".repeat(40),
    headRepository: "o/r",
    mergeCommitOid: "m".repeat(40),
    mergedAtIso: "2026-09-12T09:00:00Z",
    mergedBy: "merger",
    raw: { headRefName: "widen-the-selection-set", mergedBy: { login: "merger" } },
    reviews: [
      {
        author: "rev",
        body: "lgtm",
        commitOid: "c".repeat(40),
        state: "APPROVED",
        tsIso: "2026-09-12T08:00:00Z",
        url: "r-url",
      },
    ],
  };
  const wideItem: GithubExportItem = { ...prItem, activity: wideActivity };
  const records = projectGithubRecords({ items: [wideItem], repo: "o/r" });

  it("a review comment record knows its file and its line", () => {
    const comment = records.find((r) => r.sourceId === "#42:comment:0")!;
    expect(comment.attrs).toEqual({
      commit: "d".repeat(40),
      file: "src/lib/paging.ts",
      line: 42,
      outdated: false,
      resolved: false,
    });
  });

  it("a PR atom knows its head, its base and who merged it", () => {
    const atom = records.find((r) => r.sourceId === "#42")!;
    expect(atom.attrs).toEqual({
      additions: 412,
      baseRef: "main",
      baseSha: "b".repeat(40),
      changedFiles: 9,
      checks: "SUCCESS",
      deletions: 87,
      draft: false,
      headRef: "widen-the-selection-set",
      headRepo: "o/r",
      headSha: "h".repeat(40),
      mergeCommit: "m".repeat(40),
      mergeable: "MERGEABLE",
      mergedAt: "2026-09-12T09:00:00Z",
      mergedBy: "merger",
      reviewDecision: "APPROVED",
      state: "MERGED",
    });
  });

  it("a review record carries the commit its verdict was given on", () => {
    expect(records.find((r) => r.sourceId === "#42:review:0")!.attrs).toEqual({
      commit: "c".repeat(40),
      state: "APPROVED",
    });
  });

  it("keeps the REST search hit verbatim and puts the GraphQL node beside it, never over it", () => {
    const atom = records.find((r) => r.sourceId === "#42")!;
    expect(atom.raw).toEqual({
      ...rawPr,
      activity: { headRefName: "widen-the-selection-set", mergedBy: { login: "merger" } },
    });
  });

  it("leaves the projected text alone — the widening is metadata, never a changed body", () => {
    const comment = records.find((r) => r.sourceId === "#42:comment:0")!;
    expect(comment.text).toBe("this will break under load");
  });
});

describe("a partial capture is declared on the record, not swallowed", () => {
  it("names what saturated on the atom", () => {
    const item: GithubExportItem = { ...prItem, activity: { ...activity, truncated: ["reviews"] } };
    const atom = projectGithubRecords({ items: [item], repo: "o/r" }).find((r) => r.sourceId === "#42")!;
    expect(atom.attrs!["truncated"]).toEqual(["reviews"]);
  });

  it("writes no witness at all when nothing saturated", () => {
    const atom = projectGithubRecords({ items: [prItem], repo: "o/r" }).find((r) => r.sourceId === "#42")!;
    expect(atom.attrs!["truncated"]).toBeUndefined();
  });

  it("does NOT set the corpus-wide capture marker — it would hand the tie to the thinner predecessor", () => {
    // The measurement is in `atomAttrs`. A marked row loses a same-instant, same-text tie in
    // `latestRecords.supersedes` to any unmarked row, and every pre-refetch GitHub atom is unmarked.
    const item: GithubExportItem = { ...prItem, activity: { ...activity, truncated: ["reviews"] } };
    const atom = projectGithubRecords({ items: [item], repo: "o/r" }).find((r) => r.sourceId === "#42")!;
    expect(atom.attrs![CAPTURE_ATTR]).toBeUndefined();
  });
});
