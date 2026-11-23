/**
 * Writing a standing row into the definition store — the effectful half of `./declaredStandingRows.ts`. It is
 * handed the declared rows and never reads the team registry itself.
 *
 * ## Two actions: create what is nowhere, bring forward the build's own untouched write
 *
 * There is no general update path, no retire path and no ownership file here, and their absence is the
 * design rather than a stage it has not reached. `live/resync/registrationStore.ts` needs all three because
 * its roster is open and it rewrites rows; each of those paths had to be taught, by a separate Codex pass,
 * not to overwrite somebody's file. This registrar creates into an EMPTY path, and rewrites an occupied one
 * only when the bytes standing there parse to EXACTLY a definition an earlier build declared
 * (`StandingRow.supersedes`) — the one occupant provably its own. A declaration that changes cadence would
 * otherwise never reach an install that already holds the old row: `worktree-prune` read `0 4 * * *` on the
 * install its hourly declaration was written for.
 *
 * The comparison is made against the file as read at the moment of writing, never the planner's parse, so an
 * edit landing between `automation due` and this write is seen and left alone. An edit landing between that read
 * and the atomic rename is the residue, the same window the create path has between its ENOENT and its write.
 *
 * ## The occupant is read at the moment of writing, by name
 *
 * The planner's view of the directory can be wrong in ways a `readdir` never shows: a directory that can be
 * written and searched but not LISTED reads as empty, and a file whose embedded recipeId does not match its
 * own filename is indexed under the wrong id. Both were found live in the resync registrar, both times with
 * a create overwriting the operator's file. So the write opens the one path it is about to touch, by its
 * known name, and proceeds only on a definite ENOENT — any other read failure means SOMETHING may be there.
 *
 * ## A row this build's own reader refuses is never written
 *
 * Both writes first parse the declared row with `./definition.ts`'s `parseRecipeDefinition`, the reader every
 * verb uses, and refuse one it rejects: a kind this build does not register, an effect past its kind, a
 * malformed shape. Writing it would make the store unreadable WHOLE to every reader, this build's included.
 * What this cannot stop is an OLDER build reading a row a newer one wrote, correctly: that is the stale-seat
 * class `src/cli/staleSeat.ts` documents, and the reader's own `UNKNOWN_KIND` message names it.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "../../lib/errorMessage.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { parseRecipeDefinition } from "./definition.js";
import { type RecipeError, RecipeErrors } from "./errors.js";
import type { StandingRow } from "./standingRow.js";
import { holdsEarlierShape, splitStoreOverlay } from "./standingRowSupersession.js";

/**
 * What one row's write did, or why it was left alone.
 *
 * @internal — a field type on {@link StandingRowWriteReport}; nothing outside this file names it.
 */
export type StandingRowOutcome =
  /** The path was empty and the row was written there. */
  | { readonly kind: "created"; readonly recipeId: string; readonly path: string }
  /** The path held an earlier build's untouched row, and this build's declaration replaced it. */
  | { readonly kind: "brought-forward"; readonly recipeId: string; readonly path: string }
  /** The row was already in the store — nothing to do, and nothing to report as a defect. */
  | { readonly kind: "present"; readonly recipeId: string }
  /** Something stands at the path that this verb will not write over, and what it is. */
  | { readonly kind: "refused"; readonly recipeId: string; readonly reason: string };

/** What one whole pass did. */
export interface StandingRowWriteReport {
  readonly outcomes: readonly StandingRowOutcome[];
  /** Whether the pass only reported what it would have done. */
  readonly dryRun: boolean;
}

/** The file one row's definition belongs in. */
function definitionPath({
  definitionsDir,
  recipeId,
}: {
  readonly definitionsDir: string;
  readonly recipeId: string;
}): string {
  return join(definitionsDir, `${recipeId}.json`);
}

/** What physically stands at one path: definitely nothing, something unreadable, or bytes. */
type Occupant = { readonly kind: "absent" } | { readonly kind: "occupied"; readonly detail: string };

/**
 * What is at one path, erring towards "something is".
 *
 * Only a definite `ENOENT` answers absent. A permission error, an I/O error or a directory in the way each
 * means a write would be over something, and reading any of them as "nothing is there" is precisely the move
 * that let a create clobber an operator's file three separate times in the resync registrar.
 *
 * @param path the file this pass would write
 * @returns whether the path is definitely empty, or what stopped it being read
 */
