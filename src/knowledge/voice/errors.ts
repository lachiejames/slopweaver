/**
 * The proposal queue's own typed failure union.
 *
 * A union rather than `readonly string[]` because these kinds are BRANCHED ON, which is the test
 * `.claude/rules/error-handling.md` sets: `knowledge propose` exits differently on a quote that is not in
 * the unit than on a batch file that has moved under it, and the second one means "re-run the scan" while
 * the first means "re-read their words". Conflating them would tell a session to redo the wrong half.
 *
 * Separate from `../errors.ts`'s `KnowledgeError` on the same rule's instruction — no shared base type
 * across domains, ever. A lesson and a proposal fail in different ways: a lesson can have an invalid tier,
 * a proposal can have a quote its unit does not contain, and neither vocabulary has anything to say about
 * the other.
 */

/** The batch file a proposal cites is missing, unreadable, or not a batch this code wrote. */
export interface BatchUnreadableError {
  readonly code: "BATCH_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The batch does not carry the unit the proposal names. */
export interface UnitNotInBatchError {
  readonly code: "UNIT_NOT_IN_BATCH";
  readonly message: string;
  readonly unitId: string;
}

/** The unit's text no longer hashes to its own id, so the batch was hand-edited after it was written. */
export interface UnitTamperedError {
  readonly code: "UNIT_TAMPERED";
  readonly message: string;
  readonly unitId: string;
}

/** The quoted span does not occur in the unit's exact text. */
export interface QuoteNotFoundError {
  readonly code: "QUOTE_NOT_FOUND";
  readonly message: string;
  readonly unitId: string;
}

/** A field is absent, empty, too long, or outside its closed vocabulary. */
export interface ProposalFieldError {
  readonly code: "PROPOSAL_FIELD";
  readonly message: string;
  readonly field: string;
}

/** A stored proposal line could not be decoded. Carries the line number so the file can be inspected. */
export interface ProposalCorruptError {
  readonly code: "PROPOSAL_CORRUPT";
  readonly message: string;
  readonly lineNumber: number;
}

/** The queue could not be read or appended to. Never conflated with an EMPTY queue. */
export interface QueueUnreadableError {
  readonly code: "QUEUE_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause?: unknown;
}

/** The queue holds no OPEN proposal under the id they are answering. */
export interface ProposalNotOpenError {
  readonly code: "PROPOSAL_NOT_OPEN";
  readonly message: string;
  readonly proposalId: string;
}

/** Every way this domain fails. */
export type BeliefError =
  | BatchUnreadableError
  | UnitNotInBatchError
  | UnitTamperedError
  | QuoteNotFoundError
  | ProposalFieldError
  | ProposalCorruptError
  | QueueUnreadableError
  | ProposalNotOpenError;

/** Constructors for {@link BeliefError}. The only place a belief error is built. */
export const BeliefErrors = {
  batchUnreadable: ({ path, why }: { path: string; why: string }): BatchUnreadableError => ({
    code: "BATCH_UNREADABLE",
    message: `could not read the voice batch at ${path} — ${why}. Re-run \`slopweaver knowledge voice --out <path>\``,
    path,
  }),
  unitNotInBatch: ({ unitId }: { unitId: string }): UnitNotInBatchError => ({
    code: "UNIT_NOT_IN_BATCH",
    message:
      `the batch carries no unit ${unitId}. A proposal is only ever made against a unit in the batch it was ` +
      "read from, so the quote can be checked against their actual words",
    unitId,
  }),
  unitTampered: ({ unitId }: { unitId: string }): UnitTamperedError => ({
    code: "UNIT_TAMPERED",
    message:
      `unit ${unitId} in the batch no longer hashes to its own id, so its text was edited after the scan ` +
      "wrote it. Re-run the scan rather than repairing the file",
    unitId,
  }),
  quoteNotFound: ({ unitId }: { unitId: string }): QuoteNotFoundError => ({
    code: "QUOTE_NOT_FOUND",
    message:
      `the quote does not occur in unit ${unitId}'s text. A proposal cites THEIR words verbatim, so a quote ` +
      "that has been tidied, re-spaced or paraphrased is refused rather than recorded",
    unitId,
  }),
  field: ({ field, why }: { field: string; why: string }): ProposalFieldError => ({
    code: "PROPOSAL_FIELD",
    field,
    message: `${field} ${why}`,
  }),
  proposalNotOpen: ({ proposalId, answered }: { proposalId: string; answered: boolean }): ProposalNotOpenError => ({
    code: "PROPOSAL_NOT_OPEN",
    message: answered
      ? `proposal ${proposalId} has already been answered. They may change their mind — propose the claim again ` +
        "and answer that, rather than overwriting what they said before"
      : `the queue holds no proposed belief ${proposalId}. Read the block they are looking at, or run ` +
        "`slopweaver knowledge propose` first — an answer is only ever recorded against a real proposal",
    proposalId,
  }),
  corrupt: ({ lineNumber }: { lineNumber: number }): ProposalCorruptError => ({
    code: "PROPOSAL_CORRUPT",
    lineNumber,
    message: `line ${String(lineNumber)} of the proposal queue is not a decodable row`,
  }),
  queueUnreadable: ({ path, cause }: { path: string; cause: unknown }): QueueUnreadableError => ({
    cause,
    code: "QUEUE_UNREADABLE",
    message: `could not read the proposal queue at ${path} — refusing rather than reporting it empty`,
    path,
  }),
} as const;
