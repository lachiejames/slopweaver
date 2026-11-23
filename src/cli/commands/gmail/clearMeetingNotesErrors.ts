/**
 * The typed failures of one `gmail clear-meeting-notes` run AFTER its argv parsed — each one a step that could
 * not answer, so the run archives nothing it has not proven and exits 1. A union of its own per
 * `.claude/rules/error-handling.md`: the argv refusals are `./errors.ts`'s `GmailArgsError`, and these name what
 * the mailbox, bronze, the store or the board said instead.
 */

/** The mailbox could not be listed or a message could not be read. */
export interface MailReadFailedError {
  readonly code: "MAIL_READ_FAILED";
  readonly message: string;
}

/** The Gmail grant the Docs seam is built from would not resolve. */
export interface DocsReadFailedError {
  readonly code: "DOCS_READ_FAILED";
  readonly message: string;
}

/** Gmail bronze could not be read to prove a transcript. */
export interface BronzeReadFailedError {
  readonly code: "BRONZE_READ_FAILED";
  readonly message: string;
}

/** The targeted transcript commit wrote nothing. */
export interface BronzeCommitFailedError {
  readonly code: "BRONZE_COMMIT_FAILED";
  readonly message: string;
}

/** The store could not be asked which transcripts it holds. */
export interface StoreProbeFailedError {
  readonly code: "STORE_PROBE_FAILED";
  readonly message: string;
}

/** Replaying gmail bronze into the store failed. */
export interface StoreReplayFailedError {
  readonly code: "STORE_REPLAY_FAILED";
  readonly message: string;
}

/** The Queue card for a kept mail could not be placed or read back. */
export interface CardFailedError {
  readonly code: "CARD_FAILED";
  readonly message: string;
  readonly slug: string;
}

/** Every way a step of the run can fail. */
export type ClearMeetingNotesError =
  | MailReadFailedError
  | DocsReadFailedError
  | BronzeReadFailedError
  | BronzeCommitFailedError
  | StoreProbeFailedError
  | StoreReplayFailedError
  | CardFailedError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const ClearMeetingNotesErrors = {
  bronzeCommitFailed: ({ message }: { message: string }): BronzeCommitFailedError => ({
    code: "BRONZE_COMMIT_FAILED",
    message: `transcript commit: ${message}`,
  }),
  bronzeReadFailed: ({ message }: { message: string }): BronzeReadFailedError => ({
    code: "BRONZE_READ_FAILED",
    message: `bronze proof: ${message}`,
  }),
  cardFailed: ({ slug, message }: { slug: string; message: string }): CardFailedError => ({
    code: "CARD_FAILED",
    message: `Queue card ${slug}: ${message}`,
    slug,
  }),
  docsReadFailed: ({ message }: { message: string }): DocsReadFailedError => ({
    code: "DOCS_READ_FAILED",
    message: `meeting documents: ${message}`,
  }),
  mailReadFailed: ({ message }: { message: string }): MailReadFailedError => ({
    code: "MAIL_READ_FAILED",
    message: `mailbox read: ${message}`,
  }),
  storeProbeFailed: ({ message }: { message: string }): StoreProbeFailedError => ({
    code: "STORE_PROBE_FAILED",
    message: `store probe: ${message}`,
  }),
  storeReplayFailed: ({ message }: { message: string }): StoreReplayFailedError => ({
    code: "STORE_REPLAY_FAILED",
    message: `store replay: ${message}`,
  }),
} as const;