function occupantAt({ path }: { readonly path: string }): Occupant {
  try {
    readFileSync(path, "utf8");
  } catch (cause) {
    if (isRecord(cause) && cause["code"] === "ENOENT") {
      return { kind: "absent" };
    }
    return { detail: `it could not be read — ${errorMessage({ error: cause })}`, kind: "occupied" };
  }
  return { detail: "a file already stands there", kind: "occupied" };
}

/**
 * The bytes one declared row is written as, or its refusal when THIS build's own reader would reject them.
 *
 * A row is written into the one store every seat on the machine reads, so a definition this build cannot parse
 * would be written by the verb whose whole job is to make the set readable — and every reader, this build's
 * included, would then refuse the set whole (`automation run-due` exits 1, `supervisor tick close` cannot judge
 * its stopped recipes). Checked before the path is touched, dry run included, so the report says it first. The
 * serialised BYTES are what is parsed, and those same bytes are what a write puts down, so the check and the
 * file cannot differ (an object's `toJSON` could otherwise write what the parse never saw).
 *
 * @param row the declared row
 * @param failureHold a failure hold the store placed on the row being replaced, carried onto the new bytes
 * @returns the bytes to write, or the refused outcome naming the parse failure
 */
function admittedContents({
  row,
  failureHold,
}: {
  readonly row: StandingRow;
  readonly failureHold: unknown;
}): Result<string, StandingRowOutcome> {
  const recipeId = row.definition.recipeId;
  const label = `standing row ${recipeId}`;
  const value = failureHold === undefined ? row.definition : { ...row.definition, hold: failureHold };
  const contents = `${safeJsonStringify({ label, value })}\n`;
  const parsed = parseRecipeDefinition({ value: safeJsonParse({ label, text: contents }) });
  if (parsed.isOk()) {
    return ok(contents);
  }
  return err({
    kind: "refused",
    reason: `this build's own reader refuses the declared row, so it is not written — ${parsed.error.message}`,
    recipeId,
  });
}

/**
 * Write every declared row the store does not hold, bring forward every one it holds in an earlier build's
 * untouched shape, and leave everything else exactly as it is.
 *
 * @param rows the rows this build requires
 * @param absentIds the recipe ids a read of the store found nowhere — the only ids this pass may create
 * @param supersededIds the recipe ids a read of the store found in a superseded shape in their one canonical
 *   file — the only ids this pass may rewrite, and only after its own re-read still finds that shape
 * @param ambiguousIds the recipe ids with a superseded shape in some file while the id stands in more than one,
 *   or under another name — refused, never written
 * @param definitionsDir the definition store, from `stateHome.ts`'s `live.recipe.definitionsDir`
 * @param dryRun report what would be written and write nothing
 * @returns one outcome per declared row, or the one reason the pass could not run at all
 */
export function writeStandingRows({
  rows,
  absentIds,
  supersededIds,
  ambiguousIds = [],
  definitionsDir,
  dryRun,
}: {
  readonly rows: readonly StandingRow[];
  readonly absentIds: readonly string[];
  readonly supersededIds: readonly string[];
  readonly ambiguousIds?: readonly string[];
  readonly definitionsDir: string;
  readonly dryRun: boolean;
}): Result<StandingRowWriteReport, RecipeError> {
  if (!dryRun) {
    try {
      mkdirSync(definitionsDir, { recursive: true });
    } catch (cause) {
      return err(
        RecipeErrors.definitionStoreUnopenable({ cause, definitionsDir, detail: errorMessage({ error: cause }) }),
      );
    }
  }
  const outcomes: StandingRowOutcome[] = [];
  for (const row of rows) {
    const recipeId = row.definition.recipeId;
    if (ambiguousIds.includes(recipeId)) {
      outcomes.push({
        kind: "refused",
        reason:
          "an earlier build's row stands in a file beside another copy of this id, or under another file's " +
          `name — left as it is; remove every copy but \`${recipeId}.json\``,
        recipeId,
      });
      continue;
    }
    if (supersededIds.includes(recipeId)) {
      outcomes.push(bringForward({ definitionsDir, dryRun, row }));
      continue;
    }
    if (!absentIds.includes(recipeId)) {
      outcomes.push({ kind: "present", recipeId });
      continue;
    }
    outcomes.push(writeOne({ definitionsDir, dryRun, row }));
  }
  return ok({ dryRun, outcomes });
}

/**
 * Write one absent row, after checking its own path is really empty.
 *
 * @param row the declared row
 * @param definitionsDir the definition store
 * @param dryRun report what would be written and write nothing
 * @returns what happened to that row
 */
