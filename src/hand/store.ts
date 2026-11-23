/**
 * Reading and appending the hand-step register — the effectful half of {@link ./row.js}.
 *
 * One append-only `hand-steps/steps.jsonl` under the state home, one row per line, postings and settlings
 * interleaved in the order they happened. Streamed rather than read whole, because its size is a property of
 * the DATA and `whole-file-json` refuses that shape (`.claude/rules/typescript-patterns.md`).
 *
 * ## The read REFUSES rather than reporting empty
 *
 * Same call as `../autonomy/importRegister.ts`, and here it matters for the same reason: this register's readers are a
 * floating note and a push notification, and a machine that answered "nothing is waiting on you" because a
 * read failed would be silent exactly where AGENTS.md rule 6 says silence is the expensive failure. Only the
 * DEFAULT register being absent is empty; a named file that is not there is a caller naming the wrong path.
 *
 * ## A bad LINE is reported; only a bad FILE refuses
 *
 * Those two are different objects and the rule above is about the file. One unparseable line used to refuse
 * the whole read: `hand done` once wrote a `did` past the cap its reader enforced, and
 * from then on `slopweaver hand list` answered nothing but `line 6 of the hand-step register is not a
 * complete row` while two steps sat open and waiting on the owner. The verb reports the bad row rather than
 * refusing the whole list.
 *
 * So a line that will not parse is SKIPPED and CARRIED OUT of the read in {@link HandRegisterRead}'s
 * `unparsed`, and **every caller prints it**. That is the load-bearing half: a dropped POSTED line is a step
 * waiting on the owner that no surface mentions, which is the same silence the paragraph above refuses, arriving
 * by a quieter road. The read cannot enforce it — the callers can only be made to face it, which is why
 * `readOpenHandSteps` hands back a record instead of a list.
 *
 * ## The append takes the register's lock
 *
 * Read-check-append rather than one write: a duplicate id has to be judged against what the file already
 * holds, and several fleet sessions can hit a hand step at once.
 */
import { mkdirSync, statSync, truncateSync } from "node:fs";

import { acquireOperationLock } from "../admit/operationLock.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { slopweaverHome } from "../homeDir.js";
import { appendLines } from "../lib/appendSeparator.js";
import { errorMessage } from "../lib/errorMessage.js";
import { isAbsentError } from "../lib/presentFile.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonStringify } from "../lib/safeJson.js";
import { stateHomePaths } from "../stateHome.js";

import { type HandStepError, HandStepErrors } from "./errors.js";
import { lineSha256 } from "./lineRetirement.js";
import { type RetiredHandLine, readLineRetirements, splitRetiredLines } from "./lineRetirementSidecar.js";
import { type PlanEmail, readPlanEmails } from "./planSignIn.js";
import { postingOrRowRefusal } from "./postingChecks.js";
import { conflictingField, type HandRow, isSettledRow, openHandSteps, parseHandLine, rowsOfLine } from "./row.js";
import type { HandStep } from "./step.js";
import { findTailMend } from "./tornTail.js";

/** Owner-only permissions: a row quotes a credential prompt, an address and a literal the owner is about to paste. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** The lock key every writer of this register takes. One register, one key. */
const LOCK_KEY = "hand-step-register";

/** What an append did, and where. */
export interface HandAppendReceipt {
  readonly id: string;
  /** False when the register already held this exact row, which makes a retry idempotent. */
  readonly appended: boolean;
  readonly path: string;
  /**
   * One entry per line the duplicate check could not read.
   *
   * Carried on a WRITE receipt because a skipped posted line is a step this append could not see: a
   * settling whose own posting is on an unparseable line reads as `unknownStep`, and a caller told only
   * that would go looking for the wrong thing.
   */
  readonly unparsed: readonly HandStepError[];
  /** Bytes of a torn last line an interrupted write left, dropped before this append (`./tornTail.ts`); else `0`. */
  readonly droppedTornBytes: number;
}

/**
 * The register's absolute path.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the path to `hand-steps/steps.jsonl`
 */
export function handRegisterPath({ home }: { home?: string } = {}): string {
  return stateHomePaths(home === undefined ? {} : { home }).handStepsJsonl;
}

