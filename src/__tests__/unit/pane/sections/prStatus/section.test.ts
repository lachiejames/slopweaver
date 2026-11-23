/*
 * The PULL REQUESTS section as a whole: ranking, a row's key and rank reason, an empty section as a measured zero,
 * rows from more than one repository, and what one pull request's row says and carries in its collapsed detail.
 */
import { describe, expect, it } from "vitest";
import type { Measured } from "../../../../../measurement/status.js";
import { buildPrStatusSection, MERGE_LADDER, type PrRecord } from "../../../../../pane/sections/prStatus.js";
import { FRESH, pr } from "./harness.js";

/** Build the section with no Slack asks, for the tests that are about ranking and omission. */
function builtSection({
  prs,
  measuredAtIso,
}: {
  prs: readonly PrRecord[];
  measuredAtIso: Measured<string>;
}): ReturnType<typeof buildPrStatusSection> {
  return buildPrStatusSection({ asks: [], measuredAtIso, prs, window: FRESH });
}

describe("buildPrStatusSection", () => {
  it("ranks closest-to-merge first", () => {
    const section = builtSection({
      measuredAtIso: { known: true, value: "2026-08-06T00:00:00.000Z" },
      prs: [pr({ number: 3, reviewDecision: "REVIEW_REQUIRED" }), pr({ number: 1 }), pr({ isDraft: true, number: 2 })],
    });

    expect(section.rows.map((r) => r.badge)).toEqual(["merge", "undraft", "review"]);
    expect(section.rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("puts the rung and its position on the ladder in every row's rank reason", () => {
    const section = builtSection({
      measuredAtIso: { known: true, value: "2026-08-06T00:00:00.000Z" },
      prs: [pr()],
    });

    expect(section.rows[0]!.rankWhy).toBe(
      `rung merge — 1 of ${String(MERGE_LADDER.length)} on the merge ladder, then pull-request number`,
    );
  });

  it("keys a row on its pull-request number so it survives a re-measurement", () => {
    const section = builtSection({
      measuredAtIso: { known: true, value: "2026-08-06T00:00:00.000Z" },
      prs: [pr({ number: 182 })],
    });

    expect(section.rows[0]!.key).toBe("prs:slopweaver/slopweaver#182");
  });

  it("says an empty section is a MEASURED zero, not an unread one", () => {
    const section = builtSection({ measuredAtIso: { known: false, why: "x" }, prs: [] });

    expect(section.rows).toEqual([]);
    expect(section.emptyReason).toContain("measured zero");
  });

  it("reports a missing review decision as NOT MEASURED rather than as an empty field", () => {
    const section = builtSection({
      measuredAtIso: { known: true, value: "2026-08-06T00:00:00.000Z" },
      prs: [pr({ reviewDecision: "" })],
    });

    expect(section.rows[0]!.detail.join("\n")).toContain("NOT MEASURED — gh reported no review decision");
  });
});

describe("buildPrStatusSection — across repositories", () => {
  it("keys and titles a row by its repository, so two repos cannot collide on a number", () => {
    const section = builtSection({
      measuredAtIso: { known: true, value: "2026-08-06T00:00:00.000Z" },
      prs: [pr({ number: 7, repo: "o/alpha" }), pr({ number: 7, repo: "o/beta" })],
    });

    expect(section.rows.map((r) => r.key)).toEqual(["prs:o/alpha#7", "prs:o/beta#7"]);
    expect(section.rows[0]!.title).toContain("alpha #7");
    expect(section.rows[1]!.title).toContain("beta #7");
  });

  it("names the repository in the collapsed detail", () => {
    const section = builtSection({
      measuredAtIso: { known: true, value: "2026-08-06T00:00:00.000Z" },
      prs: [pr({ repo: "o/alpha" })],
    });

    expect(section.rows[0]!.detail.join("\n")).toContain("repo     o/alpha");
  });
});

describe("the row a pull request renders as", () => {
  it("leads the evidence column with what it is blocked on", () => {
    const section = builtSection({
      measuredAtIso: { known: true, value: "2026-08-07T00:00:00.000Z" },
      prs: [pr({ mergeable: "CONFLICTING" })],
    });

    expect(section.rows[0]!.why).toContain("blocked on a MERGE CONFLICT");
  });

  it("spells NOTHING and UNKNOWN differently, so a measured zero cannot read as an unread one", () => {
    const section = builtSection({
      measuredAtIso: { known: true, value: "2026-08-07T00:00:00.000Z" },
      prs: [pr({ number: 1 }), pr({ mergeable: "UNKNOWN", number: 2 })],
    });

    expect(section.rows.map((row) => row.why.split(" — ")[0])).toEqual(["blocked on NOTHING", "blocked on UNKNOWN"]);
  });

  it("names the author on the row, because the team's pull requests are on this page too", () => {
    const section = builtSection({
      measuredAtIso: { known: true, value: "2026-08-07T00:00:00.000Z" },
      prs: [pr({ author: "a-colleague" })],
    });

    expect(section.rows[0]!.title).toContain("@a-colleague");
  });

  it("carries the parsed problem statement in the collapsed detail", () => {
    const section = builtSection({
      measuredAtIso: { known: true, value: "2026-08-07T00:00:00.000Z" },
      prs: [pr({ body: "<td><strong>Problem</strong></td><td>the board lies</td>" })],
    });

    expect(section.rows[0]!.detail.join("\n")).toContain("problem  the board lies");
  });

  it("labels a missing statement as absent rather than leaving the line blank", () => {
    const section = builtSection({
      measuredAtIso: { known: true, value: "2026-08-07T00:00:00.000Z" },
      prs: [pr({ body: "" })],
    });

    expect(section.rows[0]!.detail.join("\n")).toContain("problem  NOT MEASURED —");
  });

  it("records a measured zero for review requests rather than an empty line", () => {
    const section = builtSection({
      measuredAtIso: { known: true, value: "2026-08-07T00:00:00.000Z" },
      prs: [pr({ reviewRequests: [] })],
    });

    expect(section.rows[0]!.detail.join("\n")).toContain("asked    nobody");
  });
});
