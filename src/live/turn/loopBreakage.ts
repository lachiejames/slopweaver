/**
 * LOOP BREAKAGE, written by CODE — `$SLOPWEAVER_HOME/ledgers/loop-breakage.jsonl`, the ledger the loop
 * skills once had an agent append to by hand, and the ONE writer every row now goes through.
 *
 * ## Why a session dying needs a writer that is not that session
 *
 * `skills/loop/SKILL.md`'s instruction is "when something breaks, record one row and carry on", and for
 * everything a session survives that works. A session that DIES writes nothing: it is not there to notice,
 * and the session that spawned it only learns by polling and finding an empty workspace. Measured,
 * that is exactly what happened — twelve reviewer workspaces vanished mid-verdict over two hours and
 * the only durable trace anywhere on the machine was cmux's own closed-item history, which nothing in this
 * repository reads. An hour of diagnosis went into reconstructing what one line at the moment of discovery
 * would have said outright.
 *
 * So `turn review` writes that line itself, the moment a poll classifies its reviewer a phantom. Same file
 * and the hand-written rows' field names (`at`, `thread`, `what`, `error`, `cause`, `didInstead`), so the
 * ledger stays ONE ledger rather than becoming two that have to be read together — this is deliberately not
 * the sibling-file choice `admit/painPoint.ts` made, because that ledger counts a different thing and this
 * one records the same thing a human would have.
 *
 * ## Written once per death, not once per poll
 *
 * A worker polls its reviewer repeatedly, and every poll after the death sees the same phantom. A ledger
 * that grew a row per tick would bury the incident it exists to surface, so {@link recordLoopBreakage}
 * refuses a row whose exact `thread` and `what` are already in the file. `what` carries the workspace id,
 * which is what makes that check identify one death rather than one kind of death.
 *
 * Same pure-line / effectful-append split as `admit/painPoint.ts`: {@link loopBreakageLine} is pure and takes
 * its timestamp injected, never from a clock in here.
 *
 * ## `cause` is required, and a row without one is refused
 *
 * Every row now comes through this module — the code writers, and `slopweaver turn breakage` for the residue
 * only a session's judgement can name. The skills' `printf >>` is gone because a ledger whose only writer is
 * mid-turn undercounts (`admit/painPoint.ts`'s own diagnosis), and one measured day proved the second half:
 * six rows, all in the first hours of a day that ran nine hours longer, every one with `cause: null`. So {@link requireCause}
 * runs before every append and an unexplained row is a typed refusal rather than a silent null. Which writer
 * owns which class of breakage is declared in `./breakageClasses.ts`. The rows already in the file are the
 * evidence, nulls included, and nothing here rewrites them.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { appendLines } from "../../lib/appendSeparator.js";
import { logger } from "../../lib/logger.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { type LoopBreakageError, LoopBreakageErrors } from "./loopBreakageErrors.js";

/** The ledger's filename, shared with every row written before the skills stopped appending by hand. */
export const LOOP_BREAKAGE_FILE = "loop-breakage.jsonl";

/**
 * One breakage row. The field names are the hand-written ones exactly, because a row this module writes and
 * a row an agent wrote have to read as the same kind of thing to the same eye — `cause` included, which the
 * first hand-written row carried and almost none after it did.
 */
export interface LoopBreakage {
  /** When it was recorded. */
  readonly atIso: string;
  /** Which ask, as `<channel>/<messageTs>` — the loop's own way of naming a thread. */
  readonly thread: string;
  /** The step that broke, naming the concrete thing it broke on so one death is distinguishable from another. */
  readonly what: string;
  /** The failure verbatim, as the oracle reported it. */
  readonly error: string;
  /**
   * WHY it broke — the mechanism, not the symptom `error` already quotes. Required: {@link requireCause}
   * refuses a row whose cause is blank.
   */
  readonly cause: string;
  /** What was done instead — a row that does not say this leaves the next reader to guess. */
  readonly didInstead: string;
}

/** A row as a caller assembled it, before {@link requireCause} has said every field is there. */
export type LoopBreakageCandidate = { readonly [K in keyof LoopBreakage]?: LoopBreakage[K] | undefined };

