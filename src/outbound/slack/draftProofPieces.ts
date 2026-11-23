/**
 * Every piece of proof a held draft can be missing — a finding's (`./findingProof.ts`) and a first channel message's
 * (`./firstMessageProof.ts`) as ONE list, so a row that is both names each piece once. A leaf with no imports so the
 * site's mirror test (`site/__tests__/unit/draftProofMissing.test.ts`) can read it without pulling zod or neverthrow
 * into the site typecheck.
 */

/** Each piece of proof a held draft can be missing, in the order a refusal names them. */
export const DRAFT_PROOF_MISSING = ["screenshot", "link", "annotation", "impact", "impact-count-first"] as const;

/** One of {@link DRAFT_PROOF_MISSING}. */
export type DraftProofMissing = (typeof DRAFT_PROOF_MISSING)[number];
