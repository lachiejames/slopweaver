import { describe, expect, it } from "vitest";

import type { ReviewVerdict } from "../../../../admit/reviewVerdict.js";
import { answerEditGate, answerEditRefusalLines, verdictIsSendable } from "../../../../live/turn/answerFreeze.js";
import type { ReviewRecord } from "../../../../live/turn/review.js";
import type { VerdictFileRead } from "../../../../live/turn/reviewPoll.js";

/** The digest round three of the incident bound to. */
const REVIEWED_DIGEST = `sha256:${"a".repeat(64)}`;

/** The digest of the rewrite that superseded it. */
const REWRITTEN_DIGEST = `sha256:${"b".repeat(64)}`;

/** A review record standing over {@link REVIEWED_DIGEST}, at the round the caller names. */
function recordAt({ round }: { round: number }): ReviewRecord {
  return {
    answerDigest: REVIEWED_DIGEST,
    answerPath: "${SLOPWEAVER_HOME}/tmp/answer.json",
    authorSession: "author claude-code session a",
    carriedUnresolved: [],
    channel: "CFIXTUREAA",
    messageTs: "1788416854.480579",
    packetPath: "${SLOPWEAVER_HOME}/live/slack/reviews/CFIXTUREAA-1788416854.480579/packet.md",
    reviewer: {
      host: "claude-code",
      surfaceId: "surface-uuid",
      surfaceRef: "surface:2",
      workspaceId: "workspace-uuid",
      workspaceRef: "workspace:1",
    },
    reviewerSession: "reviewer workspace workspace:1 (workspace-uuid)",
    round,
    schemaVersion: 2,
    spawnedAt: "2026-09-03T07:36:53.850Z",
    threadTs: "1788412947.233649",
    verdictPath: "${SLOPWEAVER_HOME}/live/slack/reviews/CFIXTUREAA-1788416854.480579/verdict.json",
  };
}

/** A verdict bound to {@link REVIEWED_DIGEST} with the outcome and claims the caller names. */
function verdictWith({
  claims,
  outcome,
}: {
  claims: ReviewVerdict["claims"];
  outcome: ReviewVerdict["outcome"];
}): ReviewVerdict {
  return {
    answerDigest: REVIEWED_DIGEST,
    authorSession: "author claude-code session a",
    claims,
    outcome,
    reviewerSession: "reviewer workspace workspace:1 (workspace-uuid)",
    schemaVersion: 1,
  };
}

/** Round three's real shape: clean, every claim supported. */
const CLEAN_VERDICT = verdictWith({
  claims: [
    { evidence: "the table in the answer", impact: "high", support: "supported", text: "the row count matches" },
  ],
  outcome: "clean",
});

/** Round five's real shape: broken on the core deliverable. */
const BROKEN_VERDICT = verdictWith({
  claims: [{ impact: "high", support: "unsupported", text: "no row proposes the monitor the ask existed for" }],
  outcome: "broken",
});

/** The verdict file read a present verdict produces. */
function present({ verdict }: { verdict: ReviewVerdict }): VerdictFileRead {
  return { kind: "present", verdict };
}

describe("verdictIsSendable", () => {
  it("is true for a clean verdict with every high-impact claim supported", () => {
    expect(verdictIsSendable({ verdict: CLEAN_VERDICT })).toBe(true);
  });

  it("is false for a broken verdict", () => {
    expect(verdictIsSendable({ verdict: BROKEN_VERDICT })).toBe(false);
  });

  it("is false for a clean verdict that still leaves a high-impact claim unsupported", () => {
    const inconsistent = verdictWith({
      claims: [{ impact: "high", support: "unverifiable", text: "the forecast figure could not be checked" }],
      outcome: "clean",
    });
    expect(verdictIsSendable({ verdict: inconsistent })).toBe(false);
  });

  it("ignores an unresolved LOW-impact claim, which is exactly what bought the extra rounds", () => {
    const withNit = verdictWith({
      claims: [
        { evidence: "checked", impact: "high", support: "supported", text: "the row count matches" },
        { impact: "low", support: "unsupported", text: "the lead could name the window" },
      ],
      outcome: "clean",
    });
    expect(verdictIsSendable({ verdict: withNit })).toBe(true);
  });
});

