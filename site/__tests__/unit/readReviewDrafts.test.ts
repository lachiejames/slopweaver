import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readParkedReviews } from "../../components/live/readReviewDrafts";

/** The golden the verb's own test writes, as the base every malformed variant below breaks one field of. */
const GOLDEN = fileURLToPath(
  new URL("../../../src/__tests__/fixtures/contract/github-review-draft-list.json", import.meta.url),
);

/** A fresh copy of the golden's first (held) row, as plain JSON the test can break. */
function heldRow(): Record<string, unknown> {
  const document: unknown = JSON.parse(readFileSync(GOLDEN, "utf8"));
  if (typeof document !== "object" || document === null || !("items" in document) || !Array.isArray(document.items)) {
    throw new Error("the golden is not a list document");
  }
  const [first]: unknown[] = document.items;
  if (typeof first !== "object" || first === null) {
    throw new Error("the golden has no first row");
  }
  return { ...first };
}

/** The held row with its draft's fields overlaid. */
function withDraft({ over }: { over: Record<string, unknown> }): Record<string, unknown> {
  const row = heldRow();
  const draft = row["draft"];
  if (typeof draft !== "object" || draft === null) {
    throw new Error("the golden's first row has no draft");
  }
  return { ...row, draft: { ...draft, ...over } };
}

describe("readParkedReviews", () => {
  it("reads a well-formed row", () => {
    expect(readParkedReviews({ items: [heldRow()] })?.map((review) => review.id)).toEqual(["rd-held0001"]);
  });

  it("refuses the WHOLE register over one row it cannot draw, rather than drawing the rest", () => {
    const broken = [
      withDraft({ over: { verdict: "LGTM" } }),
      withDraft({ over: { comments: [{ body: "x", hunk: [{ kind: "moved", text: "" }], line: 1, path: "a" }] } }),
      withDraft({ over: { comments: [{ body: "x", hunk: [], line: 1, path: "a", startLine: "1" }] } }),
      withDraft({ over: { author: 7 } }),
      withDraft({ over: { deeperReview: false } }),
      withDraft({ over: { id: "rd-other" } }),
      withDraft({ over: { body: undefined } }),
      { ...heldRow(), post: undefined },
      { ...heldRow(), state: "posted" },
      { ...heldRow(), state: "posted", resolvedIso: "2026-09-28T11:00:00.000Z" },
    ];
    for (const row of broken) {
      expect(readParkedReviews({ items: [heldRow(), row] })).toBeUndefined();
    }
  });

  it("refuses a document that is not a list", () => {
    expect([readParkedReviews(null), readParkedReviews({ items: "no" }), readParkedReviews([])]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});
