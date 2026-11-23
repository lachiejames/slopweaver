import { describe, expect, it } from "vitest";

import {
  parseCycleBriefingDocument,
  parseLandingBriefingDocument,
  parseSweepBriefingDocument,
} from "../../../briefing/nothingStaleDocuments.js";
import { OWNER_JUDGEMENT_VERDICT } from "../../../briefing/nothingStalePullRequests.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** One stored landing row, carrying producer fields the view does not read. */
const landingRow = {
  action: "blocked-on",
  askTrail: [{ recipients: ["U0SYNASKED01"] }, { recipients: ["U0SYNOLDER01"] }],
  blockedOn: ["@a-reviewer", "@org/team"],
  boardRow: { kind: "row", run: "finished", slug: "land-org-repo-12-abcdef1", status: "done" },
  checks: { passed: 3 },
  dispatch: { kind: "waiting", why: "waiting on a human review" },
  headOid: "abcdef1234567890",
  number: 12,
  queue: { kind: "not-queued" },
  repoSlug: "org/repo",
  residue: ["row bound", "shared bound"],
  title: "Fix the thing",
  url: "https://github.com/org/repo/pull/12",
};

const landing = {
  census: [
    {
      kind: "read",
      pullRequests: [{ author: "me", isDraft: false, number: 12, title: "Fix the thing", url: "https://x/12" }],
      repo: "org/repo",
      startedAtIso: "2026-09-26T07:00:00.000Z",
      totalCount: 1,
      viewer: "me",
    },
    { kind: "unread", repo: "org/other", why: "it moved" },
  ],
  dispatchable: 0,
  kind: "read",
  people: { U0SYNASKED01: { name: "Ada", slackId: "U0SYNASKED01" } },
  presses: [],
  residue: ["shared bound"],
  rows: [landingRow],
  selection: { author: "@me", includeDrafts: false, repos: ["org/repo", "org/other"] },
};

describe("parseLandingBriefingDocument", () => {
  it("narrows a stored landing read to the fields the section reads, every bound once", () => {
    expect(unwrap(parseLandingBriefingDocument({ value: landing }))).toStrictEqual({
      census: [
        { kind: "read", pullRequests: [{ author: "me", isDraft: false, number: 12 }], repo: "org/repo", viewer: "me" },
        { kind: "unread", repo: "org/other", why: "it moved" },
      ],
      selection: { author: "@me", includeDrafts: false, repos: ["org/repo", "org/other"] },
      people: { U0SYNASKED01: "Ada" },
      presses: [],
      residue: ["shared bound", "row bound"],
      rows: [
        {
          action: "blocked-on",
          blockedOn: ["@a-reviewer", "@org/team"],
          boardRowSlug: "land-org-repo-12-abcdef1",
          dispatch: { kind: "waiting", why: "waiting on a human review" },
          headOid: "abcdef1234567890",
          latestAskRecipients: ["U0SYNASKED01"],
          number: 12,
          queueKind: "not-queued",
          repoSlug: "org/repo",
          title: "Fix the thing",
          url: "https://github.com/org/repo/pull/12",
        },
      ],
    });
  });

  it("refuses a read carrying no open list, since then a pull request it dropped could not be named", () => {
    const { census: _dropped, ...withoutCensus } = landing;
    expect(unwrapErr(parseLandingBriefingDocument({ value: withoutCensus }))).toStrictEqual([
      "landing.census: Invalid input: expected array, received undefined",
    ]);
  });

  it("reads a row no board row declares as having no board row slug", () => {
    const value = { ...landing, rows: [{ ...landingRow, boardRow: { kind: "none-declared" } }] };
    expect(unwrap(parseLandingBriefingDocument({ value })).rows[0]!.boardRowSlug).toBe(undefined);
  });

  it("reads a row nobody was asked about as having no recipients", () => {
    const value = { ...landing, rows: [{ ...landingRow, askTrail: [] }] };
    expect(unwrap(parseLandingBriefingDocument({ value })).rows[0]!.latestAskRecipients).toStrictEqual([]);
  });

  it("reads the owner-judgment verdict as written", () => {
    const verdict = OWNER_JUDGEMENT_VERDICT;
    const value = { ...landing, rows: [{ ...landingRow, dispatch: { kind: "act", verdict, why: "w" } }] };
    expect(unwrap(parseLandingBriefingDocument({ value })).rows[0]!.dispatch).toStrictEqual({
      kind: "act",
      verdict: "needs-owner-judgment",
      why: "w",
    });
  });

  it("refuses the skipped-tick document, whose kind is not a read", () => {
    expect(unwrapErr(parseLandingBriefingDocument({ value: { ...landing, kind: "skipped" } }))).toStrictEqual([
      'landing.kind: Invalid input: expected "read"',
    ]);
  });

  it("refuses a row missing a field the section classifies on", () => {
    const { dispatch: _dropped, ...withoutDispatch } = landingRow;
    expect(unwrapErr(parseLandingBriefingDocument({ value: { ...landing, rows: [withoutDispatch] } }))).toStrictEqual([
      "landing.rows.0.dispatch: Invalid input: expected object, received undefined",
    ]);
  });
});

const proposal = {
  action: "close-with-comment",
  evidence: [{ fact: "its state is Merged", url: "https://linear.app/x/issue/ABC-1" }],
  headline: "ABC-1 already shipped.",
  oneWordReplies: ["close", "keep"],
  subject: "ABC-1",
  title: "Do the thing",
  url: "https://linear.app/x/issue/ABC-1",
};

describe("parseCycleBriefingDocument", () => {
  it("narrows a stored cycle report to its proposals and its could-not-see lines", () => {
    const value = {
      couldNotSee: ["a bound"],
      generatedAt: "2026-09-26T06:45:00.000Z",
      proposals: [proposal],
      proposalsOnly: true,
      wrote: false,
    };
    expect(unwrap(parseCycleBriefingDocument({ value }))).toStrictEqual({
      couldNotSee: ["a bound"],
      proposals: [proposal],
    });
  });

  it("refuses a report that does not assert it only proposes", () => {
    const value = { couldNotSee: [], proposals: [], proposalsOnly: false };
    expect(unwrapErr(parseCycleBriefingDocument({ value }))).toStrictEqual([
      "cycle.proposalsOnly: Invalid input: expected true",
    ]);
  });
});

describe("parseSweepBriefingDocument", () => {
  const line = JSON.stringify({
    act: "close",
    path: "/x",
    slug: "a-dead-leaf",
    verdict: "ORPHANED",
    witness: "its PR merged",
  });

  it("reads the producer's zero-byte clean pass as no findings", () => {
    expect(unwrap(parseSweepBriefingDocument({ lines: [] }))).toStrictEqual([]);
  });

  it("narrows each line to the fields the section reads", () => {
    expect(unwrap(parseSweepBriefingDocument({ lines: [line] }))).toStrictEqual([
      { act: "close", slug: "a-dead-leaf", verdict: "ORPHANED", witness: "its PR merged" },
    ]);
  });

  it("refuses the whole document on one bad line, naming every problem by its line", () => {
    const wrongAct = JSON.stringify({ act: "delete", slug: "b", verdict: "SHIPPED", witness: "w" });
    expect(unwrapErr(parseSweepBriefingDocument({ lines: [line, "{nope", wrongAct] }))).toStrictEqual([
      "line 2: not JSON: Expected property name or '}' in JSON at position 1 (line 1 column 2)",
      'line 3.act: Invalid option: expected one of "close"|"settle"|"none"',
    ]);
  });
});
