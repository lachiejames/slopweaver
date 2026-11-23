/**
 * The as-me send failure journal's effectful edge: append a failure, read the journal back. Every decision is
 * `../outbound/slack/sendFailureJournal.ts`'s; this is the file, `$SLOPWEAVER_HOME/ledgers/slack-send-failures.jsonl`,
 * written `0600` inside a `0700` directory because a refusal's words can quote what the owner was about to say.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { appendLines } from "#lib/appendSeparator.js";
import { isAbsentError } from "#lib/presentFile.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { err, ok, type Result } from "../lib/result.js";
import { parseSendFailure, type SlackSendFailure, sendFailureLine } from "../outbound/slack/sendFailureJournal.js";
import { stateHomePaths } from "../stateHome.js";

/** Owner-only permissions. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** The journal could not be appended to. */
export interface SendFailureJournalUnwritableError {
  readonly code: "JOURNAL_UNWRITABLE";
  readonly message: string;
  readonly path: string;
}

/** The journal exists and could not be read. */
export interface SendFailureJournalUnreadableError {
  readonly code: "JOURNAL_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The journal read, but holds lines that are not a failure, any of which may be the newest one. */
export interface SendFailureJournalTornError {
  readonly code: "JOURNAL_TORN";
  readonly message: string;
  readonly path: string;
  readonly lines: readonly number[];
}

/** Why the send failure journal could not be used. */
export type SendFailureJournalError =
  SendFailureJournalUnwritableError | SendFailureJournalUnreadableError | SendFailureJournalTornError;

/** Factories for {@link SendFailureJournalError}. */
export const SendFailureJournalErrors = {
  torn: ({ path, lines }: { path: string; lines: readonly number[] }): SendFailureJournalTornError => ({
    code: "JOURNAL_TORN",
    lines,
    message: `the send failure journal ${path} has lines that are not a failure (${lines.map(String).join(", ")}), any of which may be the newest`,
    path,
  }),
  unreadable: ({ path, cause }: { path: string; cause: unknown }): SendFailureJournalUnreadableError => ({
    code: "JOURNAL_UNREADABLE",
    message: `the send failure journal ${path} could not be read: ${String(cause)}`,
    path,
  }),
  unwritable: ({ path, cause }: { path: string; cause: unknown }): SendFailureJournalUnwritableError => ({
    code: "JOURNAL_UNWRITABLE",
    message: `the send failure journal ${path} could not be written: ${String(cause)}`,
    path,
  }),
} as const;

/**
 * Append one failure to the journal, creating its directory if needed. A journal that cannot be written is
 * returned, never thrown: the send already failed, and its own refusal is what the caller prints.
 *
 * @param failure the send that did not go out
 * @param home the state home the journal lives under
 * @returns nothing on success, or why the journal could not be written
 */
export function appendSlackSendFailure({
  failure,
  home,
}: {
  failure: SlackSendFailure;
  home: string;
}): Result<true, SendFailureJournalError> {
  const path = stateHomePaths({ home }).slackSendFailuresJsonl;
  try {
    mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
    appendLines({ mode: FILE_MODE, path, text: `${sendFailureLine({ failure })}\n` });
  } catch (cause: unknown) {
    return err(SendFailureJournalErrors.unwritable({ cause, path }));
  }
  return ok(true);
}

/**
 * Every failure the journal holds, streamed line by line. An absent journal — nothing has ever failed — is no
 * failures; one that exists and cannot be read is an error, and so is one holding a line that is not a failure,
 * since that line may be the newest — so a caller never reads "nothing failed" off a read that did not happen.
 *
 * @param home the state home the journal lives under
 * @returns every failure in file order, or why the journal could not be read whole
 */
export function readSlackSendFailures({
  home,
}: {
  home: string;
}): Result<readonly SlackSendFailure[], SendFailureJournalError> {
  const path = stateHomePaths({ home }).slackSendFailuresJsonl;
  const failures: SlackSendFailure[] = [];
  const torn: number[] = [];
  try {
    readJsonlLines({
      onLine: ({ index, line }) => {
        const failure = parseSendFailure({ line });
        if (failure !== undefined) {
          failures.push(failure);
        } else if (line.trim() !== "") {
          torn.push(index + 1);
        }
      },
      path,
      // A byte that is not UTF-8 delivers a line `parseSendFailure` refuses, so it is torn, never a repaired failure.
      strictUtf8: true,
    });
  } catch (cause: unknown) {
    // The read decides absence, never `existsSync`: that answers false for a journal behind an unsearchable directory.
    if (isAbsentError({ error: cause, path })) {
      return ok(failures);
    }
    return err(SendFailureJournalErrors.unreadable({ cause, path }));
  }
  if (torn.length > 0) {
    return err(SendFailureJournalErrors.torn({ lines: torn, path }));
  }
  return ok(failures);
}
