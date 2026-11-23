/**
 * A PAGE THE OWNER REACTS TO IS REVIEWED BEFORE IT IS SEEN — the pure half: what a cited review must prove, and whether
 * a page may publish on the reviews it cites.
 *
 * The rule: every briefing that reaches the owner gets at least one Codex
 * review pass first, because an inaccurate or incomplete briefing makes the owner steer off bad information. A
 * trial showed why the gate has to be mechanical: Codex named
 * a question a briefing had dropped in 41 seconds, and nothing had asked it.
 *
 * ## What binds a review to THIS page
 *
 * `slopweaver page review-prepare` builds a repository whose base commit holds the inputs (the owner's words, the run's
 * doc) and whose head commit adds the fragment as `page.html` (`./reviewRepo.ts`). A Codex review or a Claude
 * fallback receipt records the repository root, the base and head commits and the digest of the diff it judged.
 * A citation counts only when all four are this slug's preparation and the diff digest reproduces from those two
 * commits — so a review of a different page, a different cut, or a working tree edited after preparing cannot be
 * cited. Everything here is decided from values; the reads are the shell's.
 */
import type { ClaudeFallbackReviewReceipt } from "../codex/fallbackReview.js";
import type { CodexArtifactRecord, ReviewPassId, ReviewProperty } from "../codex/types.js";
import { err, ok, type Result } from "../lib/result.js";
import { type PageReviewError, PageReviewErrors } from "./reviewErrors.js";

/** The review passes a record may name; the on-disk decoder does not check the field, so this does. */
const REVIEW_PASSES: ReadonlySet<string> = new Set<ReviewPassId>(["r1", "r2", "r3"]);

/** The verdicts a review answer may carry, checked at runtime for the same reason as the passes above. */
const REVIEW_VERDICTS: ReadonlySet<string> = new Set(["CLEAN", "BROKEN"]);

/** Who took a review: Codex, or a visible Claude session because Codex was capped or refused (rule 9). */
export type PageReviewer = "codex" | "claude-fallback";

/** One review as its record states it, before anything has checked it is about this page. */
export interface PageReviewCandidate {
  readonly id: string;
  readonly reviewer: PageReviewer;
  readonly repoRoot: string;
  readonly pass: ReviewPassId;
  readonly property: ReviewProperty;
  readonly baseSha: string;
  readonly headSha: string;
  readonly diffSha256: string;
  readonly verdict: "CLEAN" | "BROKEN";
  /** The reviewer's own one-paragraph summary, which the page shows beside the verdict. */
  readonly summary: string;
  readonly completedAtIso: string;
}

/** What `page review-prepare` wrote: the repository a review reads, and the bytes it put in front of it. */
export interface PageReviewPreparation {
  readonly schemaVersion: 1;
  readonly preparationId: string;
  readonly slug: string;
  readonly baseSha: string;
  readonly headSha: string;
  /** sha256 of the fragment exactly as committed as `page.html`. */
  readonly fragmentSha256: string;
  readonly createdAtIso: string;
}

/** What the shell read back from a preparation's repository for one candidate's commits. */
export interface PreparedCommitFacts {
  /** The digest of the commit-to-commit diff between the candidate's base and head, in the review's own form. */
  readonly diffSha256: string;
  /** sha256 of `page.html` at the candidate's head commit. */
  readonly fragmentSha256: string;
}

/** A review that is proven to be about this page. */
export interface PageReviewEvidence {
  readonly id: string;
  readonly reviewer: PageReviewer;
  readonly pass: ReviewPassId;
  readonly property: ReviewProperty;
  readonly verdict: "CLEAN" | "BROKEN";
  readonly summary: string;
  readonly preparationId: string;
  readonly reviewedFragmentSha256: string;
  readonly completedAtIso: string;
}

