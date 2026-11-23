import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { backfillSentence, type TopupBatchMember, topupBatchPlan } from "../../../../review/vulnTopupBatchRead.js";
import {
  type TopupMemberReading,
  topupBackfillSlots,
  topupJudgedBackfill,
  topupMergeGate,
} from "../../../../review/vulnTopupGate.js";
import { member } from "../../../vulnTopupFixture.js";
import { backfillAsk, line, PREFIX } from "./harness.js";

describe("topupBackfillSlots and topupJudgedBackfill", () => {
  /** A ruling naming `packageName` in owner/name. */
  const ruling = ({ packageName, repo = "owner/name" }: { packageName: string; repo?: string }) => ({
    anchor: "card:1",
    package: packageName,
    recordedIso: "2026-10-27T03:00:00.000Z",
    repo,
    why: "needs a major migration",
  });
  const plan = unwrap(topupBatchPlan({ ask: backfillAsk({ backfill: 2 }), repo: "owner/name" }));
  /** Every member of `members` open, an open pull request naming exactly those listed in `raised`. */
  const standing = ({
    members,
    raised,
  }: {
    members: readonly TopupBatchMember[];
    raised: readonly number[];
  }): TopupMemberReading[] =>
    members.map((read) => ({ ...read, hasOpenPr: raised.includes(read.alertNumber), state: "open" as const }));
  /** The alert numbers the gate judges in the backfill, for one batch and backfill standing. */
  const judged = ({
    backfill = standing({ members: plan.backfill, raised: [] }),
    batch = standing({ members: plan.batch, raised: [1141] }),
    rulings,
  }: {
    backfill?: readonly TopupMemberReading[];
    batch?: readonly TopupMemberReading[];
    rulings: ReturnType<typeof ruling>[];
  }): number[] => {
    const slots = topupBackfillSlots({ batch, repo: "owner/name", rulings });
    return topupJudgedBackfill({ backfill, repo: "owner/name", rulings, slots }).map((read) => read.alertNumber);
  };

  it("reads the batch and the backfill apart, in brief order", () => {
    expect(plan.batch.map((read) => read.alertNumber)).toEqual([1141, 1108]);
    expect(plan.backfill.map((read) => read.alertNumber)).toEqual([1084, 842]);
  });

  it("judges no backfill line when no batch member was ruled not a bump, however its alert stands", () => {
    expect(judged({ rulings: [] })).toEqual([]);
  });

  it("judges the first backfill line in place of the batch member a seat skipped and ruled not a bump", () => {
    expect(judged({ rulings: [ruling({ packageName: "@modelcontextprotocol/sdk" })] })).toEqual([1084]);
  });

  it("opens no slot for a ruled batch member the seat raised all the same, or whose alert is fixed", () => {
    const rulings = [ruling({ packageName: "@modelcontextprotocol/sdk" })];
    const fixed = plan.batch.map((read) => ({ ...read, hasOpenPr: false, state: "fixed" as const }));

    expect(judged({ batch: standing({ members: plan.batch, raised: [1141, 1108] }), rulings })).toEqual([]);
    expect(judged({ batch: fixed, rulings })).toEqual([]);
  });

  it("passes over a backfill line that is itself ruled, judging the next in its place", () => {
    const rulings = [ruling({ packageName: "happy-dom" }), ruling({ packageName: "shell-quote" })];

    expect(judged({ batch: standing({ members: plan.batch, raised: [1108] }), rulings })).toEqual([842]);
  });

  it("ignores a ruling that names another repository", () => {
    expect(judged({ rulings: [ruling({ packageName: "@modelcontextprotocol/sdk", repo: "owner/other" })] })).toEqual(
      [],
    );
  });

  it("keeps a never-raised backfill line someone else fixed out of the verdict", () => {
    const batch = [
      member({ hasOpenPr: true, number: 1, state: "open" }),
      member({ hasOpenPr: false, number: 2, state: "open" }),
    ];

    expect(topupBackfillSlots({ batch, repo: "owner/name", rulings: [] })).toBe(0);
    expect(topupMergeGate({ previousSlug: `${PREFIX}-1`, readings: batch, releaseAfterMergedPercent: 50 }).kind).toBe(
      "idle",
    );
  });

  it("gives the slot to a line the seat raised out of order over an earlier one someone else fixed", () => {
    const backfill: TopupMemberReading[] = [
      { alertNumber: 1084, hasOpenPr: false, packageName: "shell-quote", state: "fixed" },
      { alertNumber: 842, hasOpenPr: true, packageName: "find-my-way", state: "open" },
    ];

    expect(judged({ backfill, rulings: [ruling({ packageName: "@modelcontextprotocol/sdk" })] })).toEqual([842]);
  });

  it("opens one slot when one scope ruling covers two batch members but the seat skipped only one", () => {
    const scoped = unwrap(
      topupBatchPlan({
        ask: [
          "Raise 3 vulnerability-fix pull request(s) in owner/name as someone, to bring the set back to 10.",
          line({ name: "@scope/a", number: 1 }),
          line({ name: "@scope/b", number: 2 }),
          line({ name: "pkg-c", number: 3 }),
          backfillSentence({ count: 2 }),
          line({ name: "x", number: 4 }),
          line({ name: "y", number: 5 }),
        ].join("\n"),
        repo: "owner/name",
      }),
    );
    const batch: TopupMemberReading[] = [
      { alertNumber: 1, hasOpenPr: false, packageName: "@scope/a", state: "open" },
      { alertNumber: 2, hasOpenPr: true, packageName: "@scope/b", state: "open" },
      { alertNumber: 3, hasOpenPr: true, packageName: "pkg-c", state: "open" },
    ];
    const rulings = [ruling({ packageName: "@scope/*" })];
    const slots = topupBackfillSlots({ batch, repo: "owner/name", rulings });
    const backfill = scoped.backfill.map((read) => ({ ...read, hasOpenPr: false, state: "fixed" as const }));
    const readings = [...batch, ...topupJudgedBackfill({ backfill, repo: "owner/name", rulings, slots })];

    expect(slots).toBe(1);
    expect(readings.map((read) => read.packageName)).toEqual(["@scope/a", "@scope/b", "pkg-c", "x"]);
    expect(topupMergeGate({ previousSlug: `${PREFIX}-1`, readings, releaseAfterMergedPercent: 50 }).kind).toBe("idle");
  });
});
