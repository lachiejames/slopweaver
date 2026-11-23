/**
 * Writing what `./registrationPlan.ts` decided into the definition store, and remembering which rows this
 * registrar wrote.
 *
 * ## The ownership file is what makes a retire honest
 *
 * The definition directory is outside code review and nothing gates what lands there
 * (`live/automation/definitionStore.ts`'s own header says so). A registrar that retired every managed-looking
 * id it did not currently derive would therefore delete a row somebody wrote by hand under the same
 * prefix. So a retire is only ever taken against an id THIS registrar recorded writing, and anything else
 * wearing the prefix is reported as a conflict and left where it is.
 *
 * Ownership is recorded AFTER the definition it names is written, never before. A pass that dies between
 * the two leaves a row this registrar will treat as somebody else's — visible, and reported every pass —
 * which is the failure that asks a human a question rather than the one that deletes their file.
 */
import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "../../lib/errorMessage.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { parseRecipeDefinition, type RecipeDefinition } from "../automation/definition.js";
import { RECIPE_DEFINITION_HOLDS_LOCK_KEY } from "../automation/failureHoldStore.js";
import { acquireWaitingLock } from "../automation/waitingLock.js";
import { withOperatorFields } from "./managedRowFields.js";
import type { RegistrationChange, RegistrationPlan } from "./registrationPlan.js";

/** One row this pass declined to touch at the moment of writing, and why. */
export interface RefusedWrite {
  readonly recipeId: string;
  readonly reason: string;
}

/** What one applied pass actually did, so a caller reports the write rather than the intention. */
export interface AppliedRegistration {
  readonly created: readonly string[];
  readonly updated: readonly string[];
  readonly retired: readonly string[];
  /** Rows the plan asked for that the file on disk contradicted. Never written, never recorded as owned. */
  readonly refused: readonly RefusedWrite[];
}

/**
 * The recipe ids a previous pass on this install recorded writing.
 *
 * An unreadable or absent file is an empty list rather than a failure: a fresh install has owned nothing,
 * and refusing here would stop the first registration ever running.
 *
 * @param ownedPath the ownership file, from `stateHome.ts`'s `live.recipe.resyncOwnedJson`
 * @returns the owned ids, sorted
 */
export function readOwnedResyncIds({ ownedPath }: { readonly ownedPath: string }): readonly string[] {
  let text: string;
  try {
    text = readFileSync(ownedPath, "utf8");
  } catch {
    return [];
  }
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: "resync ownership", text });
  } catch {
    return [];
  }
  if (!isRecord(decoded)) {
    return [];
  }
  const ids = decoded["recipeIds"];
  if (!Array.isArray(ids)) {
    return [];
  }
  return ids.filter((id): id is string => typeof id === "string").toSorted();
}

/** The one failure a registration pass answers, whichever step stopped it. */
function unreconciled({ why }: { why: string }): Result<AppliedRegistration> {
  return err([`could not reconcile the resync definitions: ${why}`]);
}

/**
 * Apply one plan: write every create and update, remove every retire, and record what is now owned.
 *
 * @param plan the plan `planResyncRegistration` decided
 * @param definitionsDir the definition store, from `stateHome.ts`'s `live.recipe.definitionsDir`
 * @param ownedPath the ownership file
 * @param owned the ids already recorded as this registrar's
 * @param home the state home whose hold lock the pass takes, so a hold placed since the plan was read survives
 * @param nowIso the instant the pass runs at, for the lock's own staleness check
 * @returns what was written, or the one reason the pass could not complete
 */
