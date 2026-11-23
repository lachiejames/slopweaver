/**
 * The four blinders a FIRST answer used to leave over a dead builder, and the lease it re-arms.
 *
 * Every instant is the incident's own: ask `C0SYN000010/1790924298.202269`, dispatched 06:59:55.295Z
 * with a lease to 08:59:55.295Z, a ready marker recorded 07:29:27.776Z, the plan posted 07:34:58.645Z, and so a
 * re-armed lease to 09:34:58.645Z. Each case pairs the post-plan behaviour with the pre-plan one so that a
 * regression to "the plan's own artefacts are the build's truth" fails here rather than in a thread.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { DispatchedEvent, FirstAnsweredEvent } from "../../../../live/ask/lifecycle.js";
import { answerEditGate } from "../../../../live/turn/answerFreeze.js";
import { dispatchIdOf, sweepDecision } from "../../../../live/turn/dispatch.js";
import { followThroughAdmissible } from "../../../../live/turn/firstAnswer.js";
import type { ReviewPosture } from "../../../../live/turn/leaseJudgement.js";
import type { ReviewRecord } from "../../../../live/turn/review.js";
import { verdictUnposted } from "../../../../live/turn/reviewPosture.js";
import { effectiveLeaseExpiresAt } from "../../../../live/turn/tier.js";
import { type DurableTurnMarker, markerOutlivesFirstAnswer } from "../../../../live/turn/turnMarkerStore.js";

const ASK = { channel: "C0SYN000010", messageTs: "1790924298.202269", threadTs: "1790924298.202269" };
const GEN1_LEASE = "2026-10-02T08:59:55.295Z";
const PLAN_AT = "2026-10-02T07:34:58.645Z";
const REARMED_LEASE = "2026-10-02T09:34:58.645Z";
const PLAN_DIGEST = `sha256:${"a".repeat(64)}`;
const FINAL_DIGEST = `sha256:${"b".repeat(64)}`;

const DISPATCHED: DispatchedEvent = {
  ...ASK,
  decision: {
    confidence: "high",
    needs: [],
    rationale: "worth answering",
    response: "respond",
    schemaVersion: 1,
    tier: "fresh-visible-session",
    truthMode: "current",
  },
  kind: "dispatched",
  leaseExpiresAt: GEN1_LEASE,
  tier: "fresh-visible-session",
  tsIso: "2026-10-02T06:59:55.295Z",
};

const FIRST_ANSWER: FirstAnsweredEvent = {
  ...ASK,
  answerDigest: PLAN_DIGEST,
  answerTs: "1790926498.645000",
  kind: "first-answered",
  leaseExpiresAt: REARMED_LEASE,
  owes: "pull-requests",
  tsIso: PLAN_AT,
  what: "open the two pull requests the plan names",
};

const NO_REVIEW: ReviewPosture = { hasUsableVerdict: false, inFlight: false, recordOpen: false, spawnedAt: undefined };
const PHANTOM = { kind: "phantom", reason: "nothing behind the green light", workspaceId: "ws-gone" } as const;

/** A ready marker for this generation, recorded at the instant the caller names (or with none). */
function readyMarker({ recordedAtIso }: { recordedAtIso?: string }): DurableTurnMarker {
  return {
    answerPath: "/tmp/answer.json",
    dispatchId: dispatchIdOf({ askIdentity: ASK }),
    kind: "ready",
    leaseExpiresAt: GEN1_LEASE,
    ...(recordedAtIso === undefined ? {} : { recordedAtIso }),
  };
}

describe("effectiveLeaseExpiresAt", () => {
  it("is the dispatch's own lease when no first answer stands", () => {
    expect(effectiveLeaseExpiresAt({ activeDispatch: DISPATCHED })).toBe(GEN1_LEASE);
  });

  it("is the re-armed lease once the plan is posted, because it ends later", () => {
    expect(effectiveLeaseExpiresAt({ activeDispatch: DISPATCHED, firstAnswer: FIRST_ANSWER })).toBe(REARMED_LEASE);
  });

  it("never lets an earlier generation's plan SHORTEN a re-dispatch's fresh lease", () => {
    const gen2 = { leaseExpiresAt: "2026-10-02T09:56:00.000Z" };

    expect(effectiveLeaseExpiresAt({ activeDispatch: gen2, firstAnswer: FIRST_ANSWER })).toBe(
      "2026-10-02T09:56:00.000Z",
    );
  });

  it("ignores an unparseable re-armed lease rather than trusting it", () => {
    expect(
      effectiveLeaseExpiresAt({ activeDispatch: DISPATCHED, firstAnswer: { leaseExpiresAt: "not an instant" } }),
    ).toBe(GEN1_LEASE);
  });
});