/**
 * Whether a register is there, genuinely absent, or present-but-unreachable.
 *
 * `existsSync` cannot answer this, and the difference is why the read refuses instead of reporting empty —
 * a directory this process cannot traverse would otherwise read exactly like a fresh install with nothing
 * waiting on the owner.
 *
 * @param path the register file
 * @returns `present`, `absent` when nothing is at that path, `unreachable` otherwise
 */
function registerPresence({ path }: { path: string }): "present" | "absent" | "unreachable" {
  try {
    statSync(path);
    return "present";
  } catch (error: unknown) {
    // A dangling link answers ENOENT too, and is something there that will not read.
    return isAbsentError({ error, path }) ? "absent" : "unreachable";
  }
}

/** One read of a register file: its rows, the lines that were not rows, and those of them retired. */
export interface HandRowsRead {
  readonly rows: readonly HandRow[];
  /** Every skipped line no retirement holds over. ALWAYS report these; never swallow them. */
  readonly unparsed: readonly HandStepError[];
  /** Skipped lines a retirement holds over — not a gap, because a later readable line settled each one's step. */
  readonly retired: readonly RetiredHandLine[];
}

/**
 * Every row one register file holds, in the order they were written, plus the lines that were not rows.
 *
 * A skipped line is still parsed strictly and still skipped. Only when a retirement in the sidecar still matches it
 * — its line number and the sha256 of its text, and the same of the later line that settled its step — is it carried
 * in `retired` instead of `unparsed`, so a caller stops reporting a gap that is proven closed. A retirement over
 * bytes that changed matches nothing and the line is `unparsed` again (`./lineRetirement.ts`).
 *
 * @param path the file to read
 * @param missing whether an absent file is empty or an error
 * @returns the rows, the unparseable lines and the retired ones, or the failure the FILE itself raised
 */
export function readHandRows({
  path,
  missing,
}: {
  path: string;
  missing: "empty" | "error";
}): Result<HandRowsRead, HandStepError> {
  const presence = registerPresence({ path });
  if (presence === "unreachable") {
    return err(
      HandStepErrors.storeUnreadable({ cause: "the register could not be reached — check its permissions", path }),
    );
  }
  if (presence === "absent") {
    if (missing === "empty") {
      return ok({ retired: [], rows: [], unparsed: [] });
    }
    return err(HandStepErrors.storeUnreadable({ cause: "the file does not exist", path }));
  }
  const retirements = readLineRetirements({ registerPath: path });
  const named = new Set(retirements.flatMap((retirement) => [retirement.lineNumber, retirement.settledByLine]));
  const shaOf = new Map<number, string>();
  const rows: HandRow[] = [];
  const skipped: HandStepError[] = [];
  try {
    readJsonlLines({
      onLine: ({ line, index, undecodable }) => {
        if (line.trim().length === 0) {
          return;
        }
        // Hashed only for a line a retirement names, so a home with no sidecar pays nothing — and never for one
        // that is not UTF-8: strict decoding is what makes this hash the raw bytes' own, so two different byte runs
        // can never share it, and an undecodable line stays unparsed whatever a sidecar claims.
        if (named.has(index + 1) && !undecodable) {
          shaOf.set(index + 1, lineSha256({ text: line }));
        }
        const parsed = rowsOfLine({ line, lineNumber: index + 1 });
        if (parsed.isErr()) {
          skipped.push(parsed.error);
          return;
        }
        for (const row of parsed.value) {
          rows.push(row);
        }
      },
      path,
      // A row quotes a prompt or a literal the owner pastes, so a repaired string would be words nobody wrote.
      strictUtf8: true,
    });
  } catch (cause) {
    return err(HandStepErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path }));
  }
  return ok({ rows, ...splitRetiredLines({ retirements, shaOf, skipped }) });
}

/**
 * What one read of the register found.
 *
 * A record rather than a bare list so that `unparsed` is impossible to ignore at a call site: every caller
 * has to name the field it wants, and the one it did not name is the one that would have gone silent. See
 * this module's overview for the incident that makes that the point rather than a nicety.
 */
export interface HandRegisterRead {
  /** Every step still waiting on the owner, oldest first. */
  readonly steps: readonly HandStep[];
  /** Every id a posting row carries, open or settled, off the SAME read — what a monitor pass hands its append guard. */
  readonly postedIds: readonly string[];
  /** One entry per line the reader could not make a row of. ALWAYS report these; never swallow them. */
  readonly unparsed: readonly HandStepError[];
}