export function applyResyncRegistration({
  plan,
  definitionsDir,
  ownedPath,
  owned,
  home,
  nowIso,
}: {
  readonly plan: RegistrationPlan;
  readonly definitionsDir: string;
  readonly ownedPath: string;
  readonly owned: readonly string[];
  readonly home: string;
  readonly nowIso: string;
}): Result<AppliedRegistration> {
  const created: string[] = [];
  const updated: string[] = [];
  const retired: string[] = [];
  const refused: RefusedWrite[] = [];
  const nowOwned = new Set(owned);

  const lock = acquireWaitingLock({ home, key: RECIPE_DEFINITION_HOLDS_LOCK_KEY, nowIso });
  if (lock.isErr()) {
    return unreconciled({ why: `the definition hold lock is busy: ${lock.error}` });
  }
  try {
    mkdirSync(definitionsDir, { recursive: true });
    for (const change of plan.changes) {
      applyOne({ change, created, definitionsDir, nowOwned, refused, retired, updated });
    }
    writeFileAtomic({
      contents: safeJsonStringify({
        label: "resync ownership",
        value: { recipeIds: [...nowOwned].toSorted(), schemaVersion: 1 },
      }),
      path: ownedPath,
    });
  } catch (cause) {
    return unreconciled({ why: errorMessage({ error: cause }) });
  } finally {
    lock.value.release();
  }

  return ok({
    created: created.toSorted(),
    refused: refused.toSorted((left, right) => left.recipeId.localeCompare(right.recipeId)),
    retired: retired.toSorted(),
    updated: updated.toSorted(),
  });
}

/**
 * What physically stands at one row's path, read at the moment of writing.
 *
 * ## Why the writer checks, not only the planner
 *
 * Three separate failures each showed a different way the PLANNER's view of the directory could be
 * wrong while the writer trusted it: a file the parser rejected, a valid file whose embedded recipeId did
 * not match its filename, and a directory that could be written and searched but not LISTED. Each time the
 * create path overwrote the operator's file and recorded this registrar as its owner. Patching the planner
 * per variant is how a fourth gets found, so the writer now reads the one path it is about to touch — by
 * its known name, which works even in a directory that cannot be listed — and acts only on what is there.
 */
type Occupant =
  | { readonly kind: "absent" }
  | { readonly kind: "row"; readonly recipeId: string; readonly definition: RecipeDefinition }
  | { readonly kind: "unreadable" };

/** The occupant of one path. Any read failure other than "not there" is unreadable, never absent. */
function occupantAt({ path }: { readonly path: string }): Occupant {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    // Only a definite ENOENT means nothing is there. A permission or I/O error means SOMETHING may be, and
    // reading that as absent is the exact move that let a create overwrite a file it could not see.
    return isRecord(cause) && cause["code"] === "ENOENT" ? { kind: "absent" } : { kind: "unreadable" };
  }
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: `recipe definition ${path}`, text });
  } catch {
    return { kind: "unreadable" };
  }
  const parsed = parseRecipeDefinition({ value: decoded });
  return parsed.isOk()
    ? { definition: parsed.value, kind: "row", recipeId: parsed.value.recipeId }
    : { kind: "unreadable" };
}

/** Why a planned write contradicts what is on disk, or `null` when it may proceed. */
function writeRefusal({
  change,
  occupant,
}: {
  readonly change: RegistrationChange;
  readonly occupant: Occupant;
}): string | null {
  if (change.action === "create") {
    return occupant.kind === "absent"
      ? null
      : "the plan saw no file here and one stands at this path, so it is not this registrar's to create over";
  }
  if (change.action === "retire" && occupant.kind === "absent") {
    return null;
  }
  if (occupant.kind === "row" && occupant.recipeId === change.recipeId) {
    return null;
  }
  return occupant.kind === "row"
    ? `the file at this path holds recipe \`${occupant.recipeId}\`, not \`${change.recipeId}\` — left as it is`
    : "the file at this path could not be read as a definition, so what it holds is unknown — left as it is";
}

/**
 * Record ownership of an unchanged row only when the file at ITS OWN path is that row.
 *
 * The plan indexes rows by the recipeId inside a file, so an exact copy in
 * `zz-copy.json` read as "unchanged" while the canonical path held somebody else's JSON — and ownership of
 * that path was recorded without ever reading it.
 *
 * @param recipeId the row the plan found unchanged
 * @param refused where a row whose own path is not that row is reported
 * @param nowOwned the ownership set this pass will write
 */
function keepUnchanged({
  definitionsDir,
  recipeId,
  refused,
  nowOwned,
}: {
  readonly definitionsDir: string;
  readonly recipeId: string;
  readonly refused: RefusedWrite[];
  readonly nowOwned: Set<string>;
}): void {
  const occupant = occupantAt({ path: definitionPath({ definitionsDir, recipeId }) });
  if (occupant.kind === "row" && occupant.recipeId === recipeId) {
    nowOwned.add(recipeId);
    return;
  }
  refused.push({
    reason:
      "the plan matched a row by its embedded recipeId, but the file at this id's own path is not that row — ownership not recorded",
    recipeId,
  });
}

