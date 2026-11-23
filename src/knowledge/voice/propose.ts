/**
 * Building one validated {@link BeliefProposal} — the pure half of the review step.
 *
 * Every check that can be made without a model is made here, and the one that cannot is named rather than
 * faked. What is checkable: the claim is a sentence within the cap, the domain is a slug, and **the quote
 * occurs verbatim in the pinned unit**. What is not: whether the claim is a fair reading of what they meant.
 * That is the visible session's judgement and no verb can stand in for it.
 *
 * The quote check is the load-bearing one. Without it a proposal could attribute to them a sentence they never
 * said, and it would be indistinguishable from one they did — the failure this repository has already paid
 * for elsewhere and now verifies quotes mechanically to avoid.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { isLessonDomain } from "../row.js";

import { type BeliefError, BeliefErrors } from "./errors.js";
import {
  type BeliefHold,
  // biome-ignore lint/correctness/noUnusedImports: named by this file's {@link}, which Biome does not count as a use
  type BeliefProposal,
  type NoProposal,
  PROPOSAL_CLAIM_MAX,
  type ProposedBelief,
  type VoiceUnit,
} from "./types.js";
import { proposalId } from "./unit.js";

/**
 * A non-empty trimmed string within a cap, or the reason it is not one.
 *
 * Exported so `./answer.ts` checks their words by the same rule this file checks a claim by. A second copy
 * would eventually disagree about whether a whitespace-only value is empty.
 *
 * @param field the field's own name, which the failure message leads with
 * @param value the raw value as it arrived
 * @param max the longest the trimmed value may run, in characters
 * @returns the trimmed value, or the typed field failure
 */
export function requireText({
  field,
  value,
  max,
}: {
  field: string;
  value: string;
  max: number;
}): Result<string, BeliefError> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return err(BeliefErrors.field({ field, why: "is empty" }));
  }
  if (trimmed.length > max) {
    return err(
      BeliefErrors.field({
        field,
        why: `is ${String(trimmed.length)} characters, over the ${String(max)} allowed`,
      }),
    );
  }
  return ok(trimmed);
}

/**
 * Build a proposal from what a session read, verifying the quote against their own words.
 *
 * The quote is compared to the unit's text with WHITESPACE COLLAPSED on both sides, and that is the one
 * tolerance allowed. A session copying a span out of a rendered batch picks up the line wrapping the
 * renderer applied, so an exact-bytes-only check would refuse honest citations of unaltered words; nothing
 * else is normalised, so a tidied, re-punctuated or paraphrased quote is still refused. The quote STORED is
 * the session's own text, not a re-derived span, because rewriting a citation into a form the checker
 * preferred is the thing being prevented.
 *
 * @param unit the pinned unit, already proven to hash to its own id
 * @param domain which system the claim is about
 * @param claim the belief, in one sentence
 * @param quote the span of their words it was read from
 * @param held how firmly the words show they held it
 * @param run the board row the reviewing session is on
 * @param reviewedAtIso the instant to stamp; passed in so this stays pure
 * @returns the row, or the first check that failed
 */
export function buildProposal({
  unit,
  domain,
  claim,
  quote,
  held,
  run,
  reviewedAtIso,
}: {
  unit: VoiceUnit;
  domain: string;
  claim: string;
  quote: string;
  held: BeliefHold;
  run: string;
  reviewedAtIso: string;
}): Result<ProposedBelief, BeliefError> {
  if (!isLessonDomain({ domain })) {
    return err(
      BeliefErrors.field({
        field: "domain",
        why: `"${domain}" is not a slug — lowercase letters, digits and single hyphens, 2-40 characters`,
      }),
    );
  }
  const claimText = requireText({ field: "claim", max: PROPOSAL_CLAIM_MAX, value: claim });
  if (claimText.isErr()) {
    return err(claimText.error);
  }
  const quoteText = requireText({ field: "quote", max: unit.text.length, value: quote });
  if (quoteText.isErr()) {
    return err(quoteText.error);
  }
  if (!quotedFrom({ quote: quoteText.value, text: unit.text })) {
    return err(BeliefErrors.quoteNotFound({ unitId: unit.id }));
  }
  const runText = requireText({ field: "run", max: 200, value: run });
  if (runText.isErr()) {
    return err(runText.error);
  }
  return ok({
    claim: claimText.value,
    domain,
    held,
    kind: "proposed",
    proposalId: proposalId({ claim: claimText.value, unitId: unit.id }),
    quote: quoteText.value,
    reviewedAtIso,
    run: runText.value,
    unitId: unit.id,
  });
}

/**
 * Whether a quote occurs in a unit's text, ignoring only how the two are wrapped.
 *
 * @param quote the cited span
 * @param text the unit's exact text
 * @returns true when the quote appears in the text once whitespace runs are collapsed on both sides
 */
export function quotedFrom({ quote, text }: { quote: string; text: string }): boolean {
  const flat = ({ value }: { value: string }): string => value.replaceAll(/\s+/gu, " ").trim();
  return flat({ value: text }).includes(flat({ value: quote }));
}

/**
 * Build the row that records a unit as read with nothing worth proposing.
 *
 * `why` is required rather than optional, and that is the difference between a queue that finishes honestly
 * and one that finishes by being skipped: a reader has to be able to tell "they said nothing falsifiable
 * here" from "a session wanted the batch to move on".
 *
 * @param unitId the unit that was read
 * @param why what was in it, and why no claim came out
 * @param run the board row the reviewing session is on
 * @param reviewedAtIso the instant to stamp
 * @returns the row, or the first check that failed
 */
export function buildNoProposal({
  unitId,
  why,
  run,
  reviewedAtIso,
}: {
  unitId: string;
  why: string;
  run: string;
  reviewedAtIso: string;
}): Result<NoProposal, BeliefError> {
  const whyText = requireText({ field: "why", max: PROPOSAL_CLAIM_MAX, value: why });
  if (whyText.isErr()) {
    return err(whyText.error);
  }
  const runText = requireText({ field: "run", max: 200, value: run });
  if (runText.isErr()) {
    return err(runText.error);
  }
  return ok({ kind: "none", reviewedAtIso, run: runText.value, unitId, why: whyText.value });
}