/**
 * Every step still waiting on the owner, oldest first, and every line that could not be read as a row.
 *
 * An install with nothing outstanding is empty. A register the reader cannot reach at all still REFUSES —
 * that is the file, not a line.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the open steps and the unparseable lines, or the failure
 */
export function readOpenHandSteps({ home }: { home?: string } = {}): Result<HandRegisterRead, HandStepError> {
  const read = readHandRows({ missing: "empty", path: handRegisterPath(home === undefined ? {} : { home }) });
  if (read.isErr()) {
    return err(read.error);
  }
  const { rows, unparsed } = read.value;
  return ok({ postedIds: postedIdsOf({ rows }), steps: openHandSteps({ rows }), unparsed });
}

/** Every id a posting row carries, open or settled, in register order. */
function postedIdsOf({ rows }: { rows: readonly HandRow[] }): readonly string[] {
  return rows.flatMap((row) => (isSettledRow(row) ? [] : [row.step.id]));
}

/**
 * The exact bytes one row becomes, serialised from an object that inherits nothing.
 *
 * Detaching the prototype first is a measured finding the autonomy register's file writer made, kept here for the
 * same reason: `JSON.stringify` reaches a `toJSON` through the prototype chain, so a plain copy can still be rewritten on
 * its way to the file by something installed elsewhere in the process.
 *
 * @param row the row to serialise
 * @returns the one JSON line to append
 */
export function serialised({ row }: { row: HandRow }): string {
  const detached = { ...row };
  Object.setPrototypeOf(detached, null);
  return safeJsonStringify({ label: "a hand-step register row", value: detached });
}

/**
 * Whether the register already holds this exact row, which makes appending it an idempotent no-op.
 *
 * EVERY posting under the id is compared, not the first: a stale-lock takeover can leave two, and the last is the
 * one `openHandSteps` holds open, so matching an earlier one alone is not holding the offered step.
 *
 * @param rows what the register held when the lock was taken
 * @param row the row about to be written
 * @returns true when it is already there, or the conflict two disagreeing postings make
 */
export function alreadyHeld({ rows, row }: { rows: readonly HandRow[]; row: HandRow }): Result<boolean, HandStepError> {
  if (isSettledRow(row)) {
    return ok(rows.some((held) => isSettledRow(held) && held.id === row.id));
  }
  let held = false;
  for (const prior of rows) {
    if (isSettledRow(prior) || prior.step.id !== row.step.id) {
      continue;
    }
    const field = conflictingField({ first: prior.step, second: row.step });
    if (field !== undefined) {
      return err(HandStepErrors.stepIdConflict({ field, id: row.step.id }));
    }
    held = true;
  }
  return ok(held);
}

/**
 * Whether a board row may be named by a NEW card, asked under the register lock: `undefined` when it may, else why
 * not. `hand post` supplies one that reads the home board; a writer supplying none admits every row.
 */
export type RowAdmission = (query: { row: string }) => string | undefined;

/**
 * The admission a write that opens a new row-backed card meets — and only such a write: an exact retry, or the
 * settling a cut-short re-cut still owes, opens no new card, so a row gone missing or finished since the first
 * attempt must not refuse the retry that cleans up after it.
 *
 * @param admitRow the admission the caller supplied, when it supplied one
 * @param step the posting about to open a card
 * @returns nothing when the card may open, or the refusal naming its row
 */
export function rowAdmissionRefusal({
  admitRow,
  step,
}: {
  admitRow: RowAdmission | undefined;
  step: HandStep;
}): Result<void, HandStepError> {
  if (admitRow === undefined || step.row === undefined) {
    return ok(undefined);
  }
  const why = admitRow({ row: step.row });
  return why === undefined ? ok(undefined) : err(HandStepErrors.rowNotNameable({ row: step.row, why }));
}

/**
 * Whether a posting may go up beside every posting the register holds NOW, open or settled, asked under the register
 * lock: `undefined` when it may, else why not. A monitor pass supplies one so a card a racing pass recorded after its
 * own read is never doubled, even once that card is settled (`../monitor/passPost.ts`); a writer supplying none admits
 * every posting.
 */
export type PostingAdmission = (query: { posted: readonly string[] }) => string | undefined;

/** The id a row is written under, whichever kind it is. */
function rowId({ row }: { row: HandRow }): string {
  return isSettledRow(row) ? row.id : row.step.id;
}