function writeOne({
  row,
  definitionsDir,
  dryRun,
}: {
  readonly row: StandingRow;
  readonly definitionsDir: string;
  readonly dryRun: boolean;
}): StandingRowOutcome {
  const recipeId = row.definition.recipeId;
  const admitted = admittedContents({ failureHold: undefined, row });
  if (admitted.isErr()) {
    return admitted.error;
  }
  const path = definitionPath({ definitionsDir, recipeId });
  const occupant = occupantAt({ path });
  if (occupant.kind === "occupied") {
    return {
      kind: "refused",
      reason:
        `the read of the store found no row \`${recipeId}\` and ${occupant.detail} at ${path} — ` +
        "left as it is, because a path this verb cannot prove empty is somebody's work",
      recipeId,
    };
  }
  if (dryRun) {
    return { kind: "created", path, recipeId };
  }
  try {
    writeFileAtomic({
      contents: admitted.value,
      path,
    });
  } catch (cause) {
    return { kind: "refused", reason: `the write failed — ${errorMessage({ error: cause })}`, recipeId };
  }
  return { kind: "created", path, recipeId };
}

/**
 * The file at one path, read NOW, when it is exactly one of a row's superseded definitions apart from a failure hold
 * the store placed — with that hold, so the brought-forward row stays held until its finding settles.
 *
 * @param path the file this pass would rewrite
 * @param row the declared row, carrying the earlier shapes that are provably a build's own write
 * @returns the failure hold to carry (`undefined` when none), or `null` when the bytes there are not an earlier
 *   shape; any read or parse failure is `null`
 */
function supersededOccupant({
  path,
  row,
}: {
  readonly path: string;
  readonly row: StandingRow;
}): { readonly failureHold: unknown } | null {
  const { supersedes = [] } = row;
  let stored: unknown;
  try {
    stored = safeJsonParse({ label: `standing row ${row.definition.recipeId}`, text: readFileSync(path, "utf8") });
  } catch {
    return null;
  }
  if (!holdsEarlierShape({ stored, supersedes })) {
    return null;
  }
  return { failureHold: splitStoreOverlay({ stored }).failureHold };
}

/**
 * Replace one row an earlier build wrote with this build's declaration, after re-reading it.
 *
 * @param row the declared row
 * @param definitionsDir the definition store
 * @param dryRun report what would be written and write nothing
 * @returns what happened to that row
 */
function bringForward({
  row,
  definitionsDir,
  dryRun,
}: {
  readonly row: StandingRow;
  readonly definitionsDir: string;
  readonly dryRun: boolean;
}): StandingRowOutcome {
  const recipeId = row.definition.recipeId;
  const path = definitionPath({ definitionsDir, recipeId });
  const occupant = supersededOccupant({ path, row });
  if (occupant === null) {
    return {
      kind: "refused",
      reason:
        `the read of the store found an earlier build's \`${recipeId}\` and ${path} no longer holds exactly that — ` +
        "left as it is, because a row edited since is somebody's work",
      recipeId,
    };
  }
  const admitted = admittedContents({ failureHold: occupant.failureHold, row });
  if (admitted.isErr()) {
    return admitted.error;
  }
  if (dryRun) {
    return { kind: "brought-forward", path, recipeId };
  }
  try {
    writeFileAtomic({
      contents: admitted.value,
      path,
    });
  } catch (cause) {
    return { kind: "refused", reason: `the write failed — ${errorMessage({ error: cause })}`, recipeId };
  }
  return { kind: "brought-forward", path, recipeId };
}

/**
 * One pass as the lines a reader sees.
 *
 * @param report what the pass did
 * @returns the lines to print, ending in the tally
 */
export function standingRowLines({ report }: { readonly report: StandingRowWriteReport }): readonly string[] {
  const verb = report.dryRun ? "would write" : "wrote";
  const lines = report.outcomes.map((outcome) => {
    if (outcome.kind === "created") {
      return `${verb} ${outcome.recipeId} · ${outcome.path}`;
    }
    if (outcome.kind === "brought-forward") {
      return `${verb} ${outcome.recipeId} · ${outcome.path} · over an earlier build's untouched row`;
    }
    if (outcome.kind === "present") {
      return `-- ${outcome.recipeId} · already in the store`;
    }
    return `!! ${outcome.recipeId} · ${outcome.reason}`;
  });
  const created = report.outcomes.filter(
    (outcome) => outcome.kind === "created" || outcome.kind === "brought-forward",
  ).length;
  const refused = report.outcomes.filter((outcome) => outcome.kind === "refused").length;
  const tally =
    `automation register-standing · ${String(created)} ${report.dryRun ? "to write" : "written"} · ` +
    `${String(refused)} refused · ${String(report.outcomes.length)} row(s) declared`;
  return [...lines, tally];
}
