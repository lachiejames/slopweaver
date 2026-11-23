import { describe, expect, it } from "vitest";
import type { ThreadDetail } from "../../../review/prStateDetail.js";
import {
  conversationTallies,
  PRESS_CODEX_WAIVER_REASON,
  pressCodexWaiverReason,
  standingChangesRequested,
} from "../../../review/reviewSignals.js";
import type { ReviewFacts } from "../../../review/reviewState.js";

const AUTHOR = "the-owner";

const thread = (over: Partial<ThreadDetail> = {}): ThreadDetail => ({
  commentCount: 1,
  id: "PRRT_kwDOfake1",
  disposition: "awaiting-us",
  isOutdated: false,
  lastCommentAtIso: "2026-09-10T10:00:00.000Z",
  lastCommentLine: "please change this",
  lastCommentLogin: "a-reviewer",
  line: 12,
  openedAtIso: "2026-09-10T10:00:00.000Z",
  openedByLogin: "a-reviewer",
  openerLine: "please change this",
  path: "src/app.ts",
  ...over,
});

const review = (over: Partial<ReviewFacts> = {}): ReviewFacts => ({
  commitOid: "abc1234",
  login: "a-reviewer",
  state: "CHANGES_REQUESTED",
  submittedAtIso: "2026-09-10T10:00:00.000Z",
  ...over,
});

const NO_THREADS = { answeredOpen: 0, awaitingUs: 0, open: 0, reviewerLastWord: 0, resolved: 0 };

describe("conversationTallies", () => {
  it("counts CodeRabbit and humans apart, by the disposition each thread already carries", () => {
    const tallies = conversationTallies({
      authorLogin: AUTHOR,
      threads: [
        thread({ disposition: "awaiting-us", openedByLogin: "coderabbitai" }),
        thread({ disposition: "answered-open", openedByLogin: "coderabbitai" }),
        thread({ disposition: "resolved", openedByLogin: "coderabbitai" }),
        thread({ disposition: "reviewer-replied", openedByLogin: "a-reviewer" }),
        thread({ disposition: "awaiting-us", openedByLogin: "a-reviewer" }),
      ],
    });
    expect(tallies.codeRabbit).toStrictEqual({
      answeredOpen: 1,
      awaitingUs: 1,
      open: 2,
      reviewerLastWord: 0,
      resolved: 1,
    });
    expect(tallies.humans).toStrictEqual({
      answeredOpen: 0,
      awaitingUs: 1,
      open: 2,
      reviewerLastWord: 1,
      resolved: 0,
    });
  });

  it("puts the author's own self-review walkthrough in NEITHER side", () => {
    const tallies = conversationTallies({
      authorLogin: AUTHOR,
      threads: [thread({ disposition: "ours-open", openedByLogin: AUTHOR })],
    });
    expect(tallies.codeRabbit).toStrictEqual(NO_THREADS);
    expect(tallies.humans).toStrictEqual(NO_THREADS);
  });

  it("counts any [bot] opener with CodeRabbit, because what the split separates is a machine from a colleague", () => {
    const tallies = conversationTallies({
      authorLogin: AUTHOR,
      threads: [thread({ disposition: "awaiting-us", openedByLogin: "dependabot[bot]" })],
    });
    expect(tallies.codeRabbit.open).toBe(1);
    expect(tallies.humans).toStrictEqual(NO_THREADS);
  });

  it("reads zeroes, never an absence, on a pull request nobody has commented on", () => {
    const tallies = conversationTallies({ authorLogin: AUTHOR, threads: [] });
    expect(tallies).toStrictEqual({ codeRabbit: NO_THREADS, humans: NO_THREADS });
  });
});

