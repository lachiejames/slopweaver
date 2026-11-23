/**
 * THE OWNER'S SNOOZES, REMEMBERED — one file per open step the owner snoozed, outliving the marker that carried the press.
 *
 * A `snooze-<choice>` marker is consumed by the first reconcile that reads it (`./reconcile.ts`), the same way a
 * `later` is, and like a `later` it writes no register row: a snooze says nothing about whether the step happened.
 * What it does say is WHEN to come back, so the reconcile writes `{ id, choice, pressedIso, untilIso }` here
 * before it removes the marker. Every reader that decides whether to put the step in front of the owner asks this store:
 * `noteStanding` (`./note/raise.ts`), `hand push`, `hand list`, and `hand wake`, which raises the note once the
 * instant passes and forgets the record. A raise of the step's note forgets it too, and a reconcile drops every
 * record whose step is no longer open.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";

import { errorMessage } from "../lib/errorMessage.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../lib/safeJson.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";

import { type HandStepError, HandStepErrors } from "./errors.js";
import { departPushedSubject } from "./push/ledger.js";
import { handSubjectId } from "./push/select.js";
import { isSnoozeChoice, SNOOZE_MARKER_SUFFIXES, type SnoozeChoice } from "./snooze.js";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const SUFFIX = ".json";

/** One snooze the owner pressed, as the store keeps it. */
export interface SnoozeRecord {
  /** The step snoozed. */
  readonly id: string;
  /** Which answer the owner pressed. */
  readonly choice: SnoozeChoice;
  /** When the owner pressed it, ISO 8601. */
  readonly pressedIso: string;
  /** When the note comes back, ISO 8601. */
  readonly untilIso: string;
}

/** Every record the store reads whole, and the files that would not. */
export interface SnoozeRead {
  readonly records: readonly SnoozeRecord[];
  readonly problems: readonly HandStepError[];
  /** The step id of every `<id>.json` entry that would not read — a reader holds each one down, unknown. */
  readonly unreadable: readonly string[];
}

/**
 * Where the store lives: `$home/hand-steps/snoozes`, one `<id>.json` per snoozed open step.
 *
 * @param home the state home
 * @returns the store directory
 */
export function snoozeStoreDir({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).handSteps, "snoozes");
}

/**
 * Write one snooze, replacing any earlier one on the same step — the owner's latest answer is the one that stands — and
 * depart the step from the push ledger at the press, so its return is an arrival even when no push pass ran
 * while it slept (`./push/ledger.ts` § `departPushedSubject`). The departure goes FIRST: a record standing
 * with no departure behind it would wake into a ledger still saying "already told", so its return would never
 * arrive, while a departure with no record is only a step the next pass pushes again. Both halves are
 * idempotent, so a caller that fails part-way retries the whole call: the reconcile keeps the marker, and
 * `hand snooze` refuses before writing one.
 *
 * @param home the state home
 * @param record the snooze to keep
 * @returns nothing on success, or the failure to write either half
 */
export function recordSnooze({ home, record }: { home: string; record: SnoozeRecord }): Result<void, HandStepError> {
  const departed = departPushedSubject({ atIso: record.pressedIso, home, subjectId: handSubjectId({ id: record.id }) });
  if (departed.isErr()) {
    return err(departed.error);
  }
  const dir = snoozeStoreDir({ home });
  const path = join(dir, `${record.id}${SUFFIX}`);
  try {
    mkdirSync(dir, { mode: DIR_MODE, recursive: true });
    writeFileAtomic({
      contents: `${safeJsonStringify({ label: "hand snooze record", value: record })}\n`,
      dirMode: DIR_MODE,
      fileMode: FILE_MODE,
      path,
    });
    return ok(undefined);
  } catch (error: unknown) {
    return err(HandStepErrors.snoozeStore({ cause: errorMessage({ error }), path }));
  }
}

/**
 * Whether a snooze press is waiting on disk that no record holds yet — a `snooze-<choice>` marker a store
 * failure kept. The press stands from the moment the owner made it, so a reader that leaves a snoozed step out asks
 * this beside the store.
 *
 * @param home the state home
 * @param id the step's id
 * @returns true while such a marker stands
 */
export function snoozePending({ home, id }: { home: string; id: string }): boolean {
  const markerDir = stateHomePaths({ home }).handNoteDismiss;
  return SNOOZE_MARKER_SUFFIXES.some((suffix) => existsSync(join(markerDir, `${id}.${suffix}`)));
}

/**
 * Every snooze the store holds. An absent directory is none; a file that will not read is a problem named, and
 * never read as "not snoozed" silently — the caller reports it. What this does NOT close: a store directory that
 * will not even list (its permissions taken away) names no entries, so `unreadable` is empty and `hand push`
 * counts its steps — reported by the directory's path and `hand wake` exits 1, but no step is held out by name.
 * Failing push closed on that one problem would close it, and that was judged not worth one.
 *
 * @param home the state home
 * @returns the records that read, and each failure met
 */
