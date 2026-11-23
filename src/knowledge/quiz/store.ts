/**
 * The quiz ledger on disk: `$SLOPWEAVER_HOME/knowledge/quiz.jsonl`, append-only, one row per line.
 *
 * ## Why it is a THIRD file and not a column on either of the other two
 *
 * It is not the register: a question is not a lesson, and a sweep that asked one has learned nothing. It is
 * not the proposal queue either, and that distinction is the sharper one — a proposal is a claim read out
 * of THEIR words waiting on their mark, while a quiz is a claim the FLEET learned waiting on their answer. They
 * run in opposite directions (`./types.ts`), so a reader that had to tell them apart by a field would
 * eventually get one wrong.
 *
 * ## The read REFUSES rather than reporting empty
 *
 * The same call `../store.ts` and `../voice/store.ts` make. An unreadable ledger must not be
 * indistinguishable from one nobody has written to: the first means the sweep cannot know what it already
 * asked, and the second means it may ask anything.
 *
 * ## Streamed, not read whole
 *
 * One row per sweep, forever. `readJsonlLines` from the first commit rather than after it gets big, per
 * `.claude/rules/typescript-patterns.md`'s `whole-file-json` rule.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { readJsonlLines } from "../../corpus/corpusStore.js";
import { appendLines } from "../../lib/appendSeparator.js";
import { errorMessage } from "../../lib/errorMessage.js";
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { type QuizError, QuizErrors } from "./errors.js";
import { parseQuizLine } from "./select.js";
import type { QuizEvent } from "./types.js";

/** Owner-only permissions, matching `../store.ts` — the ledger quotes their own answers. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * The ledger's absolute path.
 *
 * @internal — the two readers below, and a test naming the file it asserts on. Nothing outside this module
 * addresses the ledger by path: `./select.ts` is the only other way to read what it holds.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the path to `knowledge/quiz.jsonl`
 */
export function quizPath({ home }: { home?: string } = {}): string {
  return join(stateHomePaths(home === undefined ? {} : { home }).knowledge, "quiz.jsonl");
}

/**
 * Every event the ledger holds, in the order they were written.
 *
 * A ledger that does not exist yet is EMPTY and is not an error — the ordinary state before the first
 * sweep. One that exists and holds a line this code cannot decode is an error and says which line.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns every event, or the first failure
 */
export function readQuiz({ home }: { home?: string } = {}): Result<readonly QuizEvent[], QuizError> {
  const path = quizPath(home === undefined ? {} : { home });
  if (!existsSync(path)) {
    return ok([]);
  }
  const events: QuizEvent[] = [];
  let failure: QuizError | undefined;
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (failure !== undefined || line.trim().length === 0) {
          return;
        }
        const parsed = parseQuizLine({ line });
        if (parsed === undefined) {
          failure = QuizErrors.corrupt({ lineNumber: index + 1 });
          return;
        }
        events.push(parsed);
      },
      path,
    });
  } catch (cause) {
    return err(QuizErrors.unreadable({ cause, path }));
  }
  if (failure !== undefined) {
    return err(failure);
  }
  return ok(events);
}

/**
 * Append one event, creating the ledger if it is not there yet.
 *
 * @param event the validated event to write
 * @param home the state home (defaults to the resolved home)
 * @returns the path written to, or the failure
 */
export function appendQuizEvent({ event, home }: { event: QuizEvent; home?: string }): Result<string, QuizError> {
  const paths = stateHomePaths(home === undefined ? {} : { home });
  const path = quizPath(home === undefined ? {} : { home });
  try {
    mkdirSync(paths.knowledge, { mode: DIR_MODE, recursive: true });
    appendLines({ mode: FILE_MODE, path, text: `${JSON.stringify(event)}\n` });
  } catch (cause) {
    return err(QuizErrors.unreadable({ cause: errorMessage({ error: cause }), path }));
  }
  return ok(path);
}
