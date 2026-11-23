/**
 * The pieces of proof a finding draft can be missing (`./findingProof.ts` holds the rule). A leaf with no imports;
 * the one list the site mirrors is `./draftProofPieces.ts`, which holds these pieces with a first message's.
 */

/** Each piece of proof a finding can be missing, in the order a refusal names them. */
export const FINDING_PROOF_MISSING = ["screenshot", "link", "impact", "impact-count-first"] as const;

/** One of {@link FINDING_PROOF_MISSING}. */
export type FindingProofMissing = (typeof FINDING_PROOF_MISSING)[number];
