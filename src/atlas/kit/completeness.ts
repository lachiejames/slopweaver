/**
 * The proof a family read reached the end of its own results — kit-owned, because every atlas needs it and
 * two of them had already written it identically.
 *
 * ## Why this is a TYPE rather than a boolean
 *
 * "This entity was not returned, so it is gone" is only true when the read that did not return it actually
 * FINISHED. A paged read that stopped at a ceiling, a 429 halfway through a fan-out and an empty result all
 * look the same to a merge taking `complete: boolean` — and a wrong `true` marks real entities stale, which
 * is the one error a reader cannot spot, because a staled record looks exactly like a retired one.
 *
 * Callers therefore obtain a {@link CompleteFamilyRead} from {@link provenCompleteRead}, which checks rather
 * than trusts. A caller that "knows" the read finished is expected to hand over the evidence rather than
 * assert it.
 *
 * ## Two conditions, and a platform may only be able to satisfy one
 *
 * Paging must have terminated on its own — a run that stopped at a page ceiling has not seen the tail — and,
 * when the provider reported a total, the number observed must reach it. A provider that reports NO total
 * leaves only the first condition, which the proof sentence states rather than hides, so a reader can see
 * which evidence a stale mark actually rested on. CrowdStrike reports `meta.pagination.total` and gets both
 * checks; an API that answers a bare array gets one.
 *
 * ## It lives here because it regenerated
 *
 * Two atlases arrived at the same forty lines independently, which is the class
 * `error-handling.md` describes: careful work reproducing a shape while the shape is being counted. Making
 * it kit-owned is the fix that a review note is not.
 */
import { err, ok, type Result } from "../../lib/result.js";

/**
 * Evidence that one kind's read reached the end of its own result set.
 *
 * The `proof` field is a sentence a coverage reason can quote, so the evidence survives into what a reader
 * sees rather than being collapsed to a boolean at the first call site. `provenBy` is a plain string literal,
 * so the compiler does not stop a hand-built object; what it buys is visibility, because such an object has
 * to spell the factory's name, which a reviewer sees.
 */
export interface CompleteFamilyRead {
  readonly kind: string;
  readonly observed: number;
  readonly proof: string;
  readonly provenBy: "provenCompleteRead";
}

/**
 * Prove that a family read finished, or say why it did not.
 *
 * @param kind the kind this read covered, named in both the proof and every refusal
 * @param observed how many entities the read produced
 * @param reportedTotal the provider's own total, or `null` when it reports none — which is every list
 *   endpoint on some platforms, and is stated in the proof rather than hidden
 * @param pagesExhausted whether paging ended because the provider offered no further page
 * @returns the proof, or every reason the read may not be treated as complete
 */
export function provenCompleteRead({
  kind,
  observed,
  reportedTotal,
  pagesExhausted,
}: {
  kind: string;
  observed: number;
  reportedTotal: number | null;
  pagesExhausted: boolean;
}): Result<CompleteFamilyRead> {
  const problems: string[] = [];
  if (!pagesExhausted) {
    problems.push(
      `the ${kind} read stopped before the provider ran out of pages, so entities it did not reach must not be staled`,
    );
  }
  if (reportedTotal !== null && observed < reportedTotal) {
    problems.push(
      `the ${kind} read produced ${String(observed)} of the ${String(reportedTotal)} the provider reported, so it is incomplete`,
    );
  }
  if (problems.length > 0) {
    return err(problems);
  }
  // A total is a floor the read must reach, not a ceiling: a record created mid-read lands past it. The proof
  // says which, so a reader never sees "matching" over two numbers that differ.
  let against = `matching the ${String(reportedTotal)} the provider reported`;
  if (reportedTotal === null) {
    against = "the provider reported no total, so completeness rests on paging alone";
  } else if (observed > reportedTotal) {
    against = `exceeding the ${String(reportedTotal)} the provider reported, consistent with a record created mid-read`;
  }
  return ok({
    kind,
    observed,
    proof: `read ${String(observed)} ${kind} record(s) to the end of paging, ${against}`,
    provenBy: "provenCompleteRead",
  });
}
