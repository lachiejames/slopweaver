/**
 * When each in-repo definition last ran — the one fact `./definitionDue.ts` needs and nothing else records.
 *
 * Due-ness used to be learned from a schedule outside this repository, so nothing in it had ever needed to
 * remember when a recurring job last fired. The definition store has no such external clock, which is the
 * whole reason a row there could not be scheduled: without a last-run stamp, "has a cadence fired since"
 * has no left-hand side. `automation run-due`, `automation due`, `automation claim` and `automation seat` all read this file.
 *
 * ## ONE writer, and the watermark means "finished with"
 *
 * This file is written from exactly one place:
 * `cli/commands/automation/slotRun.ts`'s settle, and only when `./slotAttempt.ts#slotIsRetired` says the firing
 * is finished with. No row runner stamps directly any more. That re-reads `watermarkIso` as what it always
 * meant — the last firing nothing is owed for — and makes it enforced by one writer rather than asserted by
 * a comment. A FAILED firing is deliberately not retired, which is how a retry happens at all.
 *
 * ## One small object, rewritten whole, and why that is safe here
 *
 * Bounded by the number of DEFINITIONS, which is bounded by the files a person put in one directory — not
 * by anything the data does. That is the distinction `whole-file-json` draws, and it is why this is a JSON
 * object rather than a `.jsonl` stream: a run history would grow with time and belong in a log, while "when
 * did each row last run" is one line per row forever. It still goes through `safeJsonParse` on the way in,
 * so a file that somehow grew past the ceiling refuses rather than being read.
 *
 * ## Rewriting it whole means the MERGE is this module's problem, not a caller's
 *
 * A whole-object rewrite is a read-modify-write, and a read-modify-write split across two callers loses
 * whichever writer read first. {@link recordRecipeDefinitionRun} therefore owns both halves: it re-reads the
 * file under a lock and merges the one row it was given, and it takes no map from its caller at all. A
 * caller's own read is for JUDGING due-ness ({@link readRecipeDefinitionRuns}) and is never an input to a
 * write. What that closed, and what a lost stamp actually costs, is on that function.
 */
import { sleepSync } from "#lib/sleepSync.js";

import { acquireOperationLock, type OperationLockResult } from "../../admit/operationLock.js";
import { readFileIfPresent } from "../../atlas/atlasFile.js";
import { errorMessage } from "../../lib/errorMessage.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse } from "../../lib/safeJson.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { type RecipeError, RecipeErrors, recipeErrorLines } from "./errors.js";

/** The schema version new code writes. A reader accepts only this one — nothing older has existed. */
export const RECIPE_DEFINITION_RUNS_SCHEMA_VERSION = 1;

/** What one row's last run left behind. */
export interface RecipeDefinitionRun {
  /** When the run finished — what a reader shows as "last ran". */
  readonly lastRunAtIso: string;
  /**
   * The last cadence SLOT a run covered — what `./definitionDue.ts` judges due-ness against.
   *
   * A different fact from {@link RecipeDefinitionRun.lastRunAtIso} and the reason both are stored: a run for
   * the 12:00 slot that finishes at 13:00:05 has covered 12:00, not 13:00, and judging against its finish
   * instant would silently drop the 13:00 slot.
   */
  readonly watermarkIso: string;
  /** The exit code the verb returned, so a row failing every tick is visible without reading a log. */
  readonly exitCode: number;
  /**
   * When a run of this row FIRST exited 0 — kept across every later run, whatever it exits with.
   *
   * The last run alone cannot answer "has this row ever delivered": a firing the door refused (exit 3) and a
   * firing retired dead after its attempts ran out (exit 1) are both stamped, and a later refusal overwrites an
   * earlier success. A scheduled card's day-one intro (`./firstFiring.ts`) needs exactly that answer. Absent on
   * a record written before the field existed; such a record with exit 0 is read as delivered.
   */
  readonly firstSucceededIso?: string | undefined;
  /**
   * Why the last stamped run did not succeed — its death reason and the failed step's own closing words — so the
   * cause outlives the slot-ledger row it was settled from. Present only on a run retired DEAD; a success
   * arriving later carries none, which clears it, because this field describes the run that finished last.
   */
  readonly failureCause?: string | undefined;
  /**
   * The slot of the dead firing whose cause {@link RecipeDefinitionRun.failureCause} is — the slot ledger holds one
   * row per slot, so this names exactly which row the cause was settled from, and whether the ledger still reads it.
   * Written and cleared with the cause.
   */
  readonly failureSlotIso?: string | undefined;
}