/** The record a published page carries: what reviewed it and what changed since, or that it was knowingly waived. */
export type PageReviewRecord =
  | {
      readonly schemaVersion: 1;
      readonly status: "reviewed";
      readonly slug: string;
      readonly publishedAtIso: string;
      readonly publishedFragmentSha256: string;
      /** What the author changed after the review, or null when the reviewed bytes are the published ones. */
      readonly changedAfterReview: string | null;
      readonly reviews: readonly PageReviewEvidence[];
    }
  | {
      readonly schemaVersion: 1;
      readonly status: "waived";
      readonly slug: string;
      readonly publishedAtIso: string;
      readonly publishedFragmentSha256: string;
      readonly hatch: "unreviewed-page";
    };

/**
 * Read a Codex pass record as a candidate, refusing anything that is not a conclusive review.
 *
 * The record decoder on disk is deliberately shallow (`../codex/ledgerStore.ts`), so every nested field this
 * reads is checked here rather than trusted from the declared type.
 *
 * @param id the id the author cited
 * @param record the pass record that id resolved to
 * @returns the candidate, or why the pass cannot be cited as a review
 */
export function candidateFromCodexRecord({
  id,
  record,
}: {
  id: string;
  record: CodexArtifactRecord;
}): Result<PageReviewCandidate, PageReviewError> {
  const { outcome, scope } = record;
  if (record.artifactId !== id) {
    return err(
      PageReviewErrors.reviewWrongPage({ reviewId: id, why: `its record names artifact ${record.artifactId}` }),
    );
  }
  if (scope.mode !== "review") {
    return err(PageReviewErrors.reviewInconclusive({ reviewId: id, why: `it is a ${scope.pass} planning pass` }));
  }
  if (!REVIEW_PASSES.has(scope.pass)) {
    return err(PageReviewErrors.reviewInconclusive({ reviewId: id, why: "its record names no review pass" }));
  }
  if (outcome.kind !== "answered") {
    return err(PageReviewErrors.reviewInconclusive({ reviewId: id, why: `its outcome is ${outcome.kind}` }));
  }
  const answer = outcome.answer;
  if (!("propertyId" in answer) || !REVIEW_VERDICTS.has(answer.verdict)) {
    return err(PageReviewErrors.reviewInconclusive({ reviewId: id, why: "its answer carries no review verdict" }));
  }
  if (answer.propertyId !== scope.property.id) {
    return err(
      PageReviewErrors.reviewInconclusive({
        reviewId: id,
        why: `its answer is for property ${answer.propertyId}, not ${scope.property.id}`,
      }),
    );
  }
  return ok({
    baseSha: scope.baseSha,
    completedAtIso: record.createdAtIso,
    diffSha256: scope.diffSha256,
    headSha: scope.headSha,
    id,
    pass: scope.pass,
    property: scope.property,
    repoRoot: record.repoRoot,
    reviewer: "codex",
    summary: answer.summary,
    verdict: answer.verdict,
  });
}

/**
 * Read a Claude fallback receipt as a candidate. The fallback store has already bound the receipt to its
 * request's bytes and validated its answer against the property (`../codex/fallbackDocuments.ts`).
 *
 * @param id the id the author cited
 * @param receipt the bound receipt that id resolved to
 * @returns the candidate
 */
export function candidateFromFallbackReceipt({
  id,
  receipt,
}: {
  id: string;
  receipt: ClaudeFallbackReviewReceipt;
}): PageReviewCandidate {
  const { request, answer } = receipt;
  return {
    baseSha: request.baseSha,
    completedAtIso: receipt.completedAtIso,
    diffSha256: request.diffSha256,
    headSha: request.headSha,
    id,
    pass: request.pass,
    property: request.property,
    repoRoot: request.repoRoot,
    reviewer: "claude-fallback",
    summary: answer.summary,
    verdict: answer.verdict,
  };
}

/**
 * Prove a candidate reviewed this slug's prepared page, or say which binding failed.
 *
 * @param candidate the review as its record states it
 * @param preparation the preparation its repository root resolved to
 * @param slug the page being published
 * @param facts what the shell read from that preparation's repository at the candidate's commits
 * @returns the evidence, or the binding that failed
 */
