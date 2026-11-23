/**
 * The effectful half of a FAILURE HOLD: reading a hold's finding off the board, and writing a hold onto a
 * definition file when a firing fails. The rules are `./failureHold.ts`.
 *
 * ## Only the `hold` key is ever written
 *
 * A definition file is shared by every checkout on the machine and by the resync registrar, so this reads the
 * file as raw JSON and sets ONE key. Re-serialising a parsed {@link RecipeDefinition} would drop any field
 * this build does not know, and would write back the defaults the parse filled in (`onMissed`, `params`).
 *
 * ## One lock for every writer of a hold
 *
 * {@link RECIPE_DEFINITION_HOLDS_LOCK_KEY} serialises this write against the registrar's
 * (`../resync/registrationStore.ts`), which re-reads the hold under the same lock before it writes: before,
 * the registrar planned from an earlier read and wrote the planned row whole, so a hold placed in between was
 * lost.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { readDerivedRowState } from "../../handover/rowState.js";
import { isSafeSlug } from "../../handover/runStore.js";
import { errorMessage } from "../../lib/errorMessage.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse } from "../../lib/safeJson.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import { withOperatorFields } from "../resync/managedRowFields.js";
import { parseRecipeDefinition, type RecipeDefinition, type RecipeHold } from "./definition.js";
import { type RecipeDefinitionNotWrittenError, RecipeErrors, type RecipeHoldNotPlacedError } from "./errors.js";
import { type FailureFindingState, failureFindingState, holdStands } from "./failureHold.js";
import { readAutomationRetirements, retiredRecipeIds } from "./retirementStore.js";
import { acquireWaitingLock } from "./waitingLock.js";

/** The one lock key serialising every write of a definition's `hold`, whichever row it is about. */
export const RECIPE_DEFINITION_HOLDS_LOCK_KEY = "recipe-definition-holds";

/** Where the board lives — what the lifted view reads a failure hold's finding from. */
export interface RecipeBoard {
  readonly handoverDir: string;
  readonly runsDir: string;
}

/**
 * The board under one state home.
 *
 * @param home the state home
 * @returns its handovers and run-journal directories
 */
export function recipeBoardOf({ home }: { readonly home: string }): RecipeBoard {
  const paths = stateHomePaths({ home });
  return { handoverDir: paths.handovers, runsDir: paths.runs };
}

/**
 * What the board says about one failure hold's finding now.
 *
 * @param board where the rows live
 * @param finding the slug the hold names
 * @returns whether the hold stands, and why
 */
function readFailureFindingState({
  board,
  finding,
}: {
  readonly board: RecipeBoard;
  readonly finding: string;
}): FailureFindingState {
  const row = readDerivedRowState({ ...board, slug: finding });
  const filedAs = row.isOk() && row.value.settlement === "filed" ? row.value.settlementWitness : undefined;
  const witness =
    filedAs !== undefined && isSafeSlug({ slug: filedAs }) ? readDerivedRowState({ ...board, slug: filedAs }) : null;
  return failureFindingState({ finding, row, witness });
}

/**
 * One definition as the LIFTED view sees it: a failure hold carries what its finding says now.
 *
 * @param definition the row as its file parsed
 * @param board where the rows live
 * @returns the same row, its failure hold carrying a `findingState`; any other row unchanged
 */
export function withFindingState({
  definition,
  board,
}: {
  readonly definition: RecipeDefinition;
  readonly board: RecipeBoard;
}): RecipeDefinition {
  const { hold } = definition;
  if (hold?.finding === undefined || hold.clearedBy !== null) {
    return definition;
  }
  return { ...definition, hold: { ...hold, findingState: readFailureFindingState({ board, finding: hold.finding }) } };
}

/**
 * Whether one row is held RIGHT NOW, read off its file and the board at the moment of a take.
 *
 * The roster a dispatcher judged was read before its run began, and a sibling dispatcher's failure may have
 * held the row since — so a take asks again rather than trusting that read. A file that is gone or does not
 * parse answers `null`: the take's own roster already parsed it, and refusing here on a read this module
 * cannot interpret would turn a transient read into a skipped firing.
 *
 * A row RETIRED on this install is held too, and so is every row while the retirement registry will not read: a
 * dispatcher that loaded its roster before `automation retire` ran must not begin a firing after it.
 *
 * @param home the state home the definition, the board and the retirement registry live under
 * @param recipeId the row about to be taken
 * @returns why the row is held, or `null` when nothing holds it
 */
export function rowHeldNow({ home, recipeId }: { readonly home: string; readonly recipeId: string }): string | null {
  const retirements = readAutomationRetirements({ home });
  if (retirements.isErr()) {
    return `not taken — ${retirements.error.message}`;
  }
  if (retiredRecipeIds({ retirements: retirements.value.retirements }).has(recipeId)) {
    return `${recipeId} is retired on this install (\`slopweaver automation retire ${recipeId} --undo\` restores it)`;
  }
  const raw = readRawDefinition({
    path: join(stateHomePaths({ home }).live.recipe.definitionsDir, `${recipeId}.json`),
  });
  if (raw.isErr()) {
    return null;
  }
  const parsed = parseRecipeDefinition({ value: raw.value });
  if (parsed.isErr() || parsed.value.recipeId !== recipeId) {
    return null;
  }
  const { hold } = withFindingState({ board: recipeBoardOf({ home }), definition: parsed.value });
  if (hold === undefined || !holdStands({ hold })) {
    return null;
  }
  if (hold.findingState === undefined) {
    return hold.reason;
  }
  return hold.findingState.line;
}

