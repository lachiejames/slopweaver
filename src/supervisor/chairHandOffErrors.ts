/**
 * Why a chair hand-off's journal or note could not be read or written: the domain union for
 * `./chairHandOffStore.ts` and `./chairHandOffNote.ts`, with its one factory.
 */

/** A journal line that does not decode as an event — never skipped, since a skipped step could seat twice. */
export interface HandOffJournalMalformedError {
  readonly code: "JOURNAL_MALFORMED";
  readonly message: string;
  readonly path: string;
  readonly line: number;
}

/** The journal, its directory or a note file would not read or write. */
export interface HandOffIoError {
  readonly code: "HAND_OFF_IO";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** The short journal lock another writer holds. */
export interface HandOffLockHeldError {
  readonly code: "LOCK_HELD";
  readonly message: string;
}

/** A note the episode will not take: unknown, not asked yet, already noted, or too late. */
export interface HandOffNoteRefusedError {
  readonly code: "NOTE_REFUSED";
  readonly message: string;
}

/** One failure of the chair hand-off's journal or note. */
export type ChairHandOffError =
  HandOffJournalMalformedError | HandOffIoError | HandOffLockHeldError | HandOffNoteRefusedError;

/** The one constructor per failure. */
export const ChairHandOffErrors = {
  io: ({ cause, path }: { cause: unknown; path: string }): HandOffIoError => ({
    cause,
    code: "HAND_OFF_IO",
    message: `${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    path,
  }),
  lockHeld: ({ detail }: { detail: string }): HandOffLockHeldError => ({
    code: "LOCK_HELD",
    message: `another writer holds the hand-off journal's lock: ${detail}`,
  }),
  malformed: ({ path, line, why }: { path: string; line: number; why: string }): HandOffJournalMalformedError => ({
    code: "JOURNAL_MALFORMED",
    line,
    message: `${path} line ${String(line)} is not a chair hand-off event (${why}); repair or remove that line by hand — a skipped step could seat a second successor`,
    path,
  }),
  noteRefused: ({ why }: { why: string }): HandOffNoteRefusedError => ({ code: "NOTE_REFUSED", message: why }),
} as const;
