/**
 * The remembered resync states of rows that still EXIST — what a monitor judges, rather than every state file ever
 * written.
 *
 * A row the registrar retires loses its definition file, never its state file, so its last attempt stays on disk
 * forever. Read whole, that attempt kept feeding a card: a retired scheduled sync's walled attempts raised the same sign-in card
 * (`mon-signin-go-xero-com`) over and over.
 * A wall on a row nothing schedules any more will never be met again, so it is not the owner's to clear.
 *
 * The criterion is LIFECYCLE, not due-ness: a disabled or held row still exists, and its unresolved wall stays. And it
 * fails OPEN: every state is kept when the directory is absent or would not list, or when ANY definition file would
 * not parse — a rejected file is reported by its file name, which need not match the row it names, so no row can be
 * proven absent past it (a malformed `zz-copy.json` naming a live
 * row hid its wall).
 */
import { existsSync } from "node:fs";

import type { RecipeDefinition } from "../automation/definition.js";
import { loadRecipeDefinitions } from "../automation/definitionStore.js";
import type { ResyncState, ResyncStateReadError } from "./outcome.js";
import { readAllResyncState } from "./outcomeStore.js";

/**
 * Whether a recipe's row still exists, by the definitions one read found.
 *
 * @param recipeId the row a state file or slot attempt names
 * @param definitions every definition that parsed — matched by its embedded id, so a misnamed file still counts
 * @param rejectedFiles the file names that would not parse; any one keeps every row, since it may name any of them
 * @param directoryUnreadable whether the directory itself is absent or would not list, which keeps every row
 * @returns true when the row is defined, or when the read cannot prove it is not
 */
export function isLiveRecipe({
  recipeId,
  definitions,
  rejectedFiles,
  directoryUnreadable,
}: {
  readonly recipeId: string;
  readonly definitions: readonly RecipeDefinition[];
  readonly rejectedFiles: readonly string[];
  readonly directoryUnreadable: boolean;
}): boolean {
  if (directoryUnreadable || rejectedFiles.length > 0) {
    return true;
  }
  return definitions.some((definition) => definition.recipeId === recipeId);
}

/** One read of the live rows' states, and every reason part of it could not be trusted. */
export interface ActiveResyncStateRead {
  readonly states: ReadonlyMap<string, ResyncState>;
  readonly corrupt: readonly ResyncStateReadError[];
  /** Why every state was kept — the directory would not list, or a definition would not parse; `null` otherwise. */
  readonly definitionProblem: string | null;
  /** Whether a recipe's row still exists, by this same read — for a caller judging slot attempts too. */
  readonly isLive: (input: { readonly recipeId: string }) => boolean;
}

/**
 * Read every resync state whose row still exists.
 *
 * @param stateDir the resync-state directory
 * @param definitionsDir the recipe definitions directory
 * @returns the live rows' states, the unreadable state files, and the definitions read's own problem
 */
export function readActiveResyncStates({
  stateDir,
  definitionsDir,
}: {
  readonly stateDir: string;
  readonly definitionsDir: string;
}): ActiveResyncStateRead {
  const { states, corrupt } = readAllResyncState({ stateDir });
  // The STORED view: membership is all this reads, and no failure hold needs lifting to answer it.
  const roster = loadRecipeDefinitions({ board: null, directory: definitionsDir });
  const directoryError = unreadableDirectory({ definitionsDir, listingError: roster.directoryError });
  const rejectedFiles = roster.rejected.map((entry) => entry.file);
  const isLive = ({ recipeId }: { readonly recipeId: string }): boolean =>
    isLiveRecipe({
      definitions: roster.definitions,
      directoryUnreadable: directoryError !== null,
      recipeId,
      rejectedFiles,
    });
  const live = new Map([...states].filter(([recipeId]) => isLive({ recipeId })));
  return {
    corrupt,
    definitionProblem: definitionProblemOf({ directoryError, rejectedFiles }),
    isLive,
    states: live,
  };
}

/**
 * Why the definitions directory cannot say which rows exist, or `null` when it can.
 *
 * The store reads an ABSENT directory as no recipes, the right answer for an install that never scheduled one — but
 * here remembered states exist, so something once defined their rows, and a missing directory (or a dangling link to
 * one) cannot prove them retired. Treating it as retired would hide a live wall.
 *
 * @param listingError why the store could not list the directory, or `null`
 * @returns the reason every state must be kept, or `null`
 */
function unreadableDirectory({
  definitionsDir,
  listingError,
}: {
  readonly definitionsDir: string;
  readonly listingError: string | null;
}): string | null {
  if (listingError !== null) {
    return listingError;
  }
  if (!existsSync(definitionsDir)) {
    return `the recipe definitions directory ${definitionsDir} is not there`;
  }
  return null;
}

/**
 * Why the read could not tell a retired row from a live one, or `null` when it could.
 *
 * @param directoryError why the definitions directory would not list, or `null`
 * @param rejectedFiles the definition files that would not parse
 * @returns the one line a monitor names as its blind spot
 */
function definitionProblemOf({
  directoryError,
  rejectedFiles,
}: {
  readonly directoryError: string | null;
  readonly rejectedFiles: readonly string[];
}): string | null {
  if (directoryError !== null) {
    return directoryError;
  }
  if (rejectedFiles.length === 0) {
    return null;
  }
  return `the recipe definition file(s) ${rejectedFiles.join(", ")} would not parse and may name any row`;
}
