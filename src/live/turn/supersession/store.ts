/**
 * The supersession journal's effectful edge: append one row, read the log back.
 *
 * Owner-only, the same treatment `../completionStore.ts` gives the completion log and for the same reason —
 * a row names a channel, a thread and two message timestamps, which is the ask's identity by another route.
 * `mkdirSync`'s own `mode` is umask-masked and never tightens an EXISTING directory, so the unconditional
 * `chmodSync` beside it is what actually closes that gap.
 *
 * The APPEND is deliberately unforgiving where the read is deliberately tolerant. A write that fails throws,
 * because a supersession whose record did not land is exactly the thing this journal exists to make
 * impossible to miss; a line that will not parse is skipped, because the log outlives every version of this
 * program that wrote to it and one unreadable row must not make an audit of the rest impossible. The two
 * halves of that tolerance are reported SEPARATELY — the rows that parsed, and the line numbers that did
 * not — because an AUDIT can proceed past a bad line and `./atMostOnce.ts` cannot: a row it cannot read is
 * a row that might have named the pair it is asking about.
 */
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { readJsonlLines } from "../../../corpus/corpusStore.js";
import { appendLines } from "../../../lib/appendSeparator.js";
import { isRecord } from "../../../lib/parsers.js";
import { stateHomePaths } from "../../../stateHome.js";
import {
  type SupersessionEvent,
  type SupersessionIntent,
  type SupersessionResult,
  supersessionEventLine,
} from "./journal.js";

/** Owner-only permissions: a row carries the thread a correction ran in and both message timestamps. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * The supersession journal's absolute path.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the path to `live/slack/supersessions.jsonl`
 */
export function supersessionLogPath({ home }: { home?: string } = {}): string {
  return stateHomePaths(home === undefined ? {} : { home }).live.slack.supersessionsJsonl;
}

/**
 * Append one row, creating and tightening the directory if needed.
 *
 * **It separates itself from a torn tail rather than trusting one**, through `appendLines`. MEASURED: a journal ending in a partial write
 * swallowed the intent row appended after it, the fold that {@link readSupersessionLog} feeds never saw that pair,
 * and a repeated correction issued a second `chat.delete`. One byte of separator is the whole fix, and
 * `./atMostOnce.ts` holds down the other half — a line that will not parse is "cannot tell", not "absent".
 *
 * @param event the row to append
 * @param home the state home (defaults to the resolved home)
 */
export function appendSupersessionEvent({ event, home }: { event: SupersessionEvent; home?: string }): void {
  const path = supersessionLogPath(home === undefined ? {} : { home });
  const dir = dirname(path);
  mkdirSync(dir, { mode: DIR_MODE, recursive: true });
  chmodSync(dir, DIR_MODE);
  appendLines({ mode: FILE_MODE, path, text: `${supersessionEventLine({ event })}\n` });
  chmodSync(path, FILE_MODE);
}

/**
 * Read the whole journal, STREAMED — one line at a time, never the file as one string.
 *
 * `readJsonlLines` rather than a `readFileSync`, and the reason is the `whole-file-json` rule rather than a
 * measurement on this particular log: it is append-only with no ceiling, so its size is set by how many
 * corrections this install has ever made, and nothing in the code that writes it bounds that. A reader
 * written the cheap way is correct until the day it is not, and that day has no warning attached to it.
 *
 * An absent log — a home where no correction has ever superseded an answer — is an empty result, not an
 * error: a fresh install has never journalled one, and that is the ordinary case rather than a failure.
 *
 * **Every OTHER way the read can fail is reported, and that distinction is load-bearing** rather than
 * tidiness. `./atMostOnce.ts` asks this log whether a delete was already attempted, so a blanket catch
 * answering "no rows" makes an unreadable journal say "never attempted" — the one answer that lets an
 * irreversible act run twice. MEASURED: with the file at mode `0200` the read failed, the append still
 * succeeded, and a repeated turn issued a second `chat.delete` against the same message. `ENOENT` is the
 * only exception, because it is the fresh install above and nothing else.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the parsed rows in file order, the 1-indexed line numbers that could not be read, and what the
 *   read itself failed with when the file exists but could not be opened
 */
export function readSupersessionLog({ home }: { home?: string } = {}): {
  readonly events: readonly SupersessionEvent[];
  readonly unreadable: readonly number[];
  readonly readFailure: string | undefined;
} {
  const events: SupersessionEvent[] = [];
  const unreadable: number[] = [];
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        const row = parseSupersessionLine({ line });
        if (row === undefined) {
          if (!isBlankLine({ line })) {
            unreadable.push(index + 1);
          }
          return;
        }
        events.push(row);
      },
      path: supersessionLogPath(home === undefined ? {} : { home }),
    });
  } catch (cause) {
    if (isRecord(cause) && cause["code"] === "ENOENT") {
      return { events: [], readFailure: undefined, unreadable: [] };
    }
    return { events: [], readFailure: readFailureText({ cause }), unreadable: [] };
  }
  return { events, readFailure: undefined, unreadable };
}

