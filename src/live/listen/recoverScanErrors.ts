/**
 * The typed failure of ONE read inside a manual recovery scan — the thing that has to survive from the
 * pagination call that produced it to the classifier that decides what it means.
 *
 * It exists because the manual scan used to `unwrap` the pagination `Result` and re-catch the throw as an
 * untyped message string, which destroyed the one field that decides everything: `SlackPageError`'s own
 * `code`. `permanentExclusion` (`./recoverShared.ts`) reads that code to tell "the bot is not a member, and
 * never will be until a human invites it" apart from "this read failed and a retry may well work", and the
 * scheduled sweep has always had it. Carrying the whole `SlackPageError` through rather than a flattened
 * string is what lets manual recovery consult the same classifier instead of growing a second one.
 *
 * Two variants rather than one because the two reads carry different context and the caller projects them
 * onto {@link RecoveryCoverageFailure}'s own `history` and `thread` stages, and the thread stage names a
 * `messageTs` the history stage has no analogue for.
 */
import type { SlackPageError } from "../slack/errors.js";

/** One channel's `conversations.history` window could not be read completely. */
export interface ManualRecoveryHistoryReadError {
  readonly code: "HISTORY_READ_FAILED";
  readonly message: string;
  readonly channel: string;
  /** The pagination failure verbatim — `permanentExclusion` reads its `code`, not this wrapper's. */
  readonly error: SlackPageError;
}

/** One thread inside a channel could not be read completely. */
export interface ManualRecoveryThreadReadError {
  readonly code: "THREAD_READ_FAILED";
  readonly message: string;
  readonly channel: string;
  /** The thread ROOT the read was for. */
  readonly messageTs: string;
  /** The pagination failure verbatim — `permanentExclusion` reads its `code`, not this wrapper's. */
  readonly error: SlackPageError;
}

/** Every failure one channel's manual scan can produce. A channel stops at its FIRST one. */
export type ManualRecoveryReadError = ManualRecoveryHistoryReadError | ManualRecoveryThreadReadError;

/** Factories for every {@link ManualRecoveryReadError} variant. */
export const ManualRecoveryReadErrors = {
  /**
   * Build a {@link ManualRecoveryHistoryReadError} — one channel's history window was not readable.
   *
   * @param error the pagination failure, carried whole so the caller can classify it
   * @returns the typed error
   */
  history: ({ channel, error }: { channel: string; error: SlackPageError }): ManualRecoveryHistoryReadError => ({
    channel,
    code: "HISTORY_READ_FAILED",
    error,
    message: error.message,
  }),

  /**
   * Build a {@link ManualRecoveryThreadReadError} — one thread inside a channel was not readable.
   *
   * @param error the pagination failure, carried whole so the caller can classify it
   * @param messageTs the thread ROOT the read was for
   * @returns the typed error
   */
  thread: ({
    channel,
    error,
    messageTs,
  }: {
    channel: string;
    error: SlackPageError;
    messageTs: string;
  }): ManualRecoveryThreadReadError => ({
    channel,
    code: "THREAD_READ_FAILED",
    error,
    message: error.message,
    messageTs,
  }),
} as const;
