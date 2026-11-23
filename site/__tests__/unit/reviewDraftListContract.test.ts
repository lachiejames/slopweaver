/*
 * The CONSUMER half of the `github review-draft list --json` contract: the console's reader draws every row of the
 * golden the verb's own test pins (`src/__tests__/unit/cli/commands/github/reviewDraftListContract.test.ts`). The
 * golden is READ, never imported: `site/` is its own Yarn project, and its CI job installs nothing the verb's graph
 * needs.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isHeldReview, readParkedReviews } from "../../components/live/readReviewDrafts";

/** The golden the producer test writes. */
const GOLDEN = fileURLToPath(
  new URL("../../../src/__tests__/fixtures/contract/github-review-draft-list.json", import.meta.url),
);

describe("the console reads every row github review-draft list --json prints", () => {
  const reviews = readParkedReviews(JSON.parse(readFileSync(GOLDEN, "utf8")));

  it("reads the register whole, every state, in the order the verb printed it", () => {
    expect(reviews?.map((review) => [review.id, review.state])).toEqual([
      ["rd-held0001", "held"],
      ["rd-appr0002", "held"],
      ["rd-post0003", "posted"],
      ["rd-drop0004", "dropped"],
    ]);
  });

  it("carries the post command exactly while a row is held, and never on a spent one", () => {
    expect(
      reviews?.map((review) => [
        isHeldReview({ review }),
        review.postCommand?.startsWith("slopweaver github review-draft post"),
      ]),
    ).toEqual([
      [true, true],
      [true, true],
      [false, undefined],
      [false, undefined],
    ]);
  });

  it("draws each comment on its hunk — a removal, an addition, context, and a range", () => {
    const held = reviews?.find((review) => review.id === "rd-held0001");

    expect(held?.comments.map((comment) => [comment.path, comment.startLine, comment.line])).toEqual([
      ["src/workflows/JobTransitions.ts", undefined, 339],
      ["src/workflows/JobTransitions.ts", 390, 391],
    ]);
    expect(held?.comments[0]?.hunk.map((line) => line.kind)).toEqual(["header", "context", "del", "add"]);
    expect(held?.comments[0]?.hunk[2]).toEqual({
      kind: "del",
      newLine: undefined,
      oldLine: 339,
      text: '    "use Stop below";',
    });
    expect(held?.deeperReview).toContain("staging e2e");
  });

  it("reads an APPROVE with no body, no comments, no author and no deeper-review offer", () => {
    const approve = reviews?.find((review) => review.id === "rd-appr0002");

    expect([approve?.verdict, approve?.body, approve?.comments, approve?.author, approve?.deeperReview]).toEqual([
      "APPROVE",
      "",
      [],
      undefined,
      undefined,
    ]);
  });

  it("reads what became of a spent row", () => {
    expect(reviews?.find((review) => review.id === "rd-post0003")?.outcome).toContain("#pullrequestreview-1");
    expect(reviews?.find((review) => review.id === "rd-drop0004")?.outcome).toBe(
      "the owner said the thanks reply is enough",
    );
  });
});