/** Whether a candidate's field holds something other than whitespace. */
function filled(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

/**
 * Check a row before it may be written: every field non-blank, and `cause` above all. Pure.
 *
 * `cause` is checked first because it is the field the hand-written ledger left null on every row of
 * the measured day; a caller that fixes one refusal and meets the next should meet that one first. Absent and
 * whitespace-only read the same, and nothing supplied is trimmed or rewritten.
 *
 * @param breakage the row about to be appended
 * @returns the complete row, or the first refusal it earns
 */
export function requireCause({
  breakage,
}: {
  breakage: LoopBreakageCandidate;
}): Result<LoopBreakage, LoopBreakageError> {
  const { atIso, cause, didInstead, error, thread, what } = breakage;
  if (!filled(cause)) {
    return err(LoopBreakageErrors.causeMissing());
  }
  if (!filled(atIso)) {
    return err(LoopBreakageErrors.fieldMissing({ field: "atIso" }));
  }
  if (!filled(thread)) {
    return err(LoopBreakageErrors.fieldMissing({ field: "thread" }));
  }
  if (!filled(what)) {
    return err(LoopBreakageErrors.fieldMissing({ field: "what" }));
  }
  if (!filled(error)) {
    return err(LoopBreakageErrors.fieldMissing({ field: "error" }));
  }
  if (!filled(didInstead)) {
    return err(LoopBreakageErrors.fieldMissing({ field: "didInstead" }));
  }
  return ok({ atIso, cause, didInstead, error, thread, what });
}

/**
 * Build the one JSONL line for a breakage. Pure and deterministic.
 *
 * @param breakage the row to render
 * @returns the JSON line, with no trailing newline
 */
export function loopBreakageLine({ breakage }: { breakage: LoopBreakage }): string {
  return JSON.stringify({
    at: breakage.atIso,
    cause: breakage.cause,
    didInstead: breakage.didInstead,
    error: breakage.error,
    thread: breakage.thread,
    what: breakage.what,
  });
}

/**
 * Whether this exact breakage is already in the ledger text — the once-per-death guard. Pure.
 *
 * Matched on `thread` AND `what` together: `what` names the dead workspace, so two deaths on one ask are two
 * rows while one death polled ten times is one. A malformed line is skipped rather than fatal, the same
 * tolerance `parsePainPoints` applies and for the same reason.
 *
 * @param text the raw ledger contents
 * @param thread the ask being recorded
 * @param what the step that broke
 * @returns whether a row with that pair is already there
 */
export function loopBreakageAlreadyRecorded({
  text,
  thread,
  what,
}: {
  text: string;
  thread: string;
  what: string;
}): boolean {
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (isRecord(parsed) && parsed["thread"] === thread && parsed["what"] === what) {
      return true;
    }
  }
  return false;
}

/**
 * Append one breakage row, unless an identical one is already there or {@link requireCause} refuses it.
 *
 * A failure to write is reported and swallowed: the caller is in the middle of telling someone their reviewer
 * died, and failing that report over a ledger append would lose the more important half. A refused row is
 * reported the same way and journals nothing.
 *
 * @param breakage the row to append
 * @param home the state home (defaults to the resolved home)
 * @returns whether a row was written, and which of the three reasons it was not
 */
export function recordLoopBreakage({
  breakage,
  home,
}: {
  breakage: LoopBreakageCandidate;
  home?: string;
}): LoopBreakageWriteOutcome {
  const checked = requireCause({ breakage });
  if (checked.isErr()) {
    logger.error({ msg: `refused a loop-breakage row: ${checked.error.message}` });
    return { error: checked.error, kind: "refused", why: checked.error.message, written: false };
  }
  const row = checked.value;
  const ledgers = stateHomePaths(home !== undefined ? { home } : {}).ledgers;
  const path = join(ledgers, LOOP_BREAKAGE_FILE);
  try {
    mkdirSync(ledgers, { recursive: true });
    if (loopBreakageAlreadyRecorded({ text: readLedgerText({ path }), thread: row.thread, what: row.what })) {
      return {
        kind: "duplicate",
        why: "already recorded — one thread and step is one row, however many times it is reported",
        written: false,
      };
    }
    appendLines({ path, text: `${loopBreakageLine({ breakage: row })}\n` });
    return { written: true };
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    logger.error({ msg: `could not append a loop-breakage row to ${path}: ${why}` });
    return { kind: "write-failed", why, written: false };
  }
}

/**
 * What one append came to. `refused` writes nothing because {@link requireCause} said no; `duplicate` writes
 * nothing because the row is already there; `write-failed` is the filesystem saying no, reported and swallowed.
 */
export type LoopBreakageWriteOutcome =
  | { readonly written: true }
  | { readonly written: false; readonly kind: "duplicate"; readonly why: string }
  | { readonly written: false; readonly kind: "refused"; readonly error: LoopBreakageError; readonly why: string }
  | { readonly written: false; readonly kind: "write-failed"; readonly why: string };

/** The ledger's current text, or empty when it does not exist yet. */
function readLedgerText({ path }: { path: string }): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
