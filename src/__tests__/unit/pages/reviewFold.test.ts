/*
 * The fold a published page carries about its own review, and its removal before a correction is computed.
 */
import { describe, expect, it } from "vitest";

import type { PageReviewRecord } from "../../../pages/review.js";
import { renderPageReviewFold, withoutPageReviewFold } from "../../../pages/reviewFold.js";
import { FIXTURE_FRAGMENT_SHA, fixtureEvidence } from "../../pageReviewFixture.js";

const NOW = "2026-11-03T07:00:00.000Z";

/** A reviewed record over the given reviews. */
function reviewed({
  reviews = [fixtureEvidence()],
  changedAfterReview = null,
  published = FIXTURE_FRAGMENT_SHA,
}: {
  reviews?: ReturnType<typeof fixtureEvidence>[];
  changedAfterReview?: string | null;
  published?: string;
}): PageReviewRecord {
  return {
    changedAfterReview,
    publishedAtIso: NOW,
    publishedFragmentSha256: published,
    reviews,
    schemaVersion: 1,
    slug: "queue",
    status: "reviewed",
  };
}

describe("renderPageReviewFold", () => {
  it("says a waived page was not reviewed", () => {
    const fold = renderPageReviewFold({
      record: {
        hatch: "unreviewed-page",
        publishedAtIso: NOW,
        publishedFragmentSha256: FIXTURE_FRAGMENT_SHA,
        schemaVersion: 1,
        slug: "queue",
        status: "waived",
      },
    });
    expect(fold).toContain('<details data-page-review="waived"><summary>Not reviewed before you saw it</summary>');
    expect(fold).toContain("Read it as a first cut.");
  });

  it("names each check, and calls the author's text on an unchanged BROKEN cut a reason, never an edit", () => {
    const fold = renderPageReviewFold({
      record: reviewed({
        reviews: [
          fixtureEvidence(),
          fixtureEvidence({
            id: "receipt-1",
            reviewer: "claude-fallback",
            summary: "Two dates were wrong.",
            verdict: "BROKEN",
          }),
        ],
        changedAfterReview: "the dates are the owner's own, quoted",
      }),
    });
    expect(fold).toContain("How this page was reviewed before you saw it — 2 check(s), 1 broken</summary>");
    expect(fold).toContain(
      "<li><strong>Held</strong> — Codex, pass r1, attacked: <q>Every claim is in inputs/</q><br>Every claim traces to the owner's words.</li>",
    );
    expect(fold).toContain("<strong>Broken</strong> — a visible Claude session (Codex was capped or refused the pass)");
    expect(fold).toContain(
      "This is the exact cut that was reviewed, unchanged since. <strong>Why it was published as is:</strong> the dates are the owner's own, quoted",
    );
    expect(fold).not.toContain("What changed after the review");
  });

  it("says the exact cut was read when nothing changed", () => {
    const fold = renderPageReviewFold({ record: reviewed({}) });
    expect(fold).toContain("1 check(s), all held");
    expect(fold).toContain("Nothing changed after the review: you are reading the exact cut it checked.");
  });

  it("says plainly when the published bytes are not the reviewed cut", () => {
    const fold = renderPageReviewFold({
      record: reviewed({ changedAfterReview: "tightened the opening line", published: "0".repeat(64) }),
    });
    expect(fold).toContain("This page is not the exact cut that was reviewed, and those edits were not re-reviewed.");
  });

  it("never denies a later review of this exact page when an earlier cut is cited beside it", () => {
    const fold = renderPageReviewFold({
      record: reviewed({
        changedAfterReview: "fixed the typo before the second pass",
        reviews: [fixtureEvidence({ reviewedFragmentSha256: "0".repeat(64) }), fixtureEvidence({ id: "pass-2" })],
      }),
    });
    expect(fold).toContain(
      "1 of the 2 checks read an earlier cut; the rest read this exact page. <strong>What changed between the cuts:</strong> fixed the typo before the second pass",
    );
    expect(fold).not.toContain("not re-reviewed");
  });

  it("escapes a summary that carries markup", () => {
    const fold = renderPageReviewFold({
      record: reviewed({ reviews: [fixtureEvidence({ summary: "</details><script>x</script>" })] }),
    });
    expect(fold).toContain("&lt;/details&gt;&lt;script&gt;x&lt;/script&gt;");
    expect(fold.match(/<\/details>/g)).toHaveLength(1);
  });

  it("escapes the pass name too, so no record field reaches the fold as markup", () => {
    const tampered = "r1<style>x</style>" as unknown as "r1";
    const fold = renderPageReviewFold({ record: reviewed({ reviews: [fixtureEvidence({ pass: tampered })] }) });
    expect(fold).toContain("pass r1&lt;style&gt;x&lt;/style&gt;, attacked:");
    expect(fold).not.toContain("<style>");
  });
});

describe("withoutPageReviewFold", () => {
  it("removes the fold and leaves the author's bytes exactly", () => {
    const authored = "<title>Queue</title><p>hi</p>";
    const html = `<html><body>${authored}${renderPageReviewFold({ record: reviewed({}) })}</body></html>`;
    expect(withoutPageReviewFold({ html })).toBe(`<html><body>${authored}</body></html>`);
  });

  it("leaves an author's own details element alone", () => {
    const html = "<details><summary>mine</summary></details>";
    expect(withoutPageReviewFold({ html })).toBe(html);
  });
});
