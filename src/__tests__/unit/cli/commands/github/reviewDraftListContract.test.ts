/**
 * The PRODUCER half of the `github review-draft list --json` contract: what the verb prints, pinned to a golden file
 * the console's reader (`site/components/live/readReviewDrafts.ts`) is tested against in
 * `site/__tests__/unit/reviewDraftListContract.test.ts`. The two halves live in separate Yarn projects and neither may
 * import the other's graph, so they meet in ONE file, `src/__tests__/fixtures/contract/github-review-draft-list.json`.
 *
 * The rows cover every state, every hunk-line kind, a range comment, an APPROVE with an empty body, and a row with no
 * author and no deeper-review offer — each shape the card draws differently. The repository, pull request, code and
 * prose are synthetic.
 *
 * A change to what the verb prints fails here until the golden is re-cut (`yarn vitest run --config
 * config/vitest/unit.ts <this file> --update`), and the re-cut golden fails the site half until the reader draws it.
 */
import { describe, expect, it } from "vitest";

import { reviewDraftListDocument } from "../../../../../cli/commands/github/reviewDraftReport.js";
import {
  type ParkedReviewDraft,
  type ReviewDraftItem,
  reviewDraftDigest,
} from "../../../../../outbound/github/reviewDraft.js";

/** Where both halves read the contract; relative to this file, as `toMatchFileSnapshot` resolves it. */
const GOLDEN = "../../../../fixtures/contract/github-review-draft-list.json";

const HEAD = "0000000000000000000000000000000000000001";

/** A row whose digest is the digest of its own content, the way `record` writes one. */
function draft({
  id,
  over = {},
}: {
  id: string;
  over?: Partial<Omit<ParkedReviewDraft, "digest" | "id">>;
}): ParkedReviewDraft {
  const row = {
    author: "colleague",
    body: "I think this is close. Two things inline, neither blocking.",
    comments: [
      {
        body: "maybe gate this on the job kind, since Retry skips the checks here",
        hunk: [
          { kind: "header" as const, text: "@@ -330,8 +330,9 @@ export function JobTransitions() {" },
          { kind: "context" as const, newLine: 338, oldLine: 338, text: "  const notice =" },
          { kind: "del" as const, oldLine: 339, text: '    "use Stop below";' },
          { kind: "add" as const, newLine: 339, text: '    "use Stop/Retry below";' },
        ],
        line: 339,
        path: "src/workflows/JobTransitions.ts",
      },
      {
        body: "probably dead now that the legacy arm is gone",
        hunk: [
          { kind: "header" as const, text: "@@ -388,4 +389,3 @@" },
          { kind: "context" as const, newLine: 390, oldLine: 389, text: "  return (" },
          { kind: "add" as const, newLine: 391, text: "    isSkipChecksEnabled(job)" },
        ],
        line: 391,
        path: "src/workflows/JobTransitions.ts",
        startLine: 390,
      },
    ],
    deeperReview: "the staging e2e suites were not run; running them needs a staging login",
    headSha: HEAD,
    number: 123,
    repo: "acme/acme-admin",
    title: "Job transitions skip checks",
    tsIso: "2026-09-28T10:00:00.000Z",
    url: "https://github.com/acme/acme-admin/pull/123",
    verdict: "COMMENT" as const,
    why: "a colleague's pull request, reviewed before the thanks reply",
    ...over,
  };
  return { ...row, digest: reviewDraftDigest({ draft: row }), id };
}

describe("github review-draft list --json, the contract the console reads", () => {
  it("prints exactly the golden the console's reader is tested against", async () => {
    const items: ReviewDraftItem[] = [
      { draft: draft({ id: "rd-held0001" }), id: "rd-held0001", state: "held" },
      {
        draft: draft({
          id: "rd-appr0002",
          over: { author: undefined, body: "", comments: [], deeperReview: undefined, verdict: "APPROVE" },
        }),
        id: "rd-appr0002",
        state: "held",
      },
      {
        draft: draft({ id: "rd-post0003", over: { verdict: "REQUEST_CHANGES" } }),
        id: "rd-post0003",
        outcome: "https://github.com/acme/acme-admin/pull/123#pullrequestreview-1",
        resolvedIso: "2026-09-28T11:00:00.000Z",
        state: "posted",
      },
      {
        draft: draft({ id: "rd-drop0004" }),
        id: "rd-drop0004",
        outcome: "the owner said the thanks reply is enough",
        resolvedIso: "2026-09-28T12:00:00.000Z",
        state: "dropped",
      },
    ];

    await expect(`${JSON.stringify(reviewDraftListDocument({ items }), null, 2)}\n`).toMatchFileSnapshot(GOLDEN);
  });
});
