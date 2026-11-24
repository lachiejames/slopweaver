/**
 * THE HANDS-FREE LIST, pure half of a proposal: its shape, the file state it was decided over, and whether the file
 * as read now is still that state. The store that keeps, confirms and retires proposals is `./privateTermsStore.ts`.
 *
 * A proposal is STALE when the raw bytes of the private-terms file no longer hash to the digest it recorded, so a
 * confirm would refuse it. Stale is a fact about ONE read, never a permanent property: the file can return to the
 * exact bytes a proposal recorded, and then it is current again.
 */

/** What a proposal does to the list. */
export type PrivateTermsProposalAction = "add" | "narrow" | "remove";

/** One edit waiting for its read-back to be confirmed or retired. */
export interface PrivateTermsProposal {
  readonly schemaVersion: 1;
  readonly proposalId: string;
  readonly createdAtIso: string;
  readonly action: PrivateTermsProposalAction;
  /** The row it changes, by the id it carries in the new file. */
  readonly termId: string;
  /** sha256 of the exact bytes of the file the edit was decided over, or null when there was none. */
  readonly baseSha256: string | null;
  /** The whole new file. */
  readonly text: string;
}

/**
 * The private-terms file as an edit starts from it. `bytesSha256` is over the raw bytes, never the decoded text:
 * two different invalid UTF-8 sequences both decode to U+FFFD, so a hash of the text would call a changed file
 * unchanged and a confirm would overwrite an edit it never saw.
 */
export type PrivateTermsFileState =
  { readonly kind: "absent" } | { readonly kind: "present"; readonly text: string; readonly bytesSha256: string };

/**
 * The base hash a proposal records and a confirm compares: the raw bytes' digest, or null for no file.
 *
 * @param state the file as read
 * @returns the digest, or null when the file is absent
 */
export function privateTermsBaseSha256({ state }: { state: PrivateTermsFileState }): string | null {
  if (state.kind === "absent") {
    return null;
  }
  return state.bytesSha256;
}

/**
 * Whether a proposal was decided over a file other than the one just read, so a confirm now would refuse it.
 *
 * @param proposal the waiting edit, carrying the digest it was decided over
 * @param state the private-terms file as this one read found it
 * @returns true when the two digests differ, absence included
 */
export function privateTermsProposalIsStale({
  proposal,
  state,
}: {
  proposal: PrivateTermsProposal;
  state: PrivateTermsFileState;
}): boolean {
  return proposal.baseSha256 !== privateTermsBaseSha256({ state });
}
