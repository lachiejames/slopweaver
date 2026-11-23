/**
 * What the finding proof bar (`./findingProof.ts`) can fail with while it reads a row's declarations. Its own domain,
 * apart from the draft register's union, because a finding's proof is a separate concern from parking a draft.
 */

/**
 * An `--impact` that does not lead with how many people, names no one, or says nothing after its count: a finding's
 * impact is people, counted, and what happened to them.
 */
export interface FindingImpactUncountedError {
  readonly code: "FINDING_IMPACT_UNCOUNTED";
  readonly message: string;
  readonly value: string;
}

/** The one factory each variant is built by. */
export const FindingProofErrors = {
  impactUncounted: ({ value }: { value: string }): FindingImpactUncountedError => ({
    code: "FINDING_IMPACT_UNCOUNTED",
    message:
      `--impact must lead with how many people, name who they are (users, customers, staff…) and say what ` +
      `happened to them — got ${JSON.stringify(value)}.`,
    value,
  }),
} as const;
