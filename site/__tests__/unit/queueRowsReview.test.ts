/*
 * A parked review of a colleague's pull request, from the document `slopweaver github review-draft list --json`
 * prints to the queue row. Driven through the real reader over the verb's own golden, so a held row becomes a card
 * and a posted or dropped one never does — a spent review drawn as waiting would ask the owner to post it twice.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readParkedReviews } from "../../components/live/readReviewDrafts";
import type { LiveState } from "../../components/live/useLive";
import { reviewLineFor } from "../../lib/queueReviewLine";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { commentLocation, reviewDraftCard, reviewHeading } from "../../lib/reviewDraftCard";
import { ACME_PLACER } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;

/** The golden the verb's own test writes. */
const GOLDEN = fileURLToPath(
  new URL("../../../src/__tests__/fixtures/contract/github-review-draft-list.json", import.meta.url),
);

function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-09-28T12:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

/** Every row the queue draws off the golden, with every other register still loading. */
function reviewRows(): readonly QueueRow[] {
  const reviews = readParkedReviews(JSON.parse(readFileSync(GOLDEN, "utf8")));
  if (reviews === undefined) {
    throw new Error("the golden did not read");
  }
  return rowsOf({
    acts: LOADING,
    board: LOADING,
    drafts: LOADING,
    hands: LOADING,
    landing: LOADING,
    placer: ACME_PLACER,
    posts: LOADING,
    reviewers: LOADING,
    standing: LOADING,
    reviews: ready({ value: reviews }),
    imports: LOADING,
  });
}

describe("a parked review on the queue", () => {
  it("draws a card for each HELD review, and none for a posted or dropped one", () => {
    expect(
      reviewRows()
        .map((row) => row.key)
        .toSorted(),
    ).toEqual(["review:rd-appr0002", "review:rd-held0001"]);
  });

  it("is team-facing, asks the owner to post it as themselves, and carries the register's own post command", () => {
    const row = reviewRows().find((one) => one.key === "review:rd-held0001")!;
    expect([row.kind, row.pill, row.tier, row.record.kind]).toEqual([
      "review",
      "reviews as you",
      "team-blocked",
      "review",
    ]);
    expect(row.card.question).toMatch(/^Post a comment review on .+#\d+ as you\?$/);
    if (row.card.kind !== "briefing") {
      throw new Error("a review is a briefing card");
    }
    const post = row.card.options.find((option) => option.letter === "A");
    expect(post?.how.kind === "elsewhere" && post.how.command).toMatch(/^slopweaver github review-draft post /);
  });

  it("reads the body first on the review line, and the verdict when there is neither body nor comment", () => {
    const rows = reviewRows();
    expect(reviewLineFor({ row: rows.find((one) => one.key === "review:rd-appr0002")! })).toContain("APPROVE");
    expect(reviewLineFor({ row: rows.find((one) => one.key === "review:rd-held0001")! })).not.toContain("COMMENT");
  });

  it("names the page that answers the owner's questions in its what, and hands the address to the pages row", () => {
    const page = "file:///Users/someone/.slopweaver/pages/acme-pr-18045-logging/index.html";
    const held = reviewRows().find((one) => one.key === "review:rd-held0001")!;
    if (held.record.kind !== "review") {
      throw new Error("not a review row");
    }
    const card = reviewDraftCard({
      command: "slopweaver github review-draft post rd-held0001 --approve 0",
      review: { ...held.record.review, why: `the owner's questions, answered on ${page} first` },
    });
    expect(card.what!.whole).toContain("the owner's questions, answered on the acme-pr-18045-logging page first");
    expect(card.what!.whole).not.toContain("file://");
    expect(card.pages).toEqual([{ slug: "acme-pr-18045-logging", url: page }]);
  });

  it("names a comment's place the way GitHub does, and a range by both ends", () => {
    expect([
      commentLocation({ comment: { line: 339, path: "a.tsx", startLine: undefined } }),
      commentLocation({ comment: { line: 391, path: "a.tsx", startLine: 390 } }),
    ]).toEqual(["a.tsx:339", "a.tsx:390-391"]);
    const row = reviewRows().find((one) => one.key === "review:rd-held0001")!;
    if (row.record.kind !== "review") {
      throw new Error("not a review row");
    }
    expect(reviewHeading({ review: row.record.review })).toBe(
      "COMMENT on acme/acme-admin#123: Job transitions skip checks",
    );
  });
});
