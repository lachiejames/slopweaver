/**
 * The typed failures of WRITING a board row's tags — `handover tag` and `register --tag` — its own union, per
 * `.claude/rules/error-handling.md`. Distinct from `./rowTagErrors.ts`, which judges one tag's spelling: these are
 * facts about the board and the journal a spelling-correct write met.
 *
 * Each variant is a different next move: a busy lock is retried, a partial board is fixed first, a second claimant
 * or a non-canonical file is renamed, an unreadable journal is repaired or pulled for, a refused request is
 * corrected, a failed append is investigated with its own typed cause.
 *
 * Pure: every factory builds a value.
 */

import type { IngestError } from "#lib/ingestError.js";

import type { RowWriteError } from "./rowEventErrors.js";

/** Another tag write or registration held the board-wide lock past the wait. */
export interface TagLockBusyError {
  readonly code: "TAG_LOCK_BUSY";
  readonly message: string;
}

/** The board scan could not read every doc, so which rows claim the slug is not knowable. */
export interface TagBoardPartialError {
  readonly code: "TAG_BOARD_PARTIAL";
  readonly message: string;
  readonly unreadable: readonly string[];
}

/** The board scan itself failed. */
export interface TagBoardUnreadError {
  readonly code: "TAG_BOARD_UNREAD";
  readonly message: string;
  readonly cause: IngestError;
}

/** The slug is not the one live row a tag could land on: none, several, or one filed under another name. */
export interface TagRowIdentityError {
  readonly code: "TAG_ROW_IDENTITY";
  readonly message: string;
  readonly slug: string;
}

/** A registration would inherit a journal or an archived row the slug already names. */
export interface TagSlugHasHistoryError {
  readonly code: "TAG_SLUG_HAS_HISTORY";
  readonly message: string;
  readonly path: string;
}

/** Whether the slug already has history could not be told — a path that would not stat, an archive that would not read. */
export interface TagHistoryUnknownError {
  readonly code: "TAG_HISTORY_UNKNOWN";
  readonly message: string;
  readonly what: string;
}

/** The row's journal could not be read whole. */
export interface TagJournalUnreadableError {
  readonly code: "TAG_JOURNAL_UNREADABLE";
  readonly message: string;
  readonly slug: string;
}

/** The request is well-spelt but the board refuses it — a new value unacknowledged, an acknowledgement misplaced. */
export interface TagRequestRefusedError {
  readonly code: "TAG_REQUEST_REFUSED";
  readonly message: string;
  readonly problems: readonly string[];
}

/** The journal's one writer refused or failed the append. */
export interface TagAppendFailedError {
  readonly code: "TAG_APPEND_FAILED";
  readonly message: string;
  readonly cause: RowWriteError;
}

/** Every way a tag write can fail after its spelling was accepted. */
export type TagWriteError =
  | TagLockBusyError
  | TagBoardPartialError
  | TagBoardUnreadError
  | TagRowIdentityError
  | TagSlugHasHistoryError
  | TagHistoryUnknownError
  | TagJournalUnreadableError
  | TagRequestRefusedError
  | TagAppendFailedError;

export const TagWriteErrors = {
  appendFailed: ({ cause }: { cause: RowWriteError }): TagAppendFailedError => ({
    cause,
    code: "TAG_APPEND_FAILED",
    message: cause.message,
  }),
  boardPartial: ({ unreadable }: { unreadable: readonly string[] }): TagBoardPartialError => ({
    code: "TAG_BOARD_PARTIAL",
    message: `the board has ${String(unreadable.length)} unreadable doc(s) (${unreadable.join(", ")}), and any of them could claim this slug — fix them first`,
    unreadable,
  }),
  boardUnread: ({ cause }: { cause: IngestError }): TagBoardUnreadError => ({
    cause,
    code: "TAG_BOARD_UNREAD",
    message: `the board could not be scanned: ${cause.message}`,
  }),
  historyUnknown: ({ what, why }: { what: string; why: string }): TagHistoryUnknownError => ({
    code: "TAG_HISTORY_UNKNOWN",
    message: `cannot tell whether ${what}: ${why}`,
    what,
  }),
  journalUnreadable: ({ slug, why }: { slug: string; why: string }): TagJournalUnreadableError => ({
    code: "TAG_JOURNAL_UNREADABLE",
    message: `${slug}'s journal cannot be read whole, so what it already holds is not knowable: ${why}`,
    slug,
  }),
  lockBusy: ({ why }: { why: string }): TagLockBusyError => ({
    code: "TAG_LOCK_BUSY",
    message: `another tag write or registration held the board's tag lock throughout the wait — run it again: ${why}`,
  }),
  requestRefused: ({ problems }: { problems: readonly string[] }): TagRequestRefusedError => ({
    code: "TAG_REQUEST_REFUSED",
    message: problems.join("; "),
    problems,
  }),
  rowIdentity: ({ slug, why }: { slug: string; why: string }): TagRowIdentityError => ({
    code: "TAG_ROW_IDENTITY",
    message: `${slug}: ${why}`,
    slug,
  }),
  slugHasHistory: ({ path }: { path: string }): TagSlugHasHistoryError => ({
    code: "TAG_SLUG_HAS_HISTORY",
    message: `${path} already exists, so a new row under this slug would inherit its history — pass --slug for a distinct row`,
    path,
  }),
} as const;
