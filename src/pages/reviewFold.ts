/**
 * The fold a published page carries about its own review — which pass, what it attacked, what it found, and
 * what changed since. Appended by `page publish` AFTER the author's fragment, so the fragment still reaches disk
 * byte for byte and the freeze holds the whole document the owner opened, fold included.
 *
 * Machine ids stay out of the visible text (`./identifiers.ts`'s `RAW_MACHINE_ID`); the pass
 * and receipt ids live in the record beside the page (`./reviewRepo.ts`'s `pageReviewRecordPath`).
 */
import { escapeText } from "../outbound/briefing/escape.js";
import type { PageReviewEvidence, PageReviewer, PageReviewRecord } from "./review.js";

/** The attribute that marks the fold, so a reader of the frozen bytes can find it without parsing prose. */
export const PAGE_REVIEW_FOLD_ATTRIBUTE = "data-page-review";

/** How the page names a reviewer to the owner. */
function reviewerLabel({ reviewer }: { reviewer: PageReviewer }): string {
  if (reviewer === "codex") {
    return "Codex";
  }
  return "a visible Claude session (Codex was capped or refused the pass)";
}

/** One review as a list item. */
function reviewItem({ review }: { review: PageReviewEvidence }): string {
  return (
    `<li><strong>${review.verdict === "CLEAN" ? "Held" : "Broken"}</strong> — ${escapeText({
      text: reviewerLabel({ reviewer: review.reviewer }),
    })}, pass ${escapeText({ text: review.pass })}, attacked: <q>${escapeText({ text: review.property.statement })}</q>` +
    `<br>${escapeText({ text: review.summary })}</li>`
  );
}

/**
 * Every review fold this module renders, as one pattern. The fold's own text is escaped, so no `<` inside it can
 * close it early, and it is always the last thing before the shell's closing tags.
 */
const FOLD_PATTERN = new RegExp(
  `\\n<details ${PAGE_REVIEW_FOLD_ATTRIBUTE}="(?:reviewed|waived)">[\\s\\S]*?</details>\\n`,
  "g",
);

/**
 * A page's bytes with its review fold taken out, so a correction compares what the AUTHOR changed and never
 * marks a new review as a changed passage (`../outbound/briefing/corrections.ts`).
 *
 * @returns the html with every review fold removed
 */
export function withoutPageReviewFold({ html }: { html: string }): string {
  return html.replace(FOLD_PATTERN, "");
}

/**
 * What the fold says before the author's `--review-changed` sentence, decided by how many cited reviews read the
 * exact published bytes: all of them, so the sentence is why a BROKEN cut shipped as is; none, so the
 * edits were not re-reviewed; some, so it names the earlier cut without denying the later review of this one.
 */
function changedLead({ record }: { record: Extract<PageReviewRecord, { status: "reviewed" }> }): string {
  const earlier = record.reviews.filter(
    (review) => review.reviewedFragmentSha256 !== record.publishedFragmentSha256,
  ).length;
  if (earlier === 0) {
    return "This is the exact cut that was reviewed, unchanged since. <strong>Why it was published as is:</strong>";
  }
  if (earlier === record.reviews.length) {
    return (
      "This page is not the exact cut that was reviewed, and those edits were not re-reviewed. " +
      "<strong>What changed after the review:</strong>"
    );
  }
  return (
    `${String(earlier)} of the ${String(record.reviews.length)} checks read an earlier cut; the rest read this ` +
    "exact page. <strong>What changed between the cuts:</strong>"
  );
}

/**
 * Render the review fold for one published page.
 *
 * @param record the record the page publishes with
 * @returns the HTML appended after the author's fragment, a leading newline included
 */
export function renderPageReviewFold({ record }: { record: PageReviewRecord }): string {
  if (record.status === "waived") {
    return (
      `\n<details ${PAGE_REVIEW_FOLD_ATTRIBUTE}="waived"><summary>Not reviewed before you saw it</summary>` +
      "<p>This page was published with the review gate waived, so no Codex or Claude pass checked it against what " +
      "you asked. Read it as a first cut.</p></details>\n"
    );
  }
  const broken = record.reviews.filter((review) => review.verdict === "BROKEN").length;
  const verdictLine =
    broken === 0
      ? `${String(record.reviews.length)} check(s), all held`
      : `${String(record.reviews.length)} check(s), ${String(broken)} broken`;
  let changed = "<p>Nothing changed after the review: you are reading the exact cut it checked.</p>";
  if (record.changedAfterReview !== null) {
    changed = `<p>${changedLead({ record })} ${escapeText({ text: record.changedAfterReview })}</p>`;
  }
  return (
    `\n<details ${PAGE_REVIEW_FOLD_ATTRIBUTE}="reviewed"><summary>How this page was reviewed before you saw it — ` +
    `${verdictLine}</summary><ul>${record.reviews.map((review) => reviewItem({ review })).join("")}</ul>` +
    `${changed}</details>\n`
  );
}
