/**
 * Appending and reading the drawdown journal — the effectful half of {@link ./drawdownJournal}.
 *
 * The read STREAMS. This journal grows by one line per plan per window per tick and is expected to hold a
 * week of them, so its size is a property of how long the watch has run rather than of anything in the code
 * — exactly the class `.claude/rules/typescript-patterns.md` keeps out of a single JS string. It goes
 * through `readJsonlLines` for that reason, not for speed.
 *
 * `home` is REQUIRED rather than defaulted. Every other journal in this tree defaults to the resolved state
 * home, which is right for a hook that has no caller to ask; this one is only ever written by a verb that
 * already knows its home, and defaulting would let a test write into the operator's real journal and skew
 * the baseline the fleet is judged by.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { appendLines } from "../lib/appendSeparator.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import { type ClaudeError, ClaudeErrors } from "./claudeErrors.js";
import { type DrawdownJournalEvent, type DrawdownJournalRead, parseDrawdownJournalLine } from "./drawdownJournal.js";

/** Owner-only permissions, matching `../admit/reachGrantStore.ts`. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * The drawdown journal's absolute path.
 *
 * @param home the state home to resolve under
 * @returns the path to `claude-accounts/drawdown.jsonl`
 */
export function drawdownJournalPath({ home }: { home: string }): string {
  return stateHomePaths({ home }).drawdownJsonl;
}

/**
 * Every event the journal holds.
 *
 * An absent journal is an empty read rather than a failure — a watch that has never run has no history, and
 * that is the `warming` case the detector already handles. A journal that exists and cannot be opened IS a
 * failure, because silently treating it as empty would reset the baseline and make the next real episode
 * invisible.
 *
 * @param home the state home to read under
 * @returns the events in file order, with the count of lines that could not be parsed
 */
export function readDrawdownJournal({ home }: { home: string }): Result<DrawdownJournalRead, ClaudeError> {
  const path = drawdownJournalPath({ home });
  const events: DrawdownJournalEvent[] = [];
  let unreadable = 0;
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        if (line.trim().length === 0) {
          return;
        }
        const parsed = parseDrawdownJournalLine({ line });
        if (parsed.isErr()) {
          unreadable += 1;
          return;
        }
        events.push(parsed.value);
      },
      path,
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return ok({ events: [], unreadable: 0 });
    }
    return err(ClaudeErrors.drawdownReadFailed({ detail: error instanceof Error ? error.message : "unknown" }));
  }
  return ok({ events, unreadable });
}

/**
 * Append events to the journal.
 *
 * @param home the state home to write under
 * @param events the events to append, in order
 * @returns nothing, or why the append failed — a sample nobody recorded is a hole in the baseline
 */
export function appendDrawdownJournal({
  home,
  events,
}: {
  home: string;
  events: readonly DrawdownJournalEvent[];
}): Result<undefined, ClaudeError> {
  if (events.length === 0) {
    return ok(undefined);
  }
  const path = drawdownJournalPath({ home });
  try {
    mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
    appendLines({ mode: FILE_MODE, path, text: `${events.map((event) => JSON.stringify(event)).join("\n")}\n` });
  } catch (error) {
    return err(ClaudeErrors.drawdownAppendFailed({ detail: error instanceof Error ? error.message : "unknown" }));
  }
  return ok(undefined);
}
