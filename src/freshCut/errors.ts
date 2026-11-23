/**
 * Every way a fresh cut fails to be produced or verified. One union for the domain, built through
 * {@link FreshCutErrors}; a message names a path, a SHA or a git subcommand and never a file's content, because a
 * fresh cut's whole subject is text that may be private.
 */

/** A git read in the source repository failed or answered nothing usable. */
export interface SourceUnreadableError {
  readonly code: "SOURCE_UNREADABLE";
  readonly message: string;
}

/** The named commit is not a hexadecimal object id, or does not resolve to a commit. */
export interface CommitInvalidError {
  readonly code: "COMMIT_INVALID";
  readonly message: string;
}

/** The named commit is not reachable from the source repository's local `main`. */
export interface CommitNotOnMainError {
  readonly code: "COMMIT_NOT_ON_MAIN";
  readonly message: string;
  readonly sha: string;
}

/** The commit's tree holds a submodule, whose files are in another repository and so cannot be scanned. */
export interface GitlinkInTreeError {
  readonly code: "GITLINK_IN_TREE";
  readonly message: string;
}

/** The destination is relative, inside a checkout, or already holds something. */
export interface DestinationRefusedError {
  readonly code: "DESTINATION_REFUSED";
  readonly message: string;
  readonly destination: string;
}

/** A git write in the new repository failed. */
export interface CutWriteFailedError {
  readonly code: "CUT_WRITE_FAILED";
  readonly message: string;
}

/** The new repository is not exactly one parentless commit over the source tree. */
export interface CutMismatchError {
  readonly code: "CUT_MISMATCH";
  readonly message: string;
}

/** The owner's GitHub identity could not be read through the door. */
export interface IdentityUnavailableError {
  readonly code: "IDENTITY_UNAVAILABLE";
  readonly message: string;
}

/** A cut record could not be read or does not parse. */
export interface RecordUnreadableError {
  readonly code: "RECORD_UNREADABLE";
  readonly message: string;
}

/** A cut record or a verification report could not be written. */
export interface RecordWriteFailedError {
  readonly code: "RECORD_WRITE_FAILED";
  readonly message: string;
}

/** The denylist or the private-terms file could not be relied on, so no scan ran. */
export interface ScanInputUnavailableError {
  readonly code: "SCAN_INPUT_UNAVAILABLE";
  readonly message: string;
}

/** The reviewed-residue list could not be read, or a line in it is not a valid owner-address entry. */
export interface ReviewedResidueUnreadableError {
  readonly code: "REVIEWED_RESIDUE_UNREADABLE";
  readonly message: string;
}

/** An entry could not be appended to the reviewed-residue list. */
export interface ReviewedResidueWriteFailedError {
  readonly code: "REVIEWED_RESIDUE_WRITE_FAILED";
  readonly message: string;
}

/** The finding named to `fresh-cut accept` is not exactly one current owner-address finding. */
export interface ReviewedResidueCandidateRefusedError {
  readonly code: "REVIEWED_RESIDUE_CANDIDATE_REFUSED";
  readonly message: string;
}

/** No single visible session could be named as the reader, so no acceptance can say who read the line. */
export interface ReviewerSessionUnavailableError {
  readonly code: "REVIEWER_SESSION_UNAVAILABLE";
  readonly message: string;
}

/** Every fresh-cut failure. */
export type FreshCutError =
  | SourceUnreadableError
  | CommitInvalidError
  | CommitNotOnMainError
  | GitlinkInTreeError
  | DestinationRefusedError
  | CutWriteFailedError
  | CutMismatchError
  | IdentityUnavailableError
  | RecordUnreadableError
  | RecordWriteFailedError
  | ScanInputUnavailableError
  | ReviewedResidueUnreadableError
  | ReviewedResidueWriteFailedError
  | ReviewedResidueCandidateRefusedError
  | ReviewerSessionUnavailableError;

/** The factory every fresh-cut failure is built through. */
export const FreshCutErrors = {
  commitInvalid: ({ given }: { given: string }): CommitInvalidError => ({
    code: "COMMIT_INVALID",
    message: `--commit ${given} is not a commit in the source repository — pass a hexadecimal commit SHA from main`,
  }),
  commitNotOnMain: ({ sha }: { sha: string }): CommitNotOnMainError => ({
    code: "COMMIT_NOT_ON_MAIN",
    message: `commit ${sha} is not reachable from the source repository's local main — cut only from main`,
    sha,
  }),
  cutMismatch: ({ why }: { why: string }): CutMismatchError => ({
    code: "CUT_MISMATCH",
    message: `the new repository is not the cut it should be: ${why}`,
  }),
  cutWriteFailed: ({ step, cause }: { step: string; cause: string }): CutWriteFailedError => ({
    code: "CUT_WRITE_FAILED",
    message: `git ${step} in the new repository failed: ${cause}`,
  }),
  destinationRefused: ({ destination, why }: { destination: string; why: string }): DestinationRefusedError => ({
    code: "DESTINATION_REFUSED",
    destination,
    message: `destination ${destination} refused: ${why}`,
  }),
  gitlinkInTree: ({ path }: { path: string }): GitlinkInTreeError => ({
    code: "GITLINK_IN_TREE",
    message: `the tree holds a submodule at ${path}; its files live in another repository and cannot be scanned`,
  }),
  identityUnavailable: ({ why }: { why: string }): IdentityUnavailableError => ({
    code: "IDENTITY_UNAVAILABLE",
    message: `the owner's GitHub identity could not be read: ${why}`,
  }),
  recordUnreadable: ({ path, why }: { path: string; why: string }): RecordUnreadableError => ({
    code: "RECORD_UNREADABLE",
    message: `the cut record ${path} could not be read: ${why}`,
  }),
  recordWriteFailed: ({ path, cause }: { path: string; cause: string }): RecordWriteFailedError => ({
    code: "RECORD_WRITE_FAILED",
    message: `${path} could not be written: ${cause}`,
  }),
  reviewedResidueCandidateRefused: ({ why }: { why: string }): ReviewedResidueCandidateRefusedError => ({
    code: "REVIEWED_RESIDUE_CANDIDATE_REFUSED",
    message: `nothing accepted: ${why}`,
  }),
  reviewedResidueUnreadable: ({ path, why }: { path: string; why: string }): ReviewedResidueUnreadableError => ({
    code: "REVIEWED_RESIDUE_UNREADABLE",
    message: `the reviewed-residue list ${path} cannot be relied on, so nothing is subtracted: ${why}`,
  }),
  reviewedResidueWriteFailed: ({ path, cause }: { path: string; cause: string }): ReviewedResidueWriteFailedError => ({
    code: "REVIEWED_RESIDUE_WRITE_FAILED",
    message: `${path} could not be appended to: ${cause}`,
  }),
  reviewerSessionUnavailable: (): ReviewerSessionUnavailableError => ({
    code: "REVIEWER_SESSION_UNAVAILABLE",
    message:
      "no single visible session is named in this environment (CLAUDE_CODE_SESSION_ID or a Codex thread id), so no acceptance can say who read the line — run accept from the session that read it",
  }),
  scanInputUnavailable: ({ why }: { why: string }): ScanInputUnavailableError => ({
    code: "SCAN_INPUT_UNAVAILABLE",
    message: why,
  }),
  sourceUnreadable: ({ step, cause }: { step: string; cause: string }): SourceUnreadableError => ({
    code: "SOURCE_UNREADABLE",
    message: `git ${step} in the source repository failed: ${cause}`,
  }),
} as const;