describe("answerEditGate", () => {
  it("is free when no review has ever been opened", () => {
    const gate = answerEditGate({ answerDigest: REWRITTEN_DIGEST, record: undefined, verdictRead: undefined });
    expect(gate).toEqual({ kind: "free", why: "no-review-opened" });
  });

  it("is free when the bytes are the ones already under review", () => {
    const gate = answerEditGate({
      answerDigest: REVIEWED_DIGEST,
      record: recordAt({ round: 3 }),
      verdictRead: present({ verdict: CLEAN_VERDICT }),
    });
    expect(gate).toEqual({ kind: "free", why: "unchanged-since-review" });
  });

  it("is free when the standing verdict named a defect — the fix-and-re-review path stays open", () => {
    const gate = answerEditGate({
      answerDigest: REWRITTEN_DIGEST,
      record: recordAt({ round: 5 }),
      verdictRead: present({ verdict: BROKEN_VERDICT }),
    });
    expect(gate).toEqual({ kind: "free", round: 5, why: "reviewer-named-a-defect" });
  });

  it("needs a reason to discard a verdict that could be posted right now", () => {
    const gate = answerEditGate({
      answerDigest: REWRITTEN_DIGEST,
      record: recordAt({ round: 3 }),
      verdictRead: present({ verdict: CLEAN_VERDICT }),
    });
    expect(gate).toEqual({
      kind: "needs-reason",
      round: 3,
      verdictPath: "${SLOPWEAVER_HOME}/live/slack/reviews/CFIXTUREAA-1788416854.480579/verdict.json",
      why: "discards-a-sendable-verdict",
    });
  });

  it("needs a reason while a round is still reading the bytes being replaced", () => {
    const gate = answerEditGate({
      answerDigest: REWRITTEN_DIGEST,
      record: recordAt({ round: 4 }),
      verdictRead: { kind: "absent" },
    });
    expect(gate).toEqual({ kind: "needs-reason", round: 4, why: "review-in-flight" });
  });

  it("treats a superseded verdict file as no verdict at all, never as this round's finding", () => {
    const gate = answerEditGate({
      answerDigest: REWRITTEN_DIGEST,
      record: recordAt({ round: 4 }),
      verdictRead: { kind: "superseded", verdict: CLEAN_VERDICT, wroteIt: "reviewer workspace workspace:9 (other)" },
    });
    expect(gate).toEqual({ kind: "needs-reason", round: 4, why: "review-in-flight" });
  });

  it("treats an unparseable verdict file the same way", () => {
    const gate = answerEditGate({
      answerDigest: REWRITTEN_DIGEST,
      record: recordAt({ round: 2 }),
      verdictRead: { kind: "invalid", reason: "outcome: expected one of clean|broken|incomplete" },
    });
    expect(gate).toEqual({ kind: "needs-reason", round: 2, why: "review-in-flight" });
  });
});

describe("answerEditRefusalLines", () => {
  it("names the sendable verdict, the digest rule, the cost and the hold it forfeits", () => {
    const lines = answerEditRefusalLines({
      editReasonFlag: "--edit-reason",
      gate: {
        kind: "needs-reason",
        round: 3,
        verdictPath: "${SLOPWEAVER_HOME}/live/slack/reviews/CFIXTUREAA-1788416854.480579/verdict.json",
        why: "discards-a-sendable-verdict",
      },
      leaseExpiresAt: "2026-09-03T09:00:25.809Z",
    });
    expect(lines).toEqual([
      "round 3 returned a verdict you could post RIGHT NOW — clean, with no unresolved high-impact claim — " +
        "bound to the bytes you are about to replace (${SLOPWEAVER_HOME}/live/slack/reviews/CFIXTUREAA-1788416854.480579/verdict.json)",
      "editing them makes that verdict unusable: a new digest needs a new verdict",
      "this edit costs another review round — about 20 minutes — and forfeits the UNCAPPED hold a postable " +
        "verdict has on the clock: while the review stays open the clock is held only for 2h from the current " +
        "round's spawn, and past that the lease as dispatched decides, and it runs out at 2026-09-03T09:00:25.809Z",
      "if the answer is genuinely wrong, that is exactly what this flag is for — a `low`-impact note the reviewer wrote down is not",
      'say why: --edit-reason "<why these bytes had to change>"',
    ]);
  });

  it("names the round still reading the bytes when one is in flight", () => {
    const lines = answerEditRefusalLines({
      editReasonFlag: "--edit-reason",
      gate: { kind: "needs-reason", round: 4, why: "review-in-flight" },
      leaseExpiresAt: "2026-09-03T09:30:25.809Z",
    });
    expect(lines).toEqual([
      "round 4 is still reading the bytes you are about to replace, so its verdict will bind to an answer " +
        "that no longer exists and cannot be posted with",
      "this edit costs another review round — about 20 minutes — and forfeits the UNCAPPED hold a postable " +
        "verdict has on the clock: while the review stays open the clock is held only for 2h from the current " +
        "round's spawn, and past that the lease as dispatched decides, and it runs out at 2026-09-03T09:30:25.809Z",
      'if the edit is worth that, say why: --edit-reason "<why these bytes had to change>"',
    ]);
  });
});
