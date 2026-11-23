/**
 * The typed failures the recipe stores and parsers author themselves: a definition-runs file that cannot be
 * read, decoded or written, a definition store that cannot be opened, a digest card document that is not a
 * digest card, an `--intro` value that is not an intro, and a repairs register that cannot be read or written.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to this directory. It is distinct from
 * `./digestShotErrors.ts`, which says why one digest citation takes no picture — a caller displays each of
 * those as a line of the card, never as a refusal. A foreign reader's own list (the atlas file reader's, the
 * card schema's issues) is not re-authored here: it rides as `reasons` and {@link recipeErrorLines} prints
 * it one line each, as it always was. The failure-explanations register's variants and factories live in
 * `./explanationErrors.ts` and join the union and `RecipeErrors` here.
 */

import { type RecipeExplanationError, RecipeExplanationErrors } from "./explanationErrors.js";

/** A present definition-runs file could not be read at all; `reasons` is the file reader's own list. */
export interface RecipeRunsFileUnreadableError {
  readonly code: "RUNS_FILE_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly reasons: readonly string[];
}

/** The definition-runs file was read and is not JSON. */
export interface RecipeRunsFileNotJsonError {
  readonly code: "RUNS_FILE_NOT_JSON";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** The definition-runs file is JSON, and not the schema version this build writes. */
export interface RecipeRunsFileWrongSchemaError {
  readonly code: "RUNS_FILE_WRONG_SCHEMA";
  readonly message: string;
  readonly path: string;
  readonly expected: number;
}

/** The definition-runs file carries no `runs` map. */
export interface RecipeRunsMapMissingError {
  readonly code: "RUNS_MAP_MISSING";
  readonly message: string;
  readonly path: string;
}

/** One recipe's entry in the definition-runs file is not a run this build can read. */
export interface RecipeRunEntryUnreadableError {
  readonly code: "RUN_ENTRY_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly recipeId: string;
}

/** A run stamp did not persist — its lock could not be taken, or the write itself failed. */
export interface RecipeRunsFileUnwritableError {
  readonly code: "RUNS_FILE_UNWRITABLE";
  readonly message: string;
  readonly path: string;
  readonly detail: string;
}

/** The definition store directory could not be created. */
export interface RecipeDefinitionStoreUnopenableError {
  readonly code: "DEFINITION_STORE_UNOPENABLE";
  readonly message: string;
  readonly definitionsDir: string;
  readonly cause: unknown;
}

/** The digest card document the read leg printed is not JSON. */
export interface RecipeDigestCardNotJsonError {
  readonly code: "DIGEST_CARD_NOT_JSON";
  readonly message: string;
  readonly cause: unknown;
}

/** The digest card document is JSON and not a digest card; `reasons` is one line per schema issue. */
export interface RecipeDigestCardInvalidError {
  readonly code: "DIGEST_CARD_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A flag was given a value it does not accept; `flag` names it and `got` is what arrived. */
export interface RecipeInvalidFlagValueError {
  readonly code: "INVALID_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
  readonly got: string;
}

/** The repairs register (`./repairTake.ts`) could not be read or appended to at all. */
export interface RecipeRepairsFileError {
  readonly code: "REPAIRS_FILE_UNREADABLE" | "REPAIRS_FILE_UNWRITABLE";
  readonly message: string;
  readonly path: string;
  readonly detail: string;
}

/** A failed firing's hold (`./failureHoldStore.ts`) could not be written onto its definition file. */
export interface RecipeHoldNotPlacedError {
  readonly code: "HOLD_NOT_PLACED";
  readonly message: string;
  readonly path: string;
  readonly detail: string;
}

/** A finding a failed firing owes the board (`./findingDebt.ts`) could not be recorded or cleared. */
export interface RecipeFindingDebtError {
  readonly code: "FINDING_DEBT_NOT_WRITTEN";
  readonly message: string;
  readonly path: string;
  readonly detail: string;
}

/** A definition could not be rewritten keeping the hold on disk — its lock was busy, or the write failed. */
export interface RecipeDefinitionNotWrittenError {
  readonly code: "DEFINITION_NOT_WRITTEN";
  readonly message: string;
  readonly path: string;
  readonly detail: string;
}

/** Every failure this directory authors. */
export type RecipeError =
  | RecipeDefinitionNotWrittenError
  | RecipeExplanationError
  | RecipeFindingDebtError
  | RecipeHoldNotPlacedError
  | RecipeRepairsFileError
  | RecipeRunsFileUnreadableError
  | RecipeRunsFileNotJsonError
  | RecipeRunsFileWrongSchemaError
  | RecipeRunsMapMissingError
  | RecipeRunEntryUnreadableError
  | RecipeRunsFileUnwritableError
  | RecipeDefinitionStoreUnopenableError
  | RecipeDigestCardNotJsonError
  | RecipeDigestCardInvalidError
  | RecipeInvalidFlagValueError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const RecipeErrors = {
  definitionStoreUnopenable: ({
    definitionsDir,
    cause,
    detail,
  }: {
    definitionsDir: string;
    cause: unknown;
    detail: string;
  }): RecipeDefinitionStoreUnopenableError => ({
    cause,
    code: "DEFINITION_STORE_UNOPENABLE",
    definitionsDir,
    message: `could not open the definition store at ${definitionsDir}: ${detail}`,
  }),
  digestCardInvalid: ({ reasons }: { reasons: readonly string[] }): RecipeDigestCardInvalidError => ({
    code: "DIGEST_CARD_INVALID",
    message: reasons.join("; "),
    reasons,
  }),
  digestCardNotJson: ({ cause }: { cause: unknown }): RecipeDigestCardNotJsonError => ({
    cause,
    code: "DIGEST_CARD_NOT_JSON",
    message: `the digest card is not readable JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
  definitionNotWritten: ({ path, detail }: { path: string; detail: string }): RecipeDefinitionNotWrittenError => ({
    code: "DEFINITION_NOT_WRITTEN",
    detail,
    message: `could not write ${path}: ${detail}`,
    path,
  }),
  ...RecipeExplanationErrors,
  holdNotPlaced: ({ path, detail }: { path: string; detail: string }): RecipeHoldNotPlacedError => ({
    code: "HOLD_NOT_PLACED",
    detail,
    message: `could not hold the row in ${path}: ${detail}`,
    path,
  }),
  findingDebtNotWritten: ({ path, detail }: { path: string; detail: string }): RecipeFindingDebtError => ({
    code: "FINDING_DEBT_NOT_WRITTEN",
    detail,
    message: `could not write the owed finding at ${path}: ${detail}`,
    path,
  }),
  introInvalid: ({ got, issue }: { got: string; issue: string }): RecipeInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--intro",
    got,
    message: `--intro must be a JSON array of 1 to 4 non-empty lines: ${issue}`,
  }),
  introNotJson: ({ got }: { got: string }): RecipeInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--intro",
    got,
    message: `--intro is not JSON: pass a JSON array of lines, e.g. '["this is a trial."]'`,
  }),
  repairsFileUnreadable: ({ path, detail }: { path: string; detail: string }): RecipeRepairsFileError => ({
    code: "REPAIRS_FILE_UNREADABLE",
    detail,
    message: `cannot read the repairs register ${path}: ${detail}`,
    path,
  }),
  repairsFileUnwritable: ({ path, detail }: { path: string; detail: string }): RecipeRepairsFileError => ({
    code: "REPAIRS_FILE_UNWRITABLE",
    detail,
    message: `cannot append to the repairs register ${path}: ${detail}`,
    path,
  }),
  runEntryUnreadable: ({ path, recipeId }: { path: string; recipeId: string }): RecipeRunEntryUnreadableError => ({
    code: "RUN_ENTRY_UNREADABLE",
    message: `${path} holds an unreadable entry for recipe '${recipeId}'`,
    path,
    recipeId,
  }),
  runsFileNotJson: ({
    path,
    cause,
    detail,
  }: {
    path: string;
    cause: unknown;
    detail: string;
  }): RecipeRunsFileNotJsonError => ({
    cause,
    code: "RUNS_FILE_NOT_JSON",
    message: `${path} is not valid JSON: ${detail}`,
    path,
  }),
  runsFileUnreadable: ({
    path,
    reasons,
  }: {
    path: string;
    reasons: readonly string[];
  }): RecipeRunsFileUnreadableError => ({
    code: "RUNS_FILE_UNREADABLE",
    message: reasons.join("; "),
    path,
    reasons,
  }),
  runsFileUnwritable: ({ path, detail }: { path: string; detail: string }): RecipeRunsFileUnwritableError => ({
    code: "RUNS_FILE_UNWRITABLE",
    detail,
    message: `cannot write ${path}: ${detail}`,
    path,
  }),
  runsFileWrongSchema: ({ path, expected }: { path: string; expected: number }): RecipeRunsFileWrongSchemaError => ({
    code: "RUNS_FILE_WRONG_SCHEMA",
    expected,
    message: `${path} is not a definition-runs file this build writes (schema version ${String(expected)})`,
    path,
  }),
  runsMapMissing: ({ path }: { path: string }): RecipeRunsMapMissingError => ({
    code: "RUNS_MAP_MISSING",
    message: `${path} carries no runs map`,
    path,
  }),
} as const;

/**
 * The lines a {@link RecipeError} prints, one per problem. A list-carrying variant gives each entry its own line, as the
 * `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function recipeErrorLines({ error }: { error: RecipeError }): readonly string[] {
  if (error.code === "RUNS_FILE_UNREADABLE" || error.code === "DIGEST_CARD_INVALID") {
    return error.reasons;
  }
  return [error.message];
}