/** Every row's last run, keyed by recipe id. */
export type RecipeDefinitionRuns = Readonly<Record<string, RecipeDefinitionRun>>;

/**
 * One row's last run, or `null` when the row never ran — no stamp is recorded for it, which `judgeRecipeDue`
 * reads as due for the first time.
 *
 * @param runs every row's last run, as read from the runs file
 * @param recipeId the row to look up
 * @returns its last run, or `null` for a row that never ran
 */
export function lastRecipeRun({
  runs,
  recipeId,
}: {
  runs: RecipeDefinitionRuns;
  recipeId: string;
}): RecipeDefinitionRun | null {
  const run = runs[recipeId];
  if (run == null) {
    // Never ran: no stamp recorded for this row.
    return null;
  }
  return run;
}

/**
 * One run entry, or `undefined` when the stored value is not one.
 *
 * An entry with no `watermarkIso` takes its `lastRunAtIso` as the watermark. That is exactly what due-ness
 * was judged against before a slot was recorded, so reading such an entry changes no row's verdict.
 */
function runOf({ value }: { value: unknown }): RecipeDefinitionRun | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { lastRunAtIso, exitCode, watermarkIso, firstSucceededIso, failureCause, failureSlotIso } = value;
  if (typeof lastRunAtIso !== "string" || typeof exitCode !== "number") {
    return undefined;
  }
  const optional = {
    ...(typeof firstSucceededIso === "string" ? { firstSucceededIso } : {}),
    ...(typeof failureCause === "string" ? { failureCause } : {}),
    ...(typeof failureSlotIso === "string" ? { failureSlotIso } : {}),
  };
  if (watermarkIso === undefined) {
    return { exitCode, lastRunAtIso, watermarkIso: lastRunAtIso, ...optional };
  }
  if (typeof watermarkIso !== "string") {
    return undefined;
  }
  return { exitCode, lastRunAtIso, watermarkIso, ...optional };
}

/**
 * The run to store when one arrives for a row that already has one: the new run, with a watermark that never
 * moves BACKWARDS. PURE.
 *
 * A tick takes a firing before it runs it (`./slotLedger.ts`), so two ticks can no longer run one firing at
 * once — but two ticks running DIFFERENT firings of one row can still finish in either order. Without this, the tick covering the OLDER slot finishing second would pull the watermark back and
 * make an already-covered slot due again — a second card, for an alert row. The finish instant and exit code
 * are the newest arrival's, because those describe the run that just happened — unless that arrival FINISHED
 * before the stored run did, when the stored run is still the one that finished last and keeps them. A tie in the
 * same millisecond has no "after", and goes to the run recorded last. `firstSucceededIso` is the
 * stored one when there is one, and otherwise the arrival's own finish instant when it exited 0. `failureCause` and
 * `failureSlotIso` are the arrival's alone, so any later STAMPED run that is not itself a dead firing clears them.
 * A deferral stamps nothing, so it leaves the dead run's instant, exit and cause standing together, as they were.
 *
 * @param stored the row's run already on disk, or `undefined` when it has none
 * @param arriving the run being recorded
 * @returns the run to write
 */
export function mergeRecipeDefinitionRun({
  stored,
  arriving,
}: {
  stored: RecipeDefinitionRun | undefined;
  arriving: RecipeDefinitionRun;
}): RecipeDefinitionRun {
  const succeeded = firstSucceeded({ arriving, stored });
  // An arrival that FINISHED before the stored run (a dead letter stamps the instant it judged, and only after its
  // finding registers) is not the run that finished last, so it never replaces that run's instant, exit or cause.
  const finishedEarlier = stored !== undefined && Date.parse(arriving.lastRunAtIso) < Date.parse(stored.lastRunAtIso);
  const last = finishedEarlier ? stored : arriving;
  const withSuccess = succeeded === undefined ? last : { ...last, firstSucceededIso: succeeded };
  if (stored === undefined || Date.parse(stored.watermarkIso) <= Date.parse(arriving.watermarkIso)) {
    return { ...withSuccess, watermarkIso: arriving.watermarkIso };
  }
  return { ...withSuccess, watermarkIso: stored.watermarkIso };
}

