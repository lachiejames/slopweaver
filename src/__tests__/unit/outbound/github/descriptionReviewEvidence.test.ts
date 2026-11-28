/*
 * The comments a description review judges on an open pull request: read once, and the threads a self-review round
 * resolves in the same write marked superseded, read off the same ledger the round's send reads. A real ledger in a
 * throwaway home; the comment read is a plain function. Synthetic values only.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { DescriptionReviewCommentsReader } from "../../../../outbound/github/descriptionReviewComments.js";
import { DescriptionReviewErrors } from "../../../../outbound/github/descriptionReviewErrors.js";
import { readDescriptionReviewEvidence } from "../../../../outbound/github/descriptionReviewEvidence.js";
import type {
  DescriptionReviewComment,
  ExistingPullRequestComment,
} from "../../../../outbound/github/descriptionReviewTypes.js";
import {
  confirmSelfReviewRound,
  reserveSelfReviewRound,
  selfReviewLocus,
} from "../../../../outbound/github/selfReviewLedger.js";
import { stateHomePaths } from "../../../../stateHome.js";

const homes: string[] = [];

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-review-evidence-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

const LOCUS = selfReviewLocus({ number: 7, owner: "acme", repo: "widgets" });

/** One open inline comment in thread `threadId`. */
function inline({ id, threadId }: { id: string; threadId: string }): ExistingPullRequestComment {
  return {
    authorLogin: "quillfeather",
    body: `comment ${id}`,
    createdAtIso: "2026-11-17T00:00:00Z",
    id,
    kind: "review-comment",
    originalLine: 3,
    path: "src/a.ts",
    supersededByThisWrite: false,
    threadId,
    threadResolved: false,
    updatedAtIso: "2026-11-17T00:00:00Z",
    url: `https://github.com/acme/widgets/pull/7#discussion_${id}`,
  };
}

const ON_THE_PULL_REQUEST = [inline({ id: "c1", threadId: "T_OLD" }), inline({ id: "c2", threadId: "T_PEER" })];

/** A reader answering pull request `PR_7` with {@link ON_THE_PULL_REQUEST}, counting each read. */
function reader(): { readonly read: DescriptionReviewCommentsReader; readonly reads: number[] } {
  const reads: number[] = [];
  const read: DescriptionReviewCommentsReader = ({ number }) => {
    reads.push(number);
    return Promise.resolve(ok({ comments: ON_THE_PULL_REQUEST, pullRequestId: "PR_7" }));
  };
  return { read, reads };
}

/** The outgoing inline comment of a self-review round. */
const OUTGOING: readonly DescriptionReviewComment[] = [
  { body: "💡 The corrected walkthrough.", line: 3, path: "src/a.ts" },
];

/** Record a confirmed round on `pullRequestId` owning `threadIds`, the way a round's send does. */
function confirmRound({
  home,
  pullRequestId,
  threadIds,
}: {
  home: string;
  pullRequestId: string;
  threadIds: readonly string[];
}): void {
  const intent = {
    formHash: "f".repeat(64),
    headSha: "a".repeat(40),
    locus: LOCUS,
    reservedIso: "2026-11-17T00:00:00Z",
  };
  expect(reserveSelfReviewRound({ home, intent, pullRequestId }).kind).toBe("fresh");
  expect(
    confirmSelfReviewRound({
      home,
      record: {
        confirmedIso: "2026-11-17T00:01:00Z",
        formHash: intent.formHash,
        headSha: intent.headSha,
        locus: LOCUS,
        pullRequestId,
        threadIds,
      },
    }).kind,
  ).toBe("confirmed");
}