describe("markerOutlivesFirstAnswer — the plan's own ready marker is not the build's", () => {
  it("ignores the 07:29:27.776Z ready marker once the 07:34:58.645Z plan is posted", () => {
    expect(
      markerOutlivesFirstAnswer({
        marker: readyMarker({ recordedAtIso: "2026-10-02T07:29:27.776Z" }),
        notBeforeIso: PLAN_AT,
      }),
    ).toBe(false);
  });

  it("is the pair: the same marker is honoured when no first answer stands", () => {
    expect(
      markerOutlivesFirstAnswer({
        marker: readyMarker({ recordedAtIso: "2026-10-02T07:29:27.776Z" }),
        notBeforeIso: undefined,
      }),
    ).toBe(true);
  });

  it("honours a ready marker the build wrote after the plan", () => {
    expect(
      markerOutlivesFirstAnswer({
        marker: readyMarker({ recordedAtIso: "2026-10-02T07:40:00.000Z" }),
        notBeforeIso: PLAN_AT,
      }),
    ).toBe(true);
  });

  it("ignores an undated ready marker only when a first answer stands", () => {
    expect(markerOutlivesFirstAnswer({ marker: readyMarker({}), notBeforeIso: PLAN_AT })).toBe(false);
    expect(markerOutlivesFirstAnswer({ marker: readyMarker({}), notBeforeIso: undefined })).toBe(true);
  });

  it("always honours a failed marker, undated as every failed marker is, because its report outranks the plan", () => {
    const failed: DurableTurnMarker = {
      dispatchId: dispatchIdOf({ askIdentity: ASK }),
      kind: "failed",
      leaseExpiresAt: GEN1_LEASE,
      reason: "no access to the repo",
    };

    expect(markerOutlivesFirstAnswer({ marker: failed, notBeforeIso: PLAN_AT })).toBe(true);
  });
});

describe("verdictUnposted — a verdict over the posted plan buys the lease nothing", () => {
  it("is false when the reviewed bytes are the ones the first answer posted", () => {
    expect(verdictUnposted({ postedDigest: PLAN_DIGEST, reviewedDigest: PLAN_DIGEST })).toBe(false);
  });

  it("is true for a verdict over the final answer's different bytes", () => {
    expect(verdictUnposted({ postedDigest: PLAN_DIGEST, reviewedDigest: FINAL_DIGEST })).toBe(true);
  });

  it("is true when nothing has been posted yet", () => {
    expect(verdictUnposted({ postedDigest: undefined, reviewedDigest: PLAN_DIGEST })).toBe(true);
  });
});

describe("answerEditGate — the final answer over a posted plan discards nothing", () => {
  const RECORD: ReviewRecord = {
    answerDigest: PLAN_DIGEST,
    answerPath: "${SLOPWEAVER_HOME}/tmp/answer.json",
    authorSession: "author claude-code session a",
    carriedUnresolved: [],
    channel: ASK.channel,
    messageTs: ASK.messageTs,
    packetPath: "${SLOPWEAVER_HOME}/live/slack/reviews/C0SYN000010-1790924298.202269/packet.md",
    reviewer: {
      host: "claude-code",
      surfaceId: "surface-uuid",
      surfaceRef: "surface:2",
      workspaceId: "workspace-uuid",
      workspaceRef: "workspace:1",
    },
    reviewerSession: "reviewer workspace workspace:1 (workspace-uuid)",
    round: 1,
    schemaVersion: 2,
    spawnedAt: "2026-10-02T07:30:00.000Z",
    threadTs: ASK.threadTs,
    verdictPath: "${SLOPWEAVER_HOME}/live/slack/reviews/C0SYN000010-1790924298.202269/verdict.json",
  };
  const CLEAN_PLAN_VERDICT = {
    kind: "present",
    verdict: {
      answerDigest: PLAN_DIGEST,
      authorSession: "author claude-code session a",
      claims: [{ evidence: "the plan", impact: "high", support: "supported", text: "two PRs are named" }],
      outcome: "clean",
      reviewerSession: "reviewer workspace workspace:1 (workspace-uuid)",
      schemaVersion: 1,
    },
  } as const;

  it("frees the final answer when the reviewed bytes are the posted plan", () => {
    expect(
      answerEditGate({
        answerDigest: FINAL_DIGEST,
        postedDigest: PLAN_DIGEST,
        record: RECORD,
        verdictRead: CLEAN_PLAN_VERDICT,
      }),
    ).toEqual({ kind: "free", why: "already-posted" });
  });

  it("is the pair: without the posted digest, the same edit discards a sendable verdict", () => {
    expect(answerEditGate({ answerDigest: FINAL_DIGEST, record: RECORD, verdictRead: CLEAN_PLAN_VERDICT }).kind).toBe(
      "needs-reason",
    );
  });
});