export function bindPageReview({
  candidate,
  preparation,
  slug,
  facts,
}: {
  candidate: PageReviewCandidate;
  preparation: PageReviewPreparation;
  slug: string;
  facts: PreparedCommitFacts;
}): Result<PageReviewEvidence, PageReviewError> {
  const wrong = ({ why }: { why: string }): Result<PageReviewEvidence, PageReviewError> =>
    err(PageReviewErrors.reviewWrongPage({ reviewId: candidate.id, why }));
  if (preparation.slug !== slug) {
    return wrong({ why: `it reviewed the preparation for page "${preparation.slug}"` });
  }
  if (candidate.baseSha !== preparation.baseSha || candidate.headSha !== preparation.headSha) {
    return wrong({ why: "its base and head commits are not the ones `page review-prepare` committed" });
  }
  if (facts.diffSha256 !== candidate.diffSha256) {
    return wrong({
      why: "the diff it judged does not reproduce from the prepared commits — the review repository's working tree was edited before the review ran",
    });
  }
  if (facts.fragmentSha256 !== preparation.fragmentSha256) {
    return wrong({ why: "the page.html at its head commit is not the fragment that was prepared" });
  }
  return ok({
    completedAtIso: candidate.completedAtIso,
    id: candidate.id,
    pass: candidate.pass,
    preparationId: preparation.preparationId,
    property: candidate.property,
    reviewedFragmentSha256: preparation.fragmentSha256,
    reviewer: candidate.reviewer,
    summary: candidate.summary,
    verdict: candidate.verdict,
  });
}

/**
 * Decide the record a page publishes with, or refuse it.
 *
 * `--review-changed` is required when the published fragment is not byte-identical to every reviewed one, or
 * when any review came back BROKEN — a broken check is published only once the author says what they did about
 * it, and the page shows the owner that sentence. It may be omitted only when every cited review is CLEAN over exactly
 * the bytes being published.
 *
 * @param slug the page being published
 * @param publishedFragmentSha256 sha256 of the authored fragment being published, before any linking
 * @param publishedAtIso the publish instant
 * @param reviews every cited review, each already proven to be about this page
 * @param reviewChanged the author's account of what changed after the review, as passed
 * @returns the record, or why the page may not publish on these reviews
 */
export function decidePageReview({
  slug,
  publishedFragmentSha256,
  publishedAtIso,
  reviews,
  reviewChanged,
}: {
  slug: string;
  publishedFragmentSha256: string;
  publishedAtIso: string;
  reviews: readonly PageReviewEvidence[];
  reviewChanged: string | undefined;
}): Result<PageReviewRecord, PageReviewError> {
  // A sentence with nothing VISIBLE in it (only whitespace, or format characters like U+200B, which `trim` keeps)
  // says nothing, so it counts as absent. Residue, stated: a visible but meaningless sentence passes;
  // no check here can judge whether an author's account is true, only that one is there for the owner to read.
  const changed = reviewChanged === undefined ? "" : reviewChanged.trim();
  const visible = changed.replace(/[\p{Cf}\p{Z}\s]/gu, "");
  const differing = reviews.filter((review) => review.reviewedFragmentSha256 !== publishedFragmentSha256).length;
  const broken = reviews.filter((review) => review.verdict === "BROKEN").length;
  if (visible.length === 0 && (differing > 0 || broken > 0)) {
    const reasons: string[] = [];
    if (differing > 0) {
      reasons.push(`the page differs from the cut ${String(differing)} cited review(s) read`);
    }
    if (broken > 0) {
      reasons.push(`${String(broken)} cited review(s) came back BROKEN`);
    }
    return err(PageReviewErrors.reviewChangedRequired({ why: reasons.join(", and ") }));
  }
  return ok({
    changedAfterReview: visible.length === 0 ? null : changed,
    publishedAtIso,
    publishedFragmentSha256,
    reviews,
    schemaVersion: 1,
    slug,
    status: "reviewed",
  });
}
