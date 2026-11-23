/**
 * Why `automation seat` could not retire the board row it registered for a session that never opened.
 *
 * Its own union per `.claude/rules/error-handling.md`, beside `./errors.ts` rather than inside it: the seat branches
 * on exactly one fact — the row was NOT retired, so its claims must stay held — and prints the message. The two codes
 * split a row that is no longer this seat's untouched row (somebody picked it up, edited it, or it never was ours)
 * from a row this process could not read, lock, write or mirror.
 */

/** The row on disk is not the untouched row this seat registered, so cancelling it would cancel somebody's work. */
export interface SeatRowNotOursError {
  readonly code: "SEAT_ROW_NOT_OURS";
  readonly message: string;
  readonly slug: string;
}

/** The row, its lock, its journal or its mirror could not be read or written. */
export interface SeatRowIoError {
  readonly code: "SEAT_ROW_IO";
  readonly message: string;
  readonly slug: string;
}

/** Every reason a seat's row was left as it was. */
export type SeatRetirementError = SeatRowNotOursError | SeatRowIoError;

/** The factories, so every message is worded in one place. */
export const SeatRetirementErrors = {
  io: ({ slug, detail }: { slug: string; detail: string }): SeatRowIoError => ({
    code: "SEAT_ROW_IO",
    message: `automation seat · could not retire ${slug}: ${detail}`,
    slug,
  }),
  notOurs: ({ slug, detail }: { slug: string; detail: string }): SeatRowNotOursError => ({
    code: "SEAT_ROW_NOT_OURS",
    message: `automation seat · ${slug} is no longer the untouched row this seat registered (${detail}), so it is left as it is`,
    slug,
  }),
} as const;