describe("sweepDecision — judged on the effective lease after a first answer", () => {
  it("reports phantom at 09:10Z under the re-armed lease, so the dead builder is seen", () => {
    expect(
      sweepDecision({
        ask: ASK,
        dispatched: DISPATCHED,
        firstAnswer: FIRST_ANSWER,
        nowIso: "2026-10-02T09:10:00.000Z",
        review: NO_REVIEW,
        screenTruth: PHANTOM,
      }),
    ).toEqual({ ask: ASK, kind: "phantom", reason: "nothing behind the green light" });
  });

  it("is the pair: the original lease alone reads the same instant as lease-expired", () => {
    expect(
      sweepDecision({
        ask: ASK,
        dispatched: DISPATCHED,
        nowIso: "2026-10-02T09:10:00.000Z",
        review: NO_REVIEW,
        screenTruth: PHANTOM,
      }),
    ).toEqual({ ask: ASK, kind: "lease-expired" });
  });

  it("gives a live builder past the re-armed lease the capped reprieve as still-working", () => {
    expect(
      sweepDecision({
        ask: ASK,
        dispatched: DISPATCHED,
        firstAnswer: FIRST_ANSWER,
        nowIso: "2026-10-02T10:30:00.000Z",
        readyWorkerAlive: true,
        review: NO_REVIEW,
        screenTruth: { kind: "working" },
      }),
    ).toEqual({ ask: ASK, kind: "still-working" });
  });

  it("ends that reprieve at the hold cap past the re-armed lease", () => {
    expect(
      sweepDecision({
        ask: ASK,
        dispatched: DISPATCHED,
        firstAnswer: FIRST_ANSWER,
        nowIso: "2026-10-02T11:34:58.645Z",
        readyWorkerAlive: true,
        review: NO_REVIEW,
        screenTruth: { kind: "working" },
      }),
    ).toEqual({ ask: ASK, kind: "lease-expired" });
  });

  it("is not held by the plan's own clean verdict once the posture is read with the posted digest", () => {
    const posture: ReviewPosture = {
      hasUsableVerdict: verdictUnposted({ postedDigest: PLAN_DIGEST, reviewedDigest: PLAN_DIGEST }),
      inFlight: false,
      recordOpen: true,
      spawnedAt: "2026-10-02T07:30:00.000Z",
    };

    expect(
      sweepDecision({
        ask: ASK,
        dispatched: DISPATCHED,
        firstAnswer: FIRST_ANSWER,
        nowIso: "2026-10-02T09:10:00.000Z",
        review: posture,
        screenTruth: PHANTOM,
      }),
    ).toEqual({ ask: ASK, kind: "phantom", reason: "nothing behind the green light" });
  });
});

describe("followThroughAdmissible — one plan per turn", () => {
  it("admits a plan when none stands", () => {
    expect(unwrap(followThroughAdmissible({ declaresFollowThrough: true, standing: undefined }))).toBeUndefined();
  });

  it("admits the final answer over a standing plan", () => {
    expect(unwrap(followThroughAdmissible({ declaresFollowThrough: false, standing: FIRST_ANSWER }))).toBeUndefined();
  });

  it("refuses a second plan, naming the one already posted", () => {
    const refused = unwrapErr(followThroughAdmissible({ declaresFollowThrough: true, standing: FIRST_ANSWER }));

    expect(refused.code).toBe("FIRST_ANSWER_STANDS");
    expect(refused.answerTs).toBe("1790926498.645000");
    expect(refused.postedIso).toBe(PLAN_AT);
  });
});