/**
 * Whether a line carries nothing a row could have been, by JSON's OWN definition of whitespace.
 *
 * `String.prototype.trim` is the wrong test and `readSupersessionLog` used it. It strips every Unicode
 * space, so a line of one vertical tab reads as blank while `JSON.parse` rejects it — a byte that is not a
 * row and not nothing, skipped silently, which is exactly the "we cannot tell" `./atMostOnce.ts` must see.
 * A review seeded a journal with `0b 0a` and watched a correction delete as if the log were
 * empty. JSON allows four whitespace bytes and this is that list, not a subset chosen for convenience.
 */
function isBlankLine({ line }: { line: string }): boolean {
  for (const character of line) {
    if (character !== " " && character !== "\t" && character !== "\n" && character !== "\r") {
      return false;
    }
  }
  return true;
}

/** What a failed open is worth saying out loud — the thrown message, or the value itself when it is not one. */
function readFailureText({ cause }: { cause: unknown }): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
}

/** Whether a decoded line is a well-formed intent row. */
function isIntent(value: unknown): value is SupersessionIntent {
  return (
    isRecord(value) &&
    value["kind"] === "supersession-intended" &&
    typeof value["turnId"] === "string" &&
    typeof value["channel"] === "string" &&
    typeof value["threadTs"] === "string" &&
    typeof value["answerTs"] === "string" &&
    typeof value["targetTs"] === "string" &&
    typeof value["supersededTurnId"] === "string" &&
    typeof value["reason"] === "string"
  );
}

/** Whether an OPTIONAL field is either absent or the string its type says it is. */
function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

/**
 * Whether a decoded line is a well-formed result row, including its closed `outcome` vocabulary.
 *
 * The two OPTIONAL fields are checked as carefully as the required ones, which is not symmetry for its own
 * sake. A review read back a row carrying `code: 42` and `detail: { broken: true }`: every
 * required field was right, so the reader called it well-formed and the guard that asks this log whether a
 * delete was already attempted treated the whole journal as trustworthy. A row whose declared type is a lie
 * is a row this build cannot read, and that is the answer `./atMostOnce.ts` needs to hear.
 */
function isSettled(value: unknown): value is SupersessionResult {
  if (!isRecord(value)) {
    return false;
  }
  const outcome = value["outcome"];
  return (
    value["kind"] === "supersession-settled" &&
    typeof value["turnId"] === "string" &&
    typeof value["targetTs"] === "string" &&
    isOptionalString(value["code"]) &&
    isOptionalString(value["detail"]) &&
    (outcome === "deleted" || outcome === "already-gone" || outcome === "refused" || outcome === "unconfirmed")
  );
}

/**
 * One journal line as a row, or `undefined` when it is not one this build can read.
 *
 * The single place a line is decoded, so the streamed read and the text parse cannot disagree about what a
 * valid row is — the dedup lesson applied to a reader rather than to a result type.
 */
function parseSupersessionLine({ line }: { line: string }): SupersessionEvent | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || typeof parsed["tsIso"] !== "string" || parsed["schemaVersion"] !== 1) {
    return undefined;
  }
  if (isIntent(parsed) || isSettled(parsed)) {
    return parsed;
  }
  return undefined;
}

/**
 * Parse the journal's text into rows, in file order — tolerant of a malformed line, the same posture the
 * completion log and the door ledger take.
 *
 * Takes TEXT the caller already has in hand (a fixture, a test's own literal). To read the log off disk use
 * {@link readSupersessionLog}, which streams it — the log has no size ceiling and this signature does.
 *
 * @param text the raw log contents
 * @returns the parsed rows and the 1-indexed line numbers that could not be read
 */
export function parseSupersessionLog({ text }: { text: string }): {
  readonly events: readonly SupersessionEvent[];
  readonly unreadable: readonly number[];
} {
  const events: SupersessionEvent[] = [];
  const unreadable: number[] = [];
  text.split("\n").forEach((line, index) => {
    if (isBlankLine({ line })) {
      return;
    }
    const row = parseSupersessionLine({ line });
    if (row === undefined) {
      unreadable.push(index + 1);
      return;
    }
    events.push(row);
  });
  return { events, unreadable };
}
