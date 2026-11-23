/**
 * Every way the private-terms store (`./privateTermsStore.ts`) refuses, and the one factory each refusal is built
 * through. No variant carries a pattern, a source or a meaning, so a refusal printed anywhere names no word.
 */
import { errorMessage } from "#lib/errorMessage.js";

/** A file or directory the store needed could not be read or written. */
interface StoreIoFailedError {
  readonly code: "STORE_IO_FAILED";
  readonly message: string;
}

/** The proposal named is not one waiting to be confirmed: a bad id, none kept, or not this store's shape. */
interface ProposalUnusableError {
  readonly code: "PROPOSAL_UNUSABLE";
  readonly message: string;
}

/** Another edit holds the file's lock. */
interface LockHeldError {
  readonly code: "LOCK_HELD";
  readonly message: string;
}

/** The file changed after the proposal was decided over it, so the proposal is refused. */
interface ProposalStaleError {
  readonly code: "PROPOSAL_STALE";
  readonly message: string;
}

/** Every way the store refuses. */
export type PrivateTermsStoreError = StoreIoFailedError | ProposalUnusableError | LockHeldError | ProposalStaleError;

/** The factory every store refusal is built through; none carries a pattern, a source or a meaning. */
export const PrivateTermsStoreErrors = {
  ioFailed: ({ what, path, cause }: { what: string; path: string; cause: unknown }): StoreIoFailedError => ({
    code: "STORE_IO_FAILED",
    message: `${what} ${path} failed: ${errorMessage({ error: cause })}`,
  }),
  lockHeld: ({ path, why }: { path: string; why: string }): LockHeldError => ({
    code: "LOCK_HELD",
    message: `the lock ${path} is not ours to take: ${why}; run it again once that edit has finished`,
  }),
  proposalStale: ({ proposalId, why }: { proposalId: string; why: string }): ProposalStaleError => ({
    code: "PROPOSAL_STALE",
    message: `proposal ${proposalId} cannot land: ${why}; nothing was written, propose the edit again`,
  }),
  proposalUnusable: ({ why }: { why: string }): ProposalUnusableError => ({
    code: "PROPOSAL_UNUSABLE",
    message: `no proposal to confirm: ${why}`,
  }),
} as const;