/**
 * Ask {@link rowHeldNow} and, only when the row is neither held nor retired, run `start` — both under the
 * definition hold lock, so the firing `start` begins cannot interleave with a hold or a retirement another PROCESS
 * writes. `automation retire` and every hold writer take this same lock: one of theirs lands wholly before the
 * ask (and refuses the start) or wholly after the firing has begun (a firing already running, which neither
 * cancels). Asking with no await between check and start binds only this event loop, never another process.
 *
 * Lock order is this lock, then the slot ledger's own inside `start`; nothing takes them the other way round.
 *
 * @param home the state home both the registry and the lock live under
 * @param recipeId the row about to start a firing
 * @param nowIso the instant the lock's staleness is judged at
 * @param start the ledger write that begins the firing, made with the lock held
 * @returns what `start` answered, `held` with the line naming the hold or retirement, or `busy` with why the lock
 *   could not be taken
 */
export function startUnlessHeld<T>({
  home,
  recipeId,
  nowIso,
  start,
}: {
  readonly home: string;
  readonly recipeId: string;
  readonly nowIso: string;
  readonly start: () => T;
}):
  | { readonly kind: "busy"; readonly why: string }
  | { readonly kind: "held"; readonly why: string }
  | { readonly kind: "started"; readonly value: T } {
  const lock = acquireWaitingLock({ home, key: RECIPE_DEFINITION_HOLDS_LOCK_KEY, nowIso });
  if (lock.isErr()) {
    return { kind: "busy", why: `the definition hold lock is busy (${lock.error})` };
  }
  try {
    const heldBecause = rowHeldNow({ home, recipeId });
    if (heldBecause !== null) {
      return { kind: "held", why: heldBecause };
    }
    return { kind: "started", value: start() };
  } finally {
    lock.value.release();
  }
}

/**
 * When the row's LIFTED failure hold was placed, read off its file and the board at the moment of a take — the
 * instant before which every attempt belongs to a failure its fix already answered (`./strandedAttempt.ts`).
 *
 * A failure hold lifted on its finding's fix and one released by the owner's `clearedBy` both answer: either way the row
 * was let run again, and an older death re-holding it would undo that. An owner hold carries no finding and a
 * standing hold lifts nothing, so neither answers one; neither does a file that is gone, does not parse or names
 * another row, which leaves every earlier death judged as before.
 *
 * @param home the state home the definition and the board live under
 * @param recipeId the row about to be taken
 * @returns the lifted failure hold's `askedIso`, or `null` when the row carries none
 */
export function liftedFailureHoldAskedIso({
  home,
  recipeId,
}: {
  readonly home: string;
  readonly recipeId: string;
}): string | null {
  const raw = readRawDefinition({
    path: join(stateHomePaths({ home }).live.recipe.definitionsDir, `${recipeId}.json`),
  });
  if (raw.isErr()) {
    return null;
  }
  const parsed = parseRecipeDefinition({ value: raw.value });
  if (parsed.isErr() || parsed.value.recipeId !== recipeId) {
    return null;
  }
  const { hold } = withFindingState({ board: recipeBoardOf({ home }), definition: parsed.value });
  if (hold?.finding === undefined || holdStands({ hold })) {
    return null;
  }
  return hold.askedIso;
}

/** What placing a failure hold did. */
export type PlaceFailureHoldOutcome =
  | {
      /** The row is now held on the new finding — the one case that files it. */
      readonly kind: "placed";
    }
  | {
      /** A failure hold already stands; its finding is the one this failure belongs to. */
      readonly kind: "already";
      readonly finding: string;
    }
  | {
      /** The owner's own hold already stands; it outranks a failure hold, and nothing files. */
      readonly kind: "owner-held";
    };

/**
 * The raw JSON object in one definition file, or why it is not one — as the hold write reports it, the one
 * caller that surfaces the reason.
 */
function readRawDefinition({ path }: { path: string }): Result<Record<string, unknown>, RecipeHoldNotPlacedError> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    return err(
      RecipeErrors.holdNotPlaced({ detail: `the file did not read: ${errorMessage({ error: cause })}`, path }),
    );
  }
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: path, text });
  } catch (cause) {
    return err(RecipeErrors.holdNotPlaced({ detail: `the file is not JSON: ${errorMessage({ error: cause })}`, path }));
  }
  if (!isRecord(decoded)) {
    return err(RecipeErrors.holdNotPlaced({ detail: "the file is not a JSON object", path }));
  }
  return ok(decoded);
}