/** One change's file effect. Throws on a filesystem failure, which the caller turns into a refusal. */
function applyOne({
  change,
  definitionsDir,
  created,
  updated,
  retired,
  refused,
  nowOwned,
}: {
  readonly change: RegistrationChange;
  readonly definitionsDir: string;
  readonly created: string[];
  readonly updated: string[];
  readonly retired: string[];
  readonly refused: RefusedWrite[];
  readonly nowOwned: Set<string>;
}): void {
  if (change.action === "unchanged") {
    keepUnchanged({ definitionsDir, nowOwned, recipeId: change.recipeId, refused });
    return;
  }
  if (change.action === "conflict") {
    return;
  }
  const path = definitionPath({ definitionsDir, recipeId: change.recipeId });
  const occupant = occupantAt({ path });
  const reason = writeRefusal({ change, occupant });
  if (reason !== null) {
    refused.push({ reason, recipeId: change.recipeId });
    return;
  }
  if (change.action === "retire") {
    rmSync(path, { force: true });
    nowOwned.delete(change.recipeId);
    retired.push(change.recipeId);
    return;
  }
  // Safe: the plan attaches a definition to exactly create and update.
  const definition = change.definition!;
  if (change.action === "create" && !createExclusively({ definition, path })) {
    refused.push({
      reason: "a file appeared at this path between the check and the write, so it was not overwritten",
      recipeId: change.recipeId,
    });
    return;
  }
  if (change.action === "update" && occupant.kind === "row") {
    // The plan was read before the lock was taken, so a hold placed or an `automation enable`/`disable` landed since
    // then is only on disk. Read under the lock, every operator field is carried forward whatever the plan saw.
    writeDefinition({ definition: withOperatorFields({ current: occupant.definition, wanted: definition }), path });
  }
  nowOwned.add(change.recipeId);
  (change.action === "create" ? created : updated).push(change.recipeId);
}

/**
 * Write a brand-new row without ever replacing one, even one that appears after the check above.
 *
 * `writeFileAtomic` renames a temp file into place, and a rename REPLACES whatever stands at the target —
 * right for an update, the whole defect for a create. So a create writes the temp file and then
 * `linkSync`s it into place, which fails with EEXIST rather than clobbering, and removes the temp either way.
 *
 * @param definition the row to write
 * @param path where it goes
 * @returns true when the row was written, false when a file already stood there
 */
function createExclusively({
  definition,
  path,
}: {
  readonly definition: RecipeDefinition;
  readonly path: string;
}): boolean {
  const temporary = `${path}.${String(process.pid)}.${randomUUID()}.tmp`;
  const contents = `${safeJsonStringify({ label: `recipe definition ${definition.recipeId}`, value: definition })}\n`;
  const fd = openSync(temporary, "wx");
  // ONE outer finally owns the temp file from the moment it exists. With the
  // unlink in a second, later try, an ENOSPC from writeSync or an EIO from fsyncSync propagated past it
  // and left a stray temp file behind on every failed pass. `force` because a failed link has already
  // been handled and the file must go whether or not anything reached it.
  try {
    try {
      writeSync(fd, contents);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(temporary, path);
      return true;
    } catch (cause) {
      if (isRecord(cause) && cause["code"] === "EEXIST") {
        return false;
      }
      throw cause;
    }
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Where one row's file lives. */
function definitionPath({
  definitionsDir,
  recipeId,
}: {
  readonly definitionsDir: string;
  readonly recipeId: string;
}): string {
  return join(definitionsDir, `${recipeId}.json`);
}

/** One row, written whole and atomically so a crash mid-write cannot leave half a definition. */
function writeDefinition({ definition, path }: { readonly definition: RecipeDefinition; readonly path: string }): void {
  writeFileAtomic({
    contents: `${safeJsonStringify({ label: `recipe definition ${definition.recipeId}`, value: definition })}\n`,
    path,
  });
}
