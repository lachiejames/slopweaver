/**
 * Resolve the reviews a `page publish --review` cites back to evidence that each one judged THIS page.
 *
 * An id is tried as a Codex pass first (`../codex/ledgerStore.ts`'s `readPassRecord`, a local read), and only an id
 * that names no pass reaches the Claude fallback store (`../codex/fallbackPort.ts`), so a Codex review never takes on
 * the store's availability. Every id must resolve: one false citation refuses the whole publish rather than letting
 * the valid subset through, because a page claiming two checks that ran one is the overclaim this gate exists for.
 *
 * The reads are injected, so a unit test passes plain values rather than mocks.
 */
import type { FallbackReceiptScan } from "../codex/fallbackDocuments.js";
import type { FallbackStoreError } from "../codex/fallbackStoreErrors.js";
import type { CodexArtifactRecord } from "../codex/types.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import {
  bindPageReview,
  candidateFromCodexRecord,
  candidateFromFallbackReceipt,
  type PageReviewCandidate,
  type PageReviewEvidence,
  type PageReviewPreparation,
  type PreparedCommitFacts,
} from "./review.js";
import { type PageReviewError, PageReviewErrors } from "./reviewErrors.js";

/** The reads resolution needs, as plain functions a caller threads. */
export interface PageReviewReads {
  /**
   * One Codex pass record by artifact id: `undefined` when the id names none, an error when a record is there but
   * cannot be read, so a corrupt pass is never mistaken for an absent one.
   */
  readonly readPass: (args: {
    orchestrationRoot: string;
    artifactId: string;
  }) => Result<CodexArtifactRecord | undefined, PageReviewError>;
  /** Every bound Claude fallback receipt in the store. */
  readonly scanFallback: (args: { home: string }) => Promise<Result<FallbackReceiptScan, FallbackStoreError>>;
  /**
   * The preparation a recorded repository root names: `undefined` when the root is not one of this slug's, an error
   * when it is but its record cannot be read back.
   */
  readonly readPreparation: (args: {
    home: string;
    slug: string;
    repoRoot: string;
  }) => Result<PageReviewPreparation | undefined, PageReviewError>;
  /** The diff digest and page digest a preparation's repository reproduces for two commits. */
  readonly commitFacts: (args: {
    repoRoot: string;
    baseSha: string;
    headSha: string;
  }) => Result<PreparedCommitFacts, PageReviewError>;
}

/** The fallback store's scan, read once per publish however many ids reach it, and held for the rest. */
async function fallbackScanOnce({
  fallback,
  home,
  reads,
}: {
  fallback: { scan?: Result<FallbackReceiptScan, FallbackStoreError> };
  home: string;
  reads: PageReviewReads;
}): Promise<Result<FallbackReceiptScan, FallbackStoreError>> {
  const held = fallback.scan;
  if (held !== undefined) {
    return held;
  }
  const scanned = await reads.scanFallback({ home });
  fallback.scan = scanned;
  return scanned;
}

/**
 * Find one id's candidate: a Codex pass, else a fallback receipt, else a refusal naming why. `review` names the
 * underlying review, so a receipt cited by its receipt id and again by its request id is one review, not two.
 */
async function candidateFor({
  home,
  id,
  reads,
  fallback,
}: {
  home: string;
  id: string;
  reads: PageReviewReads;
  fallback: { scan?: Result<FallbackReceiptScan, FallbackStoreError> };
}): Promise<Result<{ readonly candidate: PageReviewCandidate; readonly review: string }, PageReviewError>> {
  const read = reads.readPass({ artifactId: id, orchestrationRoot: stateHomePaths({ home }).orchestration });
  if (read.isErr()) {
    return err(read.error);
  }
  const record = read.value;
  if (record !== undefined) {
    return candidateFromCodexRecord({ id, record }).map((candidate) => ({ candidate, review: `pass:${id}` }));
  }
  const scan = await fallbackScanOnce({ fallback, home, reads });
  if (scan.isErr()) {
    return err(PageReviewErrors.reviewStoreUnavailable({ detail: scan.error.message, reviewId: id }));
  }
  // Checked BEFORE a match: an unreadable receipt may be a later one for this same request, BROKEN.
  if (scan.value.unreadable > 0) {
    return err(
      PageReviewErrors.reviewStoreUnavailable({
        detail: `${String(scan.value.unreadable)} stored receipt(s) cannot be read, and one may be this review or a later one for it`,
        reviewId: id,
      }),
    );
  }
  const receipt = scan.value.receipts.find((one) => one.receiptId === id || one.requestId === id);
  if (receipt !== undefined) {
    return ok({ candidate: candidateFromFallbackReceipt({ id, receipt }), review: `receipt:${receipt.receiptId}` });
  }
  return err(PageReviewErrors.reviewNotFound({ reviewId: id }));
}

/**
 * Resolve every cited review id to evidence that it judged this slug's prepared page.
 *
 * @param home the state home
 * @param slug the page being published
 * @param ids every id passed to `--review`, in order
 * @param reads the injected reads
 * @returns the evidence for every id, or the first one that could not be proven
 */
export async function resolvePageReviews({
  home,
  slug,
  ids,
  reads,
}: {
  home: string;
  slug: string;
  ids: readonly string[];
  reads: PageReviewReads;
}): Promise<Result<readonly PageReviewEvidence[], PageReviewError>> {
  const fallback: { scan?: Result<FallbackReceiptScan, FallbackStoreError> } = {};
  const evidence: PageReviewEvidence[] = [];
  // Which cited id first named each underlying review (two aliases of one receipt must not read as two checks).
  const citedAs = new Map<string, string>();
  for (const id of ids) {
    const found = await candidateFor({ fallback, home, id, reads });
    if (found.isErr()) {
      return err(found.error);
    }
    const first = citedAs.get(found.value.review);
    if (first !== undefined) {
      return err(PageReviewErrors.reviewCitedTwice({ first, reviewId: id }));
    }
    citedAs.set(found.value.review, id);
    const bound = bindToPreparation({ candidate: found.value.candidate, home, id, reads, slug });
    if (bound.isErr()) {
      return err(bound.error);
    }
    evidence.push(bound.value);
  }
  return ok(evidence);
}

/**
 * Bind one found candidate to this slug's preparation of the repository it read, and to the commit facts that
 * repository reproduces, so a review of some other page or some other diff is refused by name.
 */
function bindToPreparation({
  candidate,
  home,
  id,
  reads,
  slug,
}: {
  candidate: PageReviewCandidate;
  home: string;
  id: string;
  reads: PageReviewReads;
  slug: string;
}): Result<PageReviewEvidence, PageReviewError> {
  const { repoRoot, baseSha, headSha } = candidate;
  const read = reads.readPreparation({ home, repoRoot, slug });
  if (read.isErr()) {
    return err(read.error);
  }
  const preparation = read.value;
  if (preparation === undefined) {
    return err(
      PageReviewErrors.reviewWrongPage({
        reviewId: id,
        why: `it read ${repoRoot}, which is not a \`page review-prepare\` repository for "${slug}"`,
      }),
    );
  }
  const facts = reads.commitFacts({ baseSha, headSha, repoRoot });
  if (facts.isErr()) {
    return err(facts.error);
  }
  return bindPageReview({ candidate, facts: facts.value, preparation, slug });
}