describe("standingChangesRequested", () => {
  it("names a human whose latest opinionated review still asks for changes", () => {
    const standing = standingChangesRequested({ authorLogin: AUTHOR, reviews: [review()] });
    expect(standing).toStrictEqual([
      { atIso: "2026-09-10T10:00:00.000Z", login: "a-reviewer", opinion: "changes-requested" },
    ]);
  });

  it("drops one a later APPROVED review from the same person withdrew", () => {
    const standing = standingChangesRequested({
      authorLogin: AUTHOR,
      reviews: [review(), review({ state: "APPROVED", submittedAtIso: "2026-09-10T11:00:00.000Z" })],
    });
    expect(standing).toStrictEqual([]);
  });

  it("keeps one a later COMMENTED review did NOT withdraw, which is GitHub's own behaviour", () => {
    const standing = standingChangesRequested({
      authorLogin: AUTHOR,
      reviews: [review(), review({ state: "COMMENTED", submittedAtIso: "2026-09-10T11:00:00.000Z" })],
    });
    expect(standing.map((entry) => entry.login)).toStrictEqual(["a-reviewer"]);
  });

  it("ignores CodeRabbit, whose verdict dispatches somewhere else entirely", () => {
    const standing = standingChangesRequested({
      authorLogin: AUTHOR,
      reviews: [review({ login: "coderabbitai" })],
    });
    expect(standing).toStrictEqual([]);
  });

  it("ignores the author's own review, which can never satisfy or block their own pull request", () => {
    const standing = standingChangesRequested({ authorLogin: AUTHOR, reviews: [review({ login: AUTHOR })] });
    expect(standing).toStrictEqual([]);
  });

  it("sees a reviewer nobody chased in Slack, which is what reviewedSinceAsk cannot do", () => {
    const standing = standingChangesRequested({
      authorLogin: AUTHOR,
      reviews: [review({ login: "quiet-reviewer" })],
    });
    expect(standing.map((entry) => entry.login)).toStrictEqual(["quiet-reviewer"]);
  });

  it("is empty when nobody has reviewed at all", () => {
    expect(standingChangesRequested({ authorLogin: AUTHOR, reviews: [] })).toStrictEqual([]);
  });
});

describe("pressCodexWaiverReason", () => {
  it("returns the ONE constant reason when a human's standing approval covers the press", () => {
    const reason = pressCodexWaiverReason({
      authorLogin: AUTHOR,
      reviews: [review({ login: "a-colleague", state: "APPROVED" })],
      reviewsTruncated: false,
    });
    expect(reason).toBe(PRESS_CODEX_WAIVER_REASON);
  });

  it("states the approval it rests on, so a door-ledger row says which decision it is", () => {
    expect(PRESS_CODEX_WAIVER_REASON).toContain("a human reviewer's standing approval");
  });

  it("waives nothing on a pull request nobody reviewed, which is what keeps the floor a floor", () => {
    expect(pressCodexWaiverReason({ authorLogin: AUTHOR, reviews: [], reviewsTruncated: false })).toBe(undefined);
  });

  it("waives nothing on a bot's approval", () => {
    const reason = pressCodexWaiverReason({
      authorLogin: AUTHOR,
      reviews: [review({ login: "coderabbitai", state: "APPROVED" }), review({ login: "dep[bot]", state: "APPROVED" })],
      reviewsTruncated: false,
    });
    expect(reason).toBe(undefined);
  });

  it("waives nothing on the author's own approval", () => {
    const reason = pressCodexWaiverReason({
      authorLogin: AUTHOR,
      reviews: [review({ login: AUTHOR, state: "APPROVED" })],
      reviewsTruncated: false,
    });
    expect(reason).toBe(undefined);
  });

  it("waives nothing when the approver's LATEST opinionated review withdrew it", () => {
    const reason = pressCodexWaiverReason({
      authorLogin: AUTHOR,
      reviews: [
        review({ login: "a-colleague", state: "APPROVED" }),
        review({ login: "a-colleague", state: "CHANGES_REQUESTED" }),
      ],
      reviewsTruncated: false,
    });
    expect(reason).toBe(undefined);
  });

  it("keeps the approval a COMMENTED review left standing, mirroring GitHub's own behaviour", () => {
    const reason = pressCodexWaiverReason({
      authorLogin: AUTHOR,
      reviews: [
        review({ login: "a-colleague", state: "APPROVED" }),
        review({ login: "a-colleague", state: "COMMENTED" }),
      ],
      reviewsTruncated: false,
    });
    expect(reason).toBe(PRESS_CODEX_WAIVER_REASON);
  });

  it("waives nothing when the reviews did not fit one page, because a lost withdrawal reads as an approval", () => {
    const reason = pressCodexWaiverReason({
      authorLogin: AUTHOR,
      reviews: [review({ login: "a-colleague", state: "APPROVED" })],
      reviewsTruncated: true,
    });
    expect(reason).toBe(undefined);
  });
});