/**
 * Append one row — a posting or a settling — under the register's lock, creating it if it is not there yet.
 *
 * @param row the row to write
 * @param nowIso the instant the lock is taken at, so its own staleness check has a clock
 * @param home the state home (defaults to the resolved home)
 * @param admitRow what a posting opening a new row-backed card must pass, judged under the lock
 * @param admitPosting what a new posting must pass against every posting at the append, judged under the lock
 * @returns what was written and where, or the failure
 */
export async function appendHandRow({
  row,
  nowIso,
  home = slopweaverHome(),
  admitRow,
  admitPosting,
}: {
  row: HandRow;
  nowIso: string;
  home?: string;
  admitRow?: RowAdmission | undefined;
  admitPosting?: PostingAdmission | undefined;
}): Promise<Result<HandAppendReceipt, HandStepError>> {
  let plans: readonly PlanEmail[] = [];
  if (!isSettledRow(row)) {
    plans = await readPlanEmails({ home });
  }
  return underLock({ home, nowIso, section: (path) => writeUnderLock({ admitPosting, admitRow, path, plans, row }) });
}

/**
 * Take the register's lock, run one critical section against the register's path, and release it.
 *
 * Every writer goes through here, so "one lock-held read-check-append" is one function rather than a pattern
 * three writers each re-typed.
 *
 * @param home the state home
 * @param nowIso the instant the lock is taken at
 * @param section the read-check-append, handed the register's path
 * @returns what the section returned, or why the lock or the directory could not be had
 */
export function underLock<T>({
  home,
  nowIso,
  section,
}: {
  home: string;
  nowIso: string;
  section: (path: string) => Result<T, HandStepError>;
}): Result<T, HandStepError> {
  const paths = stateHomePaths({ home });
  const path = paths.handStepsJsonl;
  try {
    mkdirSync(paths.handSteps, { mode: DIR_MODE, recursive: true });
  } catch (cause) {
    return err(HandStepErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path }));
  }
  // Never stale while its holder LIVES: an aged-out live writer would append from the state it read before a
  // takeover, and two cards for one row stand. A dead holder is still recovered at once, by its pid.
  const lock = acquireOperationLock({ home, key: LOCK_KEY, nowIso, staleAfterMs: Number.POSITIVE_INFINITY });
  if (lock.isErr()) {
    return err(HandStepErrors.registerBusy({ why: lock.error }));
  }
  try {
    return section(path);
  } finally {
    lock.value.release();
  }
}

/**
 * The critical section: read what is there, refuse a conflict, skip a duplicate, append otherwise.
 *
 * A settling of an id nothing open carries is refused HERE rather than at the CLI edge, so a caller that is
 * not the CLI cannot tick a step that was never posted.
 *
 * @param admitRow what a posting opening a new row-backed card must pass
 * @param admitPosting what a new posting must pass against every posting now
 * @param path the register file
 * @param plans every registered plan's alias and cached address, read before the lock
 * @param row the row to write
 * @returns what was written, or the failure
 */
function writeUnderLock({
  admitPosting,
  admitRow,
  path,
  plans,
  row: offered,
}: {
  admitPosting: PostingAdmission | undefined;
  admitRow: RowAdmission | undefined;
  path: string;
  plans: readonly PlanEmail[];
  row: HandRow;
}): Result<HandAppendReceipt, HandStepError> {
  // Serialised ONCE, and every check below runs on that line as the register will read it back — never on the
  // object offered. A nested `toJSON` can make the two differ, and a check of the object would then pass a
  // line the register records unchecked. The same bytes are the ones appended.
  const line = serialised({ row: offered });
  const readBack = readBackOf({ line });
  if (readBack.isErr()) {
    return err(readBack.error);
  }
  const row = readBack.value;
  const held = readHandRows({ missing: "empty", path });
  if (held.isErr()) {
    return err(held.error);
  }
  const unread = unreadBesideTornTail({ path, unparsed: held.value.unparsed });
  if (unread.isErr()) {
    return err(unread.error);
  }
  const { rows } = held.value;
  const unparsed = unread.value;
  const id = rowId({ row });
  const receipt = { id, path, unparsed };
  if (isSettledRow(row) && !openHandSteps({ rows }).some((step) => step.id === id)) {
    return err(HandStepErrors.unknownStep({ id }));
  }
  const duplicate = alreadyHeld({ row, rows });
  if (duplicate.isErr()) {
    return err(duplicate.error);
  }
  if (duplicate.value) {
    return ok({ ...receipt, appended: false, droppedTornBytes: 0 });
  }
  // The posting form, here and not only at the two known writers: a caller of this function that is not
  // `hand post` is exactly how context-free cards reached the owner's queue (`./posting.ts`). After the duplicate
  // check, so re-posting a row already on disk stays the no-op it was.
  if (!isSettledRow(row)) {
    const refused = postingOrRowRefusal({ plans, replacing: undefined, rows, step: row.step, unparsed })
      .andThen(() => rowAdmissionRefusal({ admitRow, step: row.step }))
      .andThen(() => postingAdmissionRefusal({ admitPosting, id, rows }));
    if (refused.isErr()) {
      return err(refused.error);
    }
  }
  const written = appendText({ path, text: `${line}\n` });
  return written.map((droppedTornBytes) => ({ ...receipt, appended: true, droppedTornBytes }));
}