/** Decide, under the lock, what the hold write does. */
function placeLocked({
  path,
  recipeId,
  hold,
  board,
}: {
  path: string;
  recipeId: string;
  hold: RecipeHold;
  board: RecipeBoard;
}): Result<PlaceFailureHoldOutcome, RecipeHoldNotPlacedError> {
  const raw = readRawDefinition({ path });
  if (raw.isErr()) {
    return err(raw.error);
  }
  const parsed = parseRecipeDefinition({ value: raw.value });
  if (parsed.isErr()) {
    return err(RecipeErrors.holdNotPlaced({ detail: `it does not parse: ${parsed.error.message}`, path }));
  }
  if (parsed.value.recipeId !== recipeId) {
    const detail = `the file carries recipe '${parsed.value.recipeId}', not '${recipeId}'`;
    return err(RecipeErrors.holdNotPlaced({ detail, path }));
  }
  const standing = withFindingState({ board, definition: parsed.value }).hold;
  if (standing !== undefined && holdStands({ hold: standing })) {
    return ok(standing.finding === undefined ? { kind: "owner-held" } : { finding: standing.finding, kind: "already" });
  }
  try {
    writeFileAtomic({ contents: `${JSON.stringify({ ...raw.value, hold })}\n`, path });
  } catch (cause) {
    return err(RecipeErrors.holdNotPlaced({ detail: `the write failed: ${errorMessage({ error: cause })}`, path }));
  }
  return ok({ kind: "placed" });
}

/**
 * Write a whole definition a verb derives, carrying forward the `enabled`, `hold`, `channelApprovals` and `names` the
 * file on disk holds — none is ever the deriving verb's. Read and written under the hold lock, so a hold placed or an
 * `automation disable` landed a moment ago survives a re-register.
 *
 * @param home the state home whose hold lock is taken
 * @param path the definition file
 * @param definition the row the verb derives
 * @param nowIso the instant, for the lock's own staleness check
 * @returns the row as written and whether a file stood there before, or why nothing was written
 */
export function writeDefinitionKeepingHold({
  home,
  path,
  definition,
  nowIso,
}: {
  readonly home: string;
  readonly path: string;
  readonly definition: RecipeDefinition;
  readonly nowIso: string;
}): Result<{ readonly written: RecipeDefinition; readonly replaced: boolean }, RecipeDefinitionNotWrittenError> {
  const lock = acquireWaitingLock({ home, key: RECIPE_DEFINITION_HOLDS_LOCK_KEY, nowIso });
  if (lock.isErr()) {
    return err(RecipeErrors.definitionNotWritten({ detail: `its lock is busy: ${lock.error}`, path }));
  }
  try {
    const replaced = existsSync(path);
    const raw = readRawDefinition({ path });
    let kept: RecipeDefinition | undefined;
    if (raw.isOk()) {
      const standing = parseRecipeDefinition({ value: raw.value });
      kept = standing.isOk() ? standing.value : undefined;
    }
    let written: RecipeDefinition = definition;
    if (kept !== undefined) {
      written = withOperatorFields({ current: kept, wanted: definition });
    }
    writeFileAtomic({ contents: `${JSON.stringify(written, null, 2)}\n`, path });
    return ok({ replaced, written });
  } catch (cause) {
    return err(RecipeErrors.definitionNotWritten({ detail: errorMessage({ error: cause }), path }));
  } finally {
    lock.value.release();
  }
}

/**
 * Hold one row because a firing failed, naming the finding whose fix lifts it.
 *
 * A standing hold is never replaced — an owner hold outranks this one, and a standing failure hold already
 * names the finding this failure belongs to, which is how one broken row files ONE finding. A failure hold
 * whose finding says the fix landed no longer stands, so a fresh failure replaces it.
 *
 * @param home the state home the definition lives under
 * @param recipeId the row that failed — its canonical file is `<recipeId>.json`
 * @param finding the slug of the finding the hold names
 * @param reason the hold's reason, from `failureHoldReason`
 * @param nowIso the instant the hold is placed at
 * @returns what the write did, or why the row could not be held
 */
export function placeFailureHold({
  home,
  recipeId,
  finding,
  reason,
  nowIso,
}: {
  readonly home: string;
  readonly recipeId: string;
  readonly finding: string;
  readonly reason: string;
  readonly nowIso: string;
}): Result<PlaceFailureHoldOutcome, RecipeHoldNotPlacedError> {
  const path = join(stateHomePaths({ home }).live.recipe.definitionsDir, `${recipeId}.json`);
  const lock = acquireWaitingLock({ home, key: RECIPE_DEFINITION_HOLDS_LOCK_KEY, nowIso });
  if (lock.isErr()) {
    return err(RecipeErrors.holdNotPlaced({ detail: `its lock is busy: ${lock.error}`, path }));
  }
  try {
    const hold: RecipeHold = { askedIso: nowIso, clearedBy: null, finding, reason };
    return placeLocked({ board: recipeBoardOf({ home }), hold, path, recipeId });
  } finally {
    lock.value.release();
  }
}
