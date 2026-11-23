/**
 * `reviewPollTruth` — what a poll reports from the verdict file and the reviewer's liveness: a bound or
 * mismatched verdict, working, phantom, superseded or unreadable. Pure: a literal in, a classification out.
 */
import { describe, expect, it } from "vitest";

import { reviewPollLines, reviewPollTruth } from "../../../../../live/turn/reviewPoll.js";
import { RECORD, REVIEWER } from "./harness.js";

/** cmux corroborating the reviewer's own pickup — the delivery every truth here is judged under unless it says otherwise. */
const DELIVERED = { kind: "confirmed" as const, submittedAtIso: "2026-08-25T00:00:01.000Z" };

/** Ten minutes after the record's `spawnedAt`, so any `never-started` arm would be past its bound if it applied. */
const NOW = "2026-08-25T00:10:00.000Z";

describe("reviewPollTruth", () => {
  const alive = { kind: "alive" as const, pid: 1, process: "2.1.241", workspaceId: REVIEWER.workspaceId };
  const gone = {
    kind: "phantom" as const,
    reason: "the workspace is gone",
    why: "workspace-gone" as const,
    workspaceId: REVIEWER.workspaceId,
  };

  it("reports the verdict, bound, when the file exists with this answer's digest — whatever liveness says", () => {
    const truth = reviewPollTruth({
      delivery: DELIVERED,
      nowIso: NOW,
      liveness: gone,
      record: RECORD,
      screen: undefined,
      verdictRead: {
        kind: "present",
        verdict: {
          answerDigest: RECORD.answerDigest,
          authorSession: RECORD.authorSession,
          claims: [],
          outcome: "clean",
          reviewerSession: RECORD.reviewerSession,
          schemaVersion: 1,
        },
      },
    });
    expect(truth).toStrictEqual({ digestMatches: true, kind: "verdict", outcome: "clean", path: RECORD.verdictPath });
  });

  it("flags a verdict bound to different bytes rather than passing it along as done", () => {
    const truth = reviewPollTruth({
      delivery: DELIVERED,
      nowIso: NOW,
      liveness: alive,
      record: RECORD,
      screen: undefined,
      verdictRead: {
        kind: "present",
        verdict: {
          answerDigest: "sha256:" + "b".repeat(64),
          authorSession: RECORD.authorSession,
          claims: [],
          outcome: "clean",
          reviewerSession: RECORD.reviewerSession,
          schemaVersion: 1,
        },
      },
    });
    expect(truth).toStrictEqual({ digestMatches: false, kind: "verdict", outcome: "clean", path: RECORD.verdictPath });
    expect(reviewPollLines({ truth }).done).toBe(false);
  });

  it("reports working while the file is absent and the reviewer is alive", () => {
    expect(
      reviewPollTruth({
        delivery: DELIVERED,
        nowIso: NOW,
        liveness: alive,
        record: RECORD,
        screen: undefined,
        verdictRead: { kind: "absent" },
      }),
    ).toStrictEqual({
      kind: "working",
      reconciledDoubt: undefined,
    });
  });

  it("reports phantom when the file is absent and the reviewer's workspace holds nothing", () => {
    expect(
      reviewPollTruth({
        delivery: DELIVERED,
        nowIso: NOW,
        liveness: gone,
        record: RECORD,
        screen: undefined,
        verdictRead: { kind: "absent" },
      }),
    ).toStrictEqual({
      kind: "phantom",
      reason: "the workspace is gone",
      why: "workspace-gone",
    });
  });

  it("reports a PREVIOUS round's verdict as superseded, never as this review's verdict", () => {
    const truth = reviewPollTruth({
      delivery: DELIVERED,
      nowIso: NOW,
      liveness: alive,
      record: RECORD,
      screen: undefined,
      verdictRead: {
        kind: "superseded",
        verdict: {
          answerDigest: RECORD.answerDigest,
          authorSession: RECORD.authorSession,
          claims: [],
          outcome: "clean",
          reviewerSession: "reviewer workspace workspace:3 (id-workspace:3)",
          schemaVersion: 1,
        },
        wroteIt: "reviewer workspace workspace:3 (id-workspace:3)",
      },
    });
    expect(truth).toStrictEqual({
      kind: "superseded",
      path: RECORD.verdictPath,
      wroteIt: "reviewer workspace workspace:3 (id-workspace:3)",
    });
  });

  it("prefers a dead workspace over a superseded file — the reviewer is gone either way", () => {
    const truth = reviewPollTruth({
      delivery: DELIVERED,
      nowIso: NOW,
      liveness: gone,
      record: RECORD,
      screen: undefined,
      verdictRead: {
        kind: "superseded",
        verdict: {
          answerDigest: RECORD.answerDigest,
          authorSession: RECORD.authorSession,
          claims: [],
          outcome: "clean",
          reviewerSession: "reviewer workspace workspace:3 (id-workspace:3)",
          schemaVersion: 1,
        },
        wroteIt: "reviewer workspace workspace:3 (id-workspace:3)",
      },
    });
    expect(truth).toStrictEqual({ kind: "phantom", reason: "the workspace is gone", why: "workspace-gone" });
  });

  it("consults liveness even when an unreadable file is present, so a dead reviewer is not called unreadable", () => {
    expect(
      reviewPollTruth({
        delivery: DELIVERED,
        nowIso: NOW,
        liveness: gone,
        record: RECORD,
        screen: undefined,
        verdictRead: { kind: "invalid", reason: "outcome: bad" },
      }),
    ).toStrictEqual({ kind: "phantom", reason: "the workspace is gone", why: "workspace-gone" });
  });

  it("reports an unreadable verdict as such, never as still working", () => {
    expect(
      reviewPollTruth({
        delivery: DELIVERED,
        nowIso: NOW,
        liveness: alive,
        record: RECORD,
        screen: undefined,
        verdictRead: { kind: "invalid", reason: "outcome: bad" },
      }),
    ).toStrictEqual({ kind: "unreadable", reason: "outcome: bad" });
  });
});