describe("readDescriptionReviewEvidence", () => {
  it("marks the previous round this self-review write resolves as superseded, and only that thread", async () => {
    const home = freshHome();
    confirmRound({ home, pullRequestId: "PR_7", threadIds: ["T_OLD"] });
    const { read } = reader();
    const comments = unwrap(
      await readDescriptionReviewEvidence({
        home,
        number: 7,
        outgoingComments: OUTGOING,
        owner: "acme",
        readComments: read,
        repo: "widgets",
      }),
    );
    expect(comments).toStrictEqual([
      { ...inline({ id: "c1", threadId: "T_OLD" }), supersededByThisWrite: true },
      inline({ id: "c2", threadId: "T_PEER" }),
    ]);
  });

  it("marks nothing for a write posting no inline comments, which resolves no round", async () => {
    const home = freshHome();
    confirmRound({ home, pullRequestId: "PR_7", threadIds: ["T_OLD"] });
    const { read, reads } = reader();
    const comments = unwrap(
      await readDescriptionReviewEvidence({
        home,
        number: 7,
        outgoingComments: [],
        owner: "acme",
        readComments: read,
        repo: "widgets",
      }),
    );
    expect(comments).toStrictEqual(ON_THE_PULL_REQUEST);
    expect(reads).toStrictEqual([7]);
  });

  it("marks nothing when the round on record belongs to another pull request at the same address", async () => {
    const home = freshHome();
    confirmRound({ home, pullRequestId: "PR_RENAMED_AWAY", threadIds: ["T_OLD"] });
    const { read } = reader();
    const comments = unwrap(
      await readDescriptionReviewEvidence({
        home,
        number: 7,
        outgoingComments: OUTGOING,
        owner: "acme",
        readComments: read,
        repo: "widgets",
      }),
    );
    expect(comments).toStrictEqual(ON_THE_PULL_REQUEST);
  });

  it("marks nothing on a first round, with no ledger yet", async () => {
    const { read } = reader();
    const comments = unwrap(
      await readDescriptionReviewEvidence({
        home: freshHome(),
        number: 7,
        outgoingComments: OUTGOING,
        owner: "acme",
        readComments: read,
        repo: "widgets",
      }),
    );
    expect(comments).toStrictEqual(ON_THE_PULL_REQUEST);
  });

  it("refuses when the round on record cannot be trusted, rather than reading it as no round", async () => {
    const home = freshHome();
    const directory = join(stateHomePaths({ home }).ledgers, "github-self-reviews");
    mkdirSync(directory, { recursive: true });
    const name = createHash("sha256").update(LOCUS, "utf8").digest("hex").slice(0, 32);
    writeFileSync(join(directory, `${name}.json`), "not a round");
    const { read } = reader();
    const failure = unwrapErr(
      await readDescriptionReviewEvidence({
        home,
        number: 7,
        outgoingComments: OUTGOING,
        owner: "acme",
        readComments: read,
        repo: "widgets",
      }),
    );
    expect(failure.code).toBe("COMMENTS_READ_FAILED");
    expect(failure.message).toContain("is there but cannot be trusted");
  });

  it("refuses while another round is reserved, whose send would resolve nothing, rather than marking it superseded", async () => {
    const home = freshHome();
    confirmRound({ home, pullRequestId: "PR_7", threadIds: ["T_OLD"] });
    const pending = {
      formHash: "e".repeat(64),
      headSha: "b".repeat(40),
      locus: LOCUS,
      reservedIso: "2026-11-18T00:00:00Z",
    };
    expect(reserveSelfReviewRound({ home, intent: pending, pullRequestId: "PR_7" }).kind).toBe("fresh");
    const { read } = reader();
    const failure = unwrapErr(
      await readDescriptionReviewEvidence({
        home,
        number: 7,
        outgoingComments: OUTGOING,
        owner: "acme",
        readComments: read,
        repo: "widgets",
      }),
    );
    expect(failure.code).toBe("SELF_REVIEW_RESERVED");
    expect(failure.message).toContain(
      `slopweaver github self-review release --repo acme/widgets --pr 7 --head ${"b".repeat(40)}`,
    );
  });

  it("reads a held reservation as irrelevant to a write posting no inline comments", async () => {
    const home = freshHome();
    const pending = {
      formHash: "e".repeat(64),
      headSha: "b".repeat(40),
      locus: LOCUS,
      reservedIso: "2026-11-18T00:00:00Z",
    };
    expect(reserveSelfReviewRound({ home, intent: pending, pullRequestId: "PR_7" }).kind).toBe("fresh");
    const { read } = reader();
    const comments = unwrap(
      await readDescriptionReviewEvidence({
        home,
        number: 7,
        outgoingComments: [],
        owner: "acme",
        readComments: read,
        repo: "widgets",
      }),
    );
    expect(comments).toStrictEqual(ON_THE_PULL_REQUEST);
  });

  it("passes the comment read's own refusal through, reading no ledger", async () => {
    const failing: DescriptionReviewCommentsReader = () =>
      Promise.resolve(
        err(DescriptionReviewErrors.commentsReadFailed({ detail: "the review threads has more than 100 nodes" })),
      );
    const failure = unwrapErr(
      await readDescriptionReviewEvidence({
        home: freshHome(),
        number: 7,
        outgoingComments: OUTGOING,
        owner: "acme",
        readComments: failing,
        repo: "widgets",
      }),
    );
    expect(failure.code).toBe("COMMENTS_READ_FAILED");
    expect(failure.message).toContain("the review threads has more than 100 nodes");
  });
});