/** The first instant a run of this row exited 0 (known exactly, or an older record's own success), carried forward. */
function firstSucceeded({
  stored,
  arriving,
}: {
  stored: RecipeDefinitionRun | undefined;
  arriving: RecipeDefinitionRun;
}): string | undefined {
  if (stored?.firstSucceededIso !== undefined) {
    return stored.firstSucceededIso;
  }
  // A record written before the field existed, whose own run exited 0, HAS succeeded — carry that forward, or a
  // later failure would erase the only evidence of it.
  if (stored?.exitCode === 0) {
    return stored.lastRunAtIso;
  }
  if (arriving.exitCode === 0) {
    return arriving.lastRunAtIso;
  }
  return undefined;
}

/**
 * Read every row's last run.
 *
 * An ABSENT file is an empty map, never a failure: an installation that has never run a definition is the
 * ordinary starting state, and every row in it is then due for the first time — which is exactly what
 * `judgeRecipeDue` does with a `null` stamp. A file that is present and unreadable IS a failure, because
 * reading a corrupt stamp as "never ran" would re-run every row on every tick.
 *
 * @param path the runs file, from `stateHome.ts`'s `live.recipe.definitionRunsJson`
 * @returns the map, or one line per reason a present file could not be read
 */
export function readRecipeDefinitionRuns({ path }: { path: string }): Result<RecipeDefinitionRuns> {
  // The recipe verbs read this store through a `readonly string[]` contract, so the typed refusal becomes its
  // printed lines at this edge — one per reason, exactly the lines each verb has always written.
  return readRunsFile({ path }).mapErr((error) => recipeErrorLines({ error }));
}

/** {@link readRecipeDefinitionRuns}, answering the typed refusal this store authors. */
function readRunsFile({ path }: { path: string }): Result<RecipeDefinitionRuns, RecipeError> {
  const raw = readFileIfPresent({ path });
  if (raw.isErr()) {
    return err(RecipeErrors.runsFileUnreadable({ path, reasons: raw.error }));
  }
  if (raw.value === null) {
    return ok({});
  }
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: path, text: raw.value });
  } catch (cause) {
    return err(RecipeErrors.runsFileNotJson({ cause, detail: errorMessage({ error: cause }), path }));
  }
  if (!isRecord(decoded) || decoded["schemaVersion"] !== RECIPE_DEFINITION_RUNS_SCHEMA_VERSION) {
    return err(RecipeErrors.runsFileWrongSchema({ expected: RECIPE_DEFINITION_RUNS_SCHEMA_VERSION, path }));
  }
  const runs = decoded["runs"];
  if (!isRecord(runs)) {
    return err(RecipeErrors.runsMapMissing({ path }));
  }
  const parsed: Record<string, RecipeDefinitionRun> = {};
  for (const [recipeId, value] of Object.entries(runs)) {
    const run = runOf({ value });
    if (run === undefined) {
      return err(RecipeErrors.runEntryUnreadable({ path, recipeId }));
    }
    parsed[recipeId] = run;
  }
  return ok(parsed);
}

/** The one lock key serialising every read-modify-write of the runs file, whatever verb is doing it. */
export const RECIPE_DEFINITION_RUNS_LOCK_KEY = "recipe-definition-runs";

/** How many times a busy lock is retried before the stamp is reported lost. See {@link recordRecipeDefinitionRun}. */
const MAX_LOCK_ATTEMPTS = 5;

/** The pause before retrying a busy lock, doubled each attempt. The critical section is one small read and
 * one atomic write, so a holder is gone in single-digit milliseconds and the first retry almost always wins. */
const FIRST_LOCK_RETRY_MS = 5;

/** Ceiling on that pause, so five attempts span ~155ms rather than growing without bound. */
const MAX_LOCK_RETRY_MS = 80;

/**
 * Take the runs lock, retrying a BUSY one a bounded number of times rather than giving up on the first
 * refusal.
 *
 * `acquireOperationLock` refuses immediately while another live holder has it — the right answer for a
 * multi-minute git rewrite, the wrong one here. A refused stamp is a LOST stamp, which puts the row straight
 * back to due and posts the card a second time: exactly the failure this module's locking exists to remove,
 * reintroduced through a different door. So this waits for the holder instead, which it can afford to do
 * because the section being waited on is bounded by one file write rather than by a network round trip.
 *
 * @param home the state home the lock lives under
 * @param nowIso the instant the attempt is judged at, for the lock's own staleness check
 * @returns the held lock, or the last refusal after every attempt
 */
