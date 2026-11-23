/**
 * The proposal queue on disk: `$SLOPWEAVER_HOME/knowledge/proposals.jsonl`, append-only, one row per line.
 *
 * ## Why it sits BESIDE the register rather than inside it, and beside it rather than elsewhere
 *
 * Their corrections live in the knowledge register itself, and this file does not touch that. What lands here is the QUEUE: a candidate claim read out of their
 * own words, waiting for them. It cannot be a `LessonRow` because a lesson owes `evidence` that was
 * OBSERVED, a `tier` and a `verdict`, and none of the three can be honestly manufactured from a sentence they
 * said. It sits in `knowledge/` rather than in a directory of its own so that the relationship is legible
 * from the filesystem: one register, and the queue that feeds its owner side.
 *
 * ## The read REFUSES rather than reporting empty
 *
 * The same call `../store.ts` makes, for the same reason: the queue decides what a session is handed next,
 * so an unreadable queue must not be indistinguishable from one nobody has written to. The second would
 * re-hand a session work it has already done, forever.
 *
 * ## Streamed, not read whole
 *
 * One row per unit of their speech reviewed, forever. `readJsonlLines` from the first commit rather than
 * after it gets big, per `.claude/rules/typescript-patterns.md`'s `whole-file-json` rule.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { readJsonlLines } from "../../corpus/corpusStore.js";
import { appendLines } from "../../lib/appendSeparator.js";
import { errorMessage } from "../../lib/errorMessage.js";
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { type BeliefError, BeliefErrors } from "./errors.js";
import type { BeliefProposal } from "./types.js";
import { parseProposalLine } from "./unit.js";

/** Owner-only permissions, matching `../store.ts` — the queue quotes their own words. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * The queue's absolute path.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the path to `knowledge/proposals.jsonl`
 */
export function proposalsPath({ home }: { home?: string } = {}): string {
  return join(stateHomePaths(home === undefined ? {} : { home }).knowledge, "proposals.jsonl");
}

/**
 * Every proposal the queue holds, in the order they were written.
 *
 * A queue that does not exist yet is EMPTY and is not an error — the ordinary state before the first review.
 * One that exists and holds a line this code cannot decode is an error and says which line.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns every row, or the first failure
 */
export function readProposals({ home }: { home?: string } = {}): Result<readonly BeliefProposal[], BeliefError> {
  const path = proposalsPath(home === undefined ? {} : { home });
  if (!existsSync(path)) {
    return ok([]);
  }
  const rows: BeliefProposal[] = [];
  let failure: BeliefError | undefined;
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (failure !== undefined || line.trim().length === 0) {
          return;
        }
        const parsed = parseProposalLine({ line });
        if (parsed === undefined) {
          failure = BeliefErrors.corrupt({ lineNumber: index + 1 });
          return;
        }
        rows.push(parsed);
      },
      path,
    });
  } catch (cause) {
    return err(BeliefErrors.queueUnreadable({ cause, path }));
  }
  if (failure !== undefined) {
    return err(failure);
  }
  return ok(rows);
}

/**
 * Append one proposal, creating the queue if it is not there yet.
 *
 * @param row the validated row to write
 * @param home the state home (defaults to the resolved home)
 * @returns the path written to, or the failure
 */
export function appendProposal({ row, home }: { row: BeliefProposal; home?: string }): Result<string, BeliefError> {
  const paths = stateHomePaths(home === undefined ? {} : { home });
  const path = proposalsPath(home === undefined ? {} : { home });
  try {
    mkdirSync(paths.knowledge, { mode: DIR_MODE, recursive: true });
    appendLines({ mode: FILE_MODE, path, text: `${JSON.stringify(row)}\n` });
  } catch (cause) {
    return err(BeliefErrors.queueUnreadable({ cause: errorMessage({ error: cause }), path }));
  }
  return ok(path);
}
