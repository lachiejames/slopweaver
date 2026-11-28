/*
 * Which inline comments a description review reads as history, and the one-way check that a thread its review read
 * as history is not live again. Synthetic values only.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { buildDescriptionManifest } from "../../../../outbound/github/descriptionReview.js";
import {
  type DescriptionReviewAdmission,
  historyStillHolds,
  reviewedHistoricalThreadIds,
} from "../../../../outbound/github/descriptionReviewGate.js";
import {
  historicalReviewThreadIds,
  markSupersededReviewComments,
  reactivatedHistoryThreadIds,
} from "../../../../outbound/github/descriptionReviewHistory.js";
import type {
  ExistingPullRequestComment,
  HistoryBoundReceipt,
} from "../../../../outbound/github/descriptionReviewTypes.js";

/** One inline comment in thread `threadId`, open and not superseded unless overridden. */
function inline({
  id,
  threadId,
  threadResolved = false,
  supersededByThisWrite = false,
}: {
  id: string;
  threadId: string;
  threadResolved?: boolean;
  supersededByThisWrite?: boolean;
}): ExistingPullRequestComment {
  return {
    authorLogin: "quillfeather",
    body: `comment ${id}`,
    createdAtIso: "2026-11-17T00:00:00Z",
    id,
    kind: "review-comment",
    originalLine: 3,
    path: "src/a.ts",
    supersededByThisWrite,
    threadId,
    threadResolved,
    updatedAtIso: "2026-11-17T00:00:00Z",
    url: `https://github.com/acme/widgets/pull/7#discussion_${id}`,
  };
}

/** A conversation comment, which has no thread and is never history. */
const CONVERSATION: ExistingPullRequestComment = {
  authorLogin: "quillfeather",
  body: "Does this hold for a work account too?",
  createdAtIso: "2026-11-17T00:00:00Z",
  id: "IC_1",
  kind: "issue-comment",
  updatedAtIso: "2026-11-17T00:00:00Z",
  url: "https://github.com/acme/widgets/pull/7#issuecomment-1",
};

const MANIFEST = buildDescriptionManifest({
  baseBranch: "main",
  body: "A body.",
  changeDigest: "c".repeat(64),
  comments: [],
  existingComments: [],
  images: [],
  repository: "acme/widgets",
  rulesSha256: "r".repeat(64),
  title: "fix: a title",
});

/** A CLEAN receipt recording `history` as the threads its reviewer read as history. */
function receiptOf({ history }: { history: readonly string[] }): HistoryBoundReceipt {
  return {
    historicalReviewThreadIds: history,
    manifest: MANIFEST,
    manifestSha256: "m".repeat(64),
    preparationId: "prep-1",
    preparedBy: null,
    receiptId: "receipt-1",
    recordedAtIso: "2026-11-17T01:06:00.000Z",
    recordedBy: null,
    reviewId: "pass-1",
    reviewer: "codex",
    schemaVersion: 3,
    summary: "all five hold",
    verdict: "CLEAN",
  };
}

/** An exact admission on {@link receiptOf}. */
function admission({ history }: { history: readonly string[] }): DescriptionReviewAdmission {
  return { kind: "exact", receipt: receiptOf({ history }) };
}

describe("markSupersededReviewComments", () => {
  it("marks every comment in a thread this write resolves, and leaves every other comment as it was", () => {
    const marked = markSupersededReviewComments({
      comments: [inline({ id: "c1", threadId: "T1" }), inline({ id: "c2", threadId: "T2" }), CONVERSATION],
      supersededThreadIds: ["T1"],
    });
    expect(marked).toStrictEqual([
      inline({ id: "c1", supersededByThisWrite: true, threadId: "T1" }),
      inline({ id: "c2", threadId: "T2" }),
      CONVERSATION,
    ]);
  });

  it("marks nothing when the write resolves no thread", () => {
    const comments = [inline({ id: "c1", threadId: "T1" })];
    expect(markSupersededReviewComments({ comments, supersededThreadIds: [] })).toStrictEqual(comments);
  });
});

describe("historicalReviewThreadIds", () => {
  it("names each resolved or superseded thread once, sorted, and no open one", () => {
    const ids = historicalReviewThreadIds({
      comments: [
        inline({ id: "c1", threadId: "T3", threadResolved: true }),
        inline({ id: "c2", threadId: "T3", threadResolved: true }),
        inline({ id: "c3", supersededByThisWrite: true, threadId: "T1" }),
        inline({ id: "c4", threadId: "T2" }),
        CONVERSATION,
      ],
    });
    expect(ids).toStrictEqual(["T1", "T3"]);
  });

  it("is empty for a pull request with no inline comments", () => {
    expect(historicalReviewThreadIds({ comments: [CONVERSATION] })).toStrictEqual([]);
  });
});

describe("reactivatedHistoryThreadIds", () => {
  it("names a thread reviewed as history that is open again and not resolved by this write", () => {
    const ids = reactivatedHistoryThreadIds({
      currentComments: [inline({ id: "c1", threadId: "T1" }), inline({ id: "c2", threadId: "T2" })],
      reviewedHistoricalThreadIds: ["T1"],
    });
    expect(ids).toStrictEqual(["T1"]);
  });

  it("names nothing while every reviewed-as-history thread is still resolved or superseded", () => {
    const ids = reactivatedHistoryThreadIds({
      currentComments: [
        inline({ id: "c1", threadId: "T1", threadResolved: true }),
        inline({ id: "c2", supersededByThisWrite: true, threadId: "T2" }),
      ],
      reviewedHistoricalThreadIds: ["T1", "T2"],
    });
    expect(ids).toStrictEqual([]);
  });

  it("never names a thread reviewed as live that resolved since: the reviewer weighed more than it had to", () => {
    const ids = reactivatedHistoryThreadIds({
      currentComments: [inline({ id: "c1", threadId: "T1", threadResolved: true })],
      reviewedHistoricalThreadIds: [],
    });
    expect(ids).toStrictEqual([]);
  });

  it("never names a reviewed thread that is no longer on the pull request", () => {
    expect(reactivatedHistoryThreadIds({ currentComments: [], reviewedHistoricalThreadIds: ["T1"] })).toStrictEqual([]);
  });
});

describe("historyStillHolds", () => {
  it("keeps the admission while the threads its review read as history still are", () => {
    const held = historyStillHolds({
      admission: admission({ history: ["T1"] }),
      currentComments: [inline({ id: "c1", threadId: "T1", threadResolved: true })],
    });
    expect(unwrap(held).receipt.receiptId).toBe("receipt-1");
  });

  it("refuses once a thread its review read as history is unresolved again, naming the receipt and the thread", () => {
    const failure = unwrapErr(
      historyStillHolds({
        admission: admission({ history: ["T1"] }),
        currentComments: [inline({ id: "c1", threadId: "T1" })],
      }),
    );
    expect(failure.code).toBe("REVIEW_HISTORY_REACTIVATED");
    expect(failure.message).toContain("receipt-1");
    expect(failure.message).toContain("T1");
  });
});

describe("reviewedHistoricalThreadIds", () => {
  it("reads a schema-2 receipt, whose reviewer saw every comment as live, as naming no history", () => {
    const { historicalReviewThreadIds: _history, ...fields } = receiptOf({ history: ["T1"] });
    expect(reviewedHistoricalThreadIds({ receipt: { ...fields, schemaVersion: 2 } })).toStrictEqual([]);
  });
});
