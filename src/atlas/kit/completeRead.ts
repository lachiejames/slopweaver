/**
 * The proof a read has to produce before anything it did not return may be marked stale.
 *
 * ## Why staling takes a proof rather than a boolean
 *
 * "This entity was not returned, so it is gone" is only true when the read that did not return it actually
 * FINISHED. A paged read that stopped at a ceiling, a rate-limit pause halfway through a fan-out, and a
 * genuinely empty result all look identical to a merge that takes `complete: boolean` — and a wrong `true`
 * marks live things stale, which is the one error a reader cannot spot, because a staled record looks
 * exactly like a deleted one.
 *
 * So callers obtain a {@link CompleteRead} from {@link provenCompleteRead}, which CHECKS rather than trusts. A
 * caller that "knows" the read finished is expected to hand over the evidence rather than assert it.
 *
 * ## Kit-owned because the judgement is, not because two files looked alike
 *
 * Both atlases that fan out over a provider's collections arrived at the same two conditions — paging
 * terminated on its own, and any total the provider reported was reached — and at the same decision to
 * carry the evidence forward as a SENTENCE a coverage reason can quote. What differs between them is only
 * which of the two conditions is available: a provider that reports no total leaves the first alone, which
 * is stated in the proof rather than hidden.
 */
import { err, ok, type Result } from "../../lib/result.js";

/**
 * Evidence that one kind's read reached the end of its own result set.
 *
 * {@link provenCompleteRead} is the only function in this tree that builds one. The compiler does not enforce
 * that: `provenBy` is a plain string literal, so what it buys is visibility — a hand-built object has to spell
 * the factory's name, which a reviewer sees.
 */
export interface CompleteRead {
  readonly kind: string;
  readonly observed: number;
  readonly proof: string;
  readonly provenBy: "provenCompleteRead";
}

/**
 * Prove that a read finished, or say why it did not.
 *
 * @param kind the kind this read covered, named in both the proof and every refusal
 * @param observed how many entities the read produced
 * @param reportedTotal the provider's own total, or `null` when it reports none — which for most REST
 *   listings is the ordinary case, and which leaves completeness resting on paging alone
 * @param pagesExhausted whether paging ended because the provider offered no further page, rather than
 *   because this code stopped asking
 * @param providerName the provider's name, so a refusal reads in its vocabulary
 * @returns the proof, or every reason the read may not be treated as complete
 */
export function provenCompleteRead({
  kind,
  observed,
  reportedTotal,
  pagesExhausted,
  providerName,
}: {
  kind: string;
  observed: number;
  reportedTotal: number | null;
  pagesExhausted: boolean;
  providerName: string;
}): Result<CompleteRead> {
  const problems: string[] = [];
  if (!pagesExhausted) {
    problems.push(
      `the ${kind} read stopped before ${providerName} ran out of pages, so entities it did not reach must not be staled`,
    );
  }
  if (reportedTotal !== null && observed < reportedTotal) {
    problems.push(
      `the ${kind} read produced ${String(observed)} of the ${String(reportedTotal)} ${providerName} reported, so it is incomplete`,
    );
  }
  if (problems.length > 0) {
    return err(problems);
  }
  // The same floor `./completeness.ts` states: an excess is accepted, and the proof says "exceeding" rather than
  // claiming a match between two numbers that differ.
  let against = `matching the ${String(reportedTotal)} ${providerName} reported`;
  if (reportedTotal === null) {
    against = `${providerName} reported no total for this listing, so completeness rests on paging alone`;
  } else if (observed > reportedTotal) {
    against = `exceeding the ${String(reportedTotal)} ${providerName} reported, consistent with a record created mid-read`;
  }
  return ok({
    kind,
    observed,
    proof: `read ${String(observed)} ${kind} record(s) to the end of paging, ${against}`,
    provenBy: "provenCompleteRead",
  });
}
