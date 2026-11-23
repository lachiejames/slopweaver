/**
 * `lateVerdictArchiveInstant`, `lateReviewerVerdictBreakage`, `verdictSpeaksForReviewer` and
 * `reviewerDeathBreakage` — telling a late or foreign verdict from this reviewer's own, and the
 * loop-breakage rows a late verdict or a dead reviewer leaves. Pure: a literal in, a value out.
 */
import { describe, expect, it } from "vitest";

import {
  lateReviewerVerdictBreakage,
  lateVerdictArchiveInstant,
  reviewerDeathBreakage,
  verdictSpeaksForReviewer,
} from "../../../../../live/turn/reviewPoll.js";
import { RECORD, REVIEWER } from "./harness.js";

describe("lateVerdictArchiveInstant", () => {
  it("places a late verdict one millisecond BEFORE the round that displaced it", () => {
    expect(lateVerdictArchiveInstant({ record: RECORD })).toBe("2026-08-24T23:59:59.999Z");
  });
});

describe("lateReviewerVerdictBreakage", () => {
  it("names the foreign writer, the round it landed over and where it went — what a reader an hour later needs", () => {
    const breakage = lateReviewerVerdictBreakage({
      archivedPath:
        "/tmp/reviews/C1-1785000000.000100/verdict-superseded-reviewer-workspace-workspace-3-id-workspace-3-2026-08-24T23-59-59-999Z.json",
      atIso: "2026-08-25T00:05:00.000Z",
      record: RECORD,
      wroteIt: "reviewer workspace workspace:3 (id-workspace:3)",
    });
    expect(breakage).toStrictEqual({
      atIso: "2026-08-25T00:05:00.000Z",
      cause:
        "the previous round's reviewer wrote its verdict after this round opened, so the archive at round open " +
        "had nothing to move and the fixed verdict path held a verdict that speaks for no reviewer now recorded",
      didInstead:
        "turn review --poll archived it to /tmp/reviews/C1-1785000000.000100/verdict-superseded-reviewer-workspace-workspace-3-id-workspace-3-2026-08-24T23-59-59-999Z.json " +
        "and kept polling reviewer workspace workspace:9 (id-workspace:9), whose own verdict lands at the same path",
      error:
        "/tmp/reviews/C1-1785000000.000100/verdict.json holds a PREVIOUS round's verdict, written by reviewer workspace workspace:3 (id-workspace:3)",
      thread: "C1/1785000000.000100",
      what:
        "turn review --poll found a late verdict from reviewer workspace workspace:3 (id-workspace:3) over the round " +
        "spawned 2026-08-25T00:00:00.000Z (reviewer workspace workspace:9 (id-workspace:9)) — archived as " +
        "verdict-superseded-reviewer-workspace-workspace-3-id-workspace-3-2026-08-24T23-59-59-999Z.json",
    });
  });
});

describe("verdictSpeaksForReviewer", () => {
  const verdict = {
    answerDigest: RECORD.answerDigest,
    authorSession: RECORD.authorSession,
    claims: [],
    outcome: "clean" as const,
    reviewerSession: RECORD.reviewerSession,
    schemaVersion: 1 as const,
  };

  it("accepts the recorded reviewer's own verdict", () => {
    expect(verdictSpeaksForReviewer({ reviewerSession: RECORD.reviewerSession, verdict })).toBe(true);
  });

  it("rejects a verdict whose reviewer is a different round, even on the same digest", () => {
    expect(
      verdictSpeaksForReviewer({
        reviewerSession: RECORD.reviewerSession,
        verdict: { ...verdict, reviewerSession: "reviewer workspace workspace:3 (id-workspace:3)" },
      }),
    ).toBe(false);
  });
});

describe("reviewerDeathBreakage", () => {
  it("carries the LAST KNOWN STATE — which workspace, which session, spawned when, bound to what", () => {
    const breakage = reviewerDeathBreakage({
      atIso: "2026-08-26T08:40:38.000Z",
      record: RECORD,
      truth: { kind: "phantom", reason: "cmux has no workspace id-workspace:9", why: "workspace-gone" },
    });
    expect(breakage.atIso).toBe("2026-08-26T08:40:38.000Z");
    expect(breakage.thread).toBe("C1/1785000000.000100");
    expect(breakage.error).toBe("cmux has no workspace id-workspace:9");
    // The two absent fields say the RECORD never held one, rather than printing a placeholder a reader could
    // mistake for the session's actual name.
    expect(breakage.what).toBe(
      "the reviewer for this ask died before writing a verdict — workspace workspace:9 (id-workspace:9), " +
        "session (the record carries no session name), host claude-code, spawned 2026-08-25T00:00:00.000Z, " +
        `bound to ${RECORD.answerDigest}, cwd (the record carries no cwd), cause workspace-gone`,
    );
    expect(breakage.didInstead).toBe(
      `reported the death to the poll's caller and left ${RECORD.verdictPath} untouched; the answer still has ` +
        "no verdict, so re-run turn review to open a fresh reviewer",
    );
  });

  it("names the session and cwd when the record has them, so two deaths are told apart", () => {
    const breakage = reviewerDeathBreakage({
      atIso: "2026-08-26T08:40:38.000Z",
      record: {
        ...RECORD,
        reviewer: { ...REVIEWER, cwd: "/w/loop", sessionName: "review-C1-1785000000.000100" },
      },
      truth: { kind: "phantom", reason: "the host exited", why: "host-exited" },
    });
    expect(breakage.what).toContain("session review-C1-1785000000.000100");
    expect(breakage.what).toContain("cwd /w/loop");
    expect(breakage.what).toContain("cause host-exited");
  });
});