function acquireRunsLock({ home, nowIso }: { home: string; nowIso: string }): OperationLockResult {
  let waitMs = FIRST_LOCK_RETRY_MS;
  let last = acquireOperationLock({ home, key: RECIPE_DEFINITION_RUNS_LOCK_KEY, nowIso });
  for (let attempt = 1; attempt < MAX_LOCK_ATTEMPTS && last.isErr(); attempt += 1) {
    sleepSync({ ms: waitMs });
    waitMs = Math.min(waitMs * 2, MAX_LOCK_RETRY_MS);
    last = acquireOperationLock({ home, key: RECIPE_DEFINITION_RUNS_LOCK_KEY, nowIso });
  }
  return last;
}

/**
 * Record that one row ran, leaving every other row's stamp alone.
 *
 * **The merge happens HERE, at write time, against what is on disk — never against a map the caller read
 * earlier.** MEASURED: writing the tick's start-of-run snapshot as `{...runs, [id]:
 * run}` over the whole file silently erased every stamp a concurrent tick had written in between.
 * knock-alerts, growth-ops and integrity-audit were all stamped within the same minute and read `due: false`;
 * hours later all three were gone from a 43-row file with `lastRunAtIso` null, while store-backup-daily's
 * stamp — written by the tick that happened to be last — survived. A dropped stamp is not a cosmetic loss:
 * it makes the row due again, and for an `alert-summary` row the next tick posts the card a SECOND time.
 *
 * Re-reading alone would only narrow the window, so the read and the write are one critical section under
 * {@link RECIPE_DEFINITION_RUNS_LOCK_KEY}. The lock is the innermost one this repository takes — nothing is
 * acquired while it is held — and no caller holds another one ACROSS it either, so it can never be half of
 * a cycle. `recipe-slot-attempts` (`./slotLedger.ts`) is the only other lock on this path, and
 * `cli/commands/automation/slotRun.ts` takes and releases it through the ledger's own verbs BEFORE reaching
 * here, never nested around this call.
 *
 * A file that is present and unreadable REFUSES rather than being overwritten with this one row: rewriting
 * it would turn one corrupt file into 42 rows that never ran, and re-run every one of them.
 *
 * @param path the runs file
 * @param home the state home whose lock serialises this write
 * @param nowIso the instant the lock attempt is judged at
 * @param recipeId the row that ran
 * @param run what the run left behind
 * @returns nothing on success, or one line per reason the stamp did not persist
 */
export function recordRecipeDefinitionRun({
  path,
  home,
  nowIso,
  recipeId,
  run,
}: {
  path: string;
  home: string;
  nowIso: string;
  recipeId: string;
  run: RecipeDefinitionRun;
}): Result<null> {
  return stampRun({ home, nowIso, path, recipeId, run }).mapErr((error) => recipeErrorLines({ error }));
}

/** {@link recordRecipeDefinitionRun}, answering the typed refusal this store authors. */
function stampRun({
  path,
  home,
  nowIso,
  recipeId,
  run,
}: {
  path: string;
  home: string;
  nowIso: string;
  recipeId: string;
  run: RecipeDefinitionRun;
}): Result<null, RecipeError> {
  const lock = acquireRunsLock({ home, nowIso });
  if (lock.isErr()) {
    // Deliberately the SAME variant the write failure below reports, rather than one of its own: a lock this
    // call could not take is a write it could not make. The lock's own reason carries the detail.
    return err(RecipeErrors.runsFileUnwritable({ detail: lock.error, path }));
  }
  try {
    const onDisk = readRunsFile({ path });
    if (onDisk.isErr()) {
      return err(onDisk.error);
    }
    const next = {
      runs: {
        ...onDisk.value,
        [recipeId]: mergeRecipeDefinitionRun({ arriving: run, stored: onDisk.value[recipeId] }),
      },
      schemaVersion: RECIPE_DEFINITION_RUNS_SCHEMA_VERSION,
    };
    writeFileAtomic({ contents: `${JSON.stringify(next, null, 2)}\n`, path });
  } catch (cause) {
    return err(RecipeErrors.runsFileUnwritable({ detail: errorMessage({ error: cause }), path }));
  } finally {
    lock.value.release();
  }
  return ok(null);
}