export function readSnoozes({ home }: { home: string }): SnoozeRead {
  const dir = snoozeStoreDir({ home });
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return { problems: [], records: [], unreadable: [] };
    }
    return {
      problems: [HandStepErrors.snoozeStore({ cause: errorMessage({ error }), path: dir })],
      records: [],
      unreadable: [],
    };
  }
  const records: SnoozeRecord[] = [];
  const problems: HandStepError[] = [];
  const unreadable: string[] = [];
  for (const name of names.filter((entry) => entry.endsWith(SUFFIX)).toSorted()) {
    const path = join(dir, name);
    const read = readSnoozeFile({ path });
    if (read.isErr()) {
      problems.push(read.error);
      unreadable.push(name.slice(0, -SUFFIX.length));
      continue;
    }
    records.push(read.value);
  }
  return { problems, records, unreadable };
}

/**
 * One step's snooze, if the owner pressed one.
 *
 * @param home the state home
 * @param id the step's id
 * @returns the record, undefined when the step carries none, or why its file would not read
 */
export function snoozeOf({ home, id }: { home: string; id: string }): Result<SnoozeRecord | undefined, HandStepError> {
  const path = join(snoozeStoreDir({ home }), `${id}${SUFFIX}`);
  if (!existsSync(path)) {
    return ok(undefined);
  }
  return readSnoozeFile({ path });
}

/**
 * Whether the owner snoozed one step since its note was last raised — a press still on record, lapsed or not, as a
 * monitor settling the card asks it (`../monitor/passSettle.ts`). The record's contents are not read: that it
 * stands is the press.
 *
 * @param home the state home
 * @param id the step's id
 * @returns true while the record stands
 */
export function snoozeHeld({ home, id }: { home: string; id: string }): boolean {
  return existsSync(join(snoozeStoreDir({ home }), `${id}${SUFFIX}`));
}

/**
 * The records still holding a step off the owner's screen at one instant, by step id.
 *
 * @param records what the store read
 * @param nowIso the instant judged
 * @returns each active snooze, keyed by its step
 */
export function activeSnoozes({
  records,
  nowIso,
}: {
  records: readonly SnoozeRecord[];
  nowIso: string;
}): ReadonlyMap<string, SnoozeRecord> {
  const now = Date.parse(nowIso);
  return new Map(records.filter((record) => now < Date.parse(record.untilIso)).map((record) => [record.id, record]));
}

/**
 * Drop one step's snooze: its note was raised, or the step left the register.
 *
 * @param home the state home
 * @param id the step's id
 * @returns the failure to remove the record, if one
 */
export function forgetSnooze({ home, id }: { home: string; id: string }): readonly HandStepError[] {
  const path = join(snoozeStoreDir({ home }), `${id}${SUFFIX}`);
  try {
    rmSync(path, { force: true });
    return [];
  } catch (error: unknown) {
    return [HandStepErrors.snoozeStore({ cause: errorMessage({ error }), path })];
  }
}

/**
 * Drop every snooze whose step the register no longer carries open. Only called on a register that read whole,
 * so an id missing from `open` is truly settled rather than on a skipped line.
 *
 * @param home the state home
 * @param open every step id the register carries open
 * @returns each failure met reading or removing
 */
export function pruneSnoozes({ home, open }: { home: string; open: ReadonlySet<string> }): readonly HandStepError[] {
  const read = readSnoozes({ home });
  const forgotten = read.records
    .filter((record) => !open.has(record.id))
    .flatMap(({ id }) => forgetSnooze({ home, id }));
  return [...read.problems, ...forgotten];
}

/**
 * Read and check one record file. Every field must be present and well-formed; a torn or hand-edited file is
 * refused with the path, never guessed at.
 *
 * @param path the record file
 * @returns the record, or why it would not read
 */
function readSnoozeFile({ path }: { path: string }): Result<SnoozeRecord, HandStepError> {
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: "hand snooze record", text: readFileSync(path, "utf8") });
  } catch (error: unknown) {
    return err(HandStepErrors.snoozeStore({ cause: errorMessage({ error }), path }));
  }
  if (!isRecord(parsed)) {
    return err(HandStepErrors.snoozeStore({ cause: "the record is not an object", path }));
  }
  const { id, choice, pressedIso, untilIso } = parsed;
  if (typeof id !== "string" || id.length === 0) {
    return err(HandStepErrors.snoozeStore({ cause: "the record names no step id", path }));
  }
  // The file name is the key every reader looks a step up by, so a record naming another step is refused rather
  // than waking that one and leaving this one held down.
  if (basename(path) !== `${id}${SUFFIX}`) {
    return err(
      HandStepErrors.snoozeStore({ cause: `the record names step "${id}", not the one its file is for`, path }),
    );
  }
  if (typeof choice !== "string" || !isSnoozeChoice(choice)) {
    return err(HandStepErrors.snoozeStore({ cause: `"${String(choice)}" is not a snooze choice`, path }));
  }
  if (typeof pressedIso !== "string" || Number.isNaN(Date.parse(pressedIso))) {
    return err(HandStepErrors.snoozeStore({ cause: "the record's press instant is not a date", path }));
  }
  if (typeof untilIso !== "string" || Number.isNaN(Date.parse(untilIso))) {
    return err(HandStepErrors.snoozeStore({ cause: "the record's wake instant is not a date", path }));
  }
  return ok({ choice, id, pressedIso, untilIso });
}
