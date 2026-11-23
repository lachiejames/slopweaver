/**
 * The pure half of the owner's standing rule: how much of the twenty seconds is left, which rows may be
 * re-requested, and what the read after the wait decides.
 */
import { describe, expect, it } from "vitest";

import { DISTANCE_NOT_REQUESTED } from "../../../live/github/baseDistance.js";
import type { PrLiveState } from "../../../live/github/reviewState.js";
import {
  CODERABBIT_NUDGE_WAIT_MS,
  codeRabbitNudgeCandidates,
  codeRabbitNudgeDecision,
  remainingCodeRabbitWaitMs,
} from "../../../review/codeRabbitNudge.js";
import { githubMergeStatus } from "../../../review/githubMergeStatus.js";
import { landingRowFake } from "../../landingRowFake.js";

const HEAD = "1111111111111111111111111111111111111111";

const CHANGES = {
  commitOid: HEAD,
  login: "coderabbitai",
  onBehalfOf: [],
  state: "CHANGES_REQUESTED",
  submittedAtIso: "2026-09-28T06:00:00Z",
} as const;

/** One CodeRabbit thread, resolved unless a case says otherwise. */
const rabbitThread = ({ isResolved = true }: { isResolved?: boolean }): PrLiveState["threads"][number] => ({
  commentCount: 1,
  id: "PRRT_rabbit1",
  isOutdated: false,
  isResolved,
  lastCommentAtIso: "2026-09-28T06:00:00Z",
  lastCommentBody: "",
  lastCommentLogin: "coderabbitai",
  line: 12,
  openedAtIso: "2026-09-28T06:00:00Z",
  openedByLogin: "coderabbitai",
  openerBody: "",
  path: "src/app.ts",
});

/** The pull request as the read after the wait sees it — stuck unless a case says otherwise. */
const fresh = (over: Partial<PrLiveState> = {}): PrLiveState => ({
  authorLogin: "the-owner",
  baseDistance: DISTANCE_NOT_REQUESTED,
  baseRefName: "main",
  changedPaths: [],
  changedPathsTruncated: false,
  checks: {
    baseRef: "main",
    checks: [],
    headSha: HEAD,
    mergeable: undefined,
    residue: [],
    rollupState: "SUCCESS",
    supersededChecks: [],
    truncated: false,
  },
  checksRead: { kind: "read" },
  checksTruncated: false,
  codeownerRequests: [],
  codeownerRequestsTruncated: false,
  createdAtIso: "2026-09-28T05:00:00Z",
  defaultBranch: "main",
  githubMergeStatus: githubMergeStatus({ value: "BLOCKED" }),
  headOid: HEAD,
  headRefName: "a-branch",
  headRepoSlug: "acme/widgets",
  isDraft: false,
  labels: [],
  labelsTruncated: false,
  mergeable: "MERGEABLE",
  number: 16378,
  queueEntry: undefined,
  repoSlug: "acme/widgets",
  requestedReviewers: [],
  reviewDecision: "",
  reviews: [CHANGES],
  reviewsTruncated: false,
  threadCount: 1,
  threads: [rabbitThread({})],
  threadsTruncated: false,
  title: "a change",
  updatedAtIso: "2026-09-28T06:00:00Z",
  url: "https://github.com/acme/widgets/pull/16378",
  ...over,
});

const stuckRow = landingRowFake({ action: "spawn-coderabbit", codeRabbit: "stuck" });

describe("remainingCodeRabbitWaitMs", () => {
  it("waits the whole twenty seconds straight after the read", () => {
    expect(remainingCodeRabbitWaitMs({ nowMonotonicMs: 1_000, observedAtMonotonicMs: 1_000 })).toBe(20_000);
  });

  it("counts time already spent since the read, and waits only the rest", () => {
    expect(remainingCodeRabbitWaitMs({ nowMonotonicMs: 7_500, observedAtMonotonicMs: 1_000 })).toBe(13_500);
  });

  it("waits nothing once twenty seconds have already passed", () => {
    expect(remainingCodeRabbitWaitMs({ nowMonotonicMs: 40_000, observedAtMonotonicMs: 1_000 })).toBe(0);
  });

  it("waits the WHOLE twenty seconds when the clock reads earlier than the observation", () => {
    expect(remainingCodeRabbitWaitMs({ nowMonotonicMs: 500, observedAtMonotonicMs: 1_000 })).toBe(
      CODERABBIT_NUDGE_WAIT_MS,
    );
  });
});