/** The writer's {@link PostingAdmission}, asked against every posting in what the lock-held read found. */
function postingAdmissionRefusal({
  admitPosting,
  id,
  rows,
}: {
  admitPosting: PostingAdmission | undefined;
  id: string;
  rows: readonly HandRow[];
}): Result<void, HandStepError> {
  const why = admitPosting?.({ posted: postedIdsOf({ rows }) });
  return why === undefined ? ok(undefined) : err(HandStepErrors.postingNotAdmitted({ id, why }));
}

/**
 * Append bytes to the register with its owner-only mode, naming the path on a failure — after mending a cut-short end.
 *
 * The one append every writer goes through, so none can glue a row onto what an interrupted write left: a torn last
 * line is dropped, and a whole one missing its newline gets it (`./tornTail.ts`).
 *
 * @param path the register file
 * @param text the whole lines to append, each ending in a newline
 * @returns the bytes of a torn last line dropped first (`0` when none), or why the append failed
 */
export function appendText({ path, text }: { path: string; text: string }): Result<number, HandStepError> {
  const mend = findTailMend({ path });
  if (mend.isErr()) {
    return err(mend.error);
  }
  try {
    if (mend.value?.kind === "torn") {
      truncateSync(path, mend.value.keepBytes);
    }
    // A whole row missing only its newline is left for `appendLines`, which separates the next row from it.
    appendLines({ durable: true, mode: FILE_MODE, path, text });
  } catch (cause) {
    return err(HandStepErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path }));
  }
  return ok(mend.value?.kind === "torn" ? mend.value.droppedBytes : 0);
}

/**
 * The lines a read skipped, less a torn last line: an interrupted write's fragment, which the next append drops.
 *
 * A torn last line never parses, so when `./tornTail.ts` proves the tail torn, the LAST skipped line is it. Every
 * other skipped line stays, and still refuses whatever it refused — it may be the very step a check needs.
 *
 * @param path the register file
 * @param unparsed what the read skipped, in line order
 * @returns the skipped lines that are not the torn tail, or why the tail could not be read
 */
export function unreadBesideTornTail({
  path,
  unparsed,
}: {
  path: string;
  unparsed: readonly HandStepError[];
}): Result<readonly HandStepError[], HandStepError> {
  if (unparsed.length === 0) {
    return ok(unparsed);
  }
  return findTailMend({ path }).map((mend) => (mend?.kind === "torn" ? unparsed.slice(0, -1) : unparsed));
}

/**
 * The exact bytes about to be appended, read back as this register's own reader reads them — or its refusal.
 *
 * The last gate, and it is the READER rather than a second copy of its rules: a writer and a reader that
 * merely agree today are a pair that can drift, and once they had — `hand done` wrote a `did`
 * past a cap `../hand/row.ts` enforced on read, into an append-only file, and every read after it refused.
 * Round-tripping the serialised line through `parseHandLine` makes the two literally the same rule, so no
 * caller of this function — CLI or not — can write a line the register cannot read back.
 *
 * @param line the serialised row about to be appended
 * @returns the row the register will read, or the reader's own refusal
 */
export function readBackOf({ line }: { line: string }): Result<HandRow, HandStepError> {
  return parseHandLine({ line, lineNumber: 0 }).mapErr((error) => HandStepErrors.unwritableRow({ why: error.message }));
}