describe("codeRabbitNudgeCandidates", () => {
  it("offers a stuck row of the owner's own", () => {
    const rows = codeRabbitNudgeCandidates({ authoredByOwner: true, nudgedHeads: new Set(), rows: [stuckRow] });
    expect(rows.map((row) => row.number)).toEqual([16378]);
  });

  it("offers nothing when the read was not the owner's own pull requests", () => {
    expect(codeRabbitNudgeCandidates({ authoredByOwner: false, nudgedHeads: new Set(), rows: [stuckRow] })).toEqual([]);
  });

  it("never offers a head already re-requested, while another head of the same pull request is a new case", () => {
    const moved = landingRowFake({
      action: "spawn-coderabbit",
      codeRabbit: "stuck",
      headOid: "2222222222222222222222222222222222222222",
      number: 16378,
    });
    const rows = codeRabbitNudgeCandidates({
      authoredByOwner: true,
      nudgedHeads: new Set([`acme/widgets#16378@${HEAD}`]),
      rows: [stuckRow, moved],
    });
    expect(rows.map((row) => row.headOid)).toEqual(["2222222222222222222222222222222222222222"]);
  });

  it("offers a plain CHANGES_REQUESTED row to nobody — an open thread is a session's work", () => {
    const open = landingRowFake({ action: "spawn-coderabbit", codeRabbit: "changes-requested" });
    expect(codeRabbitNudgeCandidates({ authoredByOwner: true, nudgedHeads: new Set(), rows: [open] })).toEqual([]);
  });

  it("offers a stuck verdict to nobody once another rung won the ladder", () => {
    const conflicted = landingRowFake({ action: "conflicting", codeRabbit: "stuck" });
    expect(codeRabbitNudgeCandidates({ authoredByOwner: true, nudgedHeads: new Set(), rows: [conflicted] })).toEqual(
      [],
    );
  });

  it("orders candidates by repository then number, so the cap bites the same rows every time", () => {
    const rows = codeRabbitNudgeCandidates({
      authoredByOwner: true,
      nudgedHeads: new Set(),
      rows: [
        landingRowFake({ action: "spawn-coderabbit", codeRabbit: "stuck", number: 9, repoSlug: "acme/zeta" }),
        landingRowFake({ action: "spawn-coderabbit", codeRabbit: "stuck", number: 20 }),
        landingRowFake({ action: "spawn-coderabbit", codeRabbit: "stuck", number: 3 }),
      ],
    });
    expect(rows.map((row) => `${row.repoSlug}#${String(row.number)}`)).toEqual([
      "acme/widgets#3",
      "acme/widgets#20",
      "acme/zeta#9",
    ]);
  });
});

describe("codeRabbitNudgeDecision", () => {
  it("re-requests when the read after the wait is still stuck", () => {
    expect(codeRabbitNudgeDecision({ fresh: fresh(), row: stuckRow })).toEqual({
      detail:
        "every CodeRabbit thread was still resolved and its CHANGES_REQUESTED still stood twenty seconds after " +
        "the read that saw it",
      kind: "nudge",
    });
  });

  it("reads a flip CodeRabbit made by itself as flipped, not as a re-request", () => {
    const approved = { ...CHANGES, state: "APPROVED", submittedAtIso: "2026-09-28T06:00:10Z" } as const;
    expect(codeRabbitNudgeDecision({ fresh: fresh({ reviews: [CHANGES, approved] }), row: stuckRow })).toEqual({
      detail: "CodeRabbit approved the head by itself during the wait",
      kind: "flipped",
    });
  });

  it("refuses when a thread reopened during the wait", () => {
    const decision = codeRabbitNudgeDecision({
      fresh: fresh({ threads: [rabbitThread({ isResolved: false })] }),
      row: stuckRow,
    });
    expect(decision).toEqual({
      detail: "not re-requested: the read after the wait says 1 unresolved CodeRabbit comment(s) still open",
      kind: "refused",
    });
  });

  it("refuses when the head moved during the wait, since a new push starts a new review", () => {
    const decision = codeRabbitNudgeDecision({
      fresh: fresh({ headOid: "2222222222222222222222222222222222222222" }),
      row: stuckRow,
    });
    expect(decision).toEqual({
      detail:
        "not re-requested: its head moved from 1111111 to 2222222 during the wait, and a new push starts a new review",
      kind: "refused",
    });
  });

  it("refuses when the read after the wait cannot see every thread", () => {
    const decision = codeRabbitNudgeDecision({
      fresh: fresh({ threadCount: 101, threadsTruncated: true }),
      row: stuckRow,
    });
    expect(decision).toEqual({
      detail:
        "not re-requested: the read after the wait says 101 review threads, more than one page — this read " +
        "cannot prove nothing is outstanding",
      kind: "refused",
    });
  });

  it("refuses when the read after the wait cannot see every review, which could hide the approval", () => {
    const decision = codeRabbitNudgeDecision({ fresh: fresh({ reviewsTruncated: true }), row: stuckRow });
    expect(decision).toEqual({
      detail:
        "not re-requested: the read after the wait could not see every review, so a newer one may have flipped it",
      kind: "refused",
    });
  });
});
