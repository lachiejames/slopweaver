/**
 * The typed failures the `recipe` verbs author themselves: a flag tail the tokeniser refused, a required
 * argument that was not given, a flag value the verb does not accept, two flags that cannot be given together,
 * a corpus source this build does not have, the seat's refusal when a firing's record could not be read, a
 * repair take refused because its recipe or its row cannot hold one, and `automation explain`'s own refusals
 * (`./explainErrors.ts`).
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to this directory and named `RecipeCommand*`
 * so it never reads as `src/live/automation/errors.ts`'s `RecipeError`, whose failures this directory forwards
 * rather than re-authors. The flag tokeniser's own list rides as `reasons`, and
 * {@link recipeCommandErrorLines} prints it one line each, as the `readonly string[]` it replaced did.
 */

import type { RecipeSlotAttemptError } from "../../../live/automation/slotAttemptErrors.js";
import { RecipeCommandExplainErrors, type RecipeCommandExplainRefusedError } from "./explainErrors.js";

/** The flag tokeniser refused the tail; `reasons` is its own list. */
export interface RecipeCommandFlagsInvalidError {
  readonly code: "FLAGS_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A required argument was not given; `name` is the flag or positional it names. */
export interface RecipeCommandArgumentMissingError {
  readonly code: "ARGUMENT_MISSING";
  readonly message: string;
  readonly name: string;
}

/** A flag was given a value it does not accept; `flag` names it and `got` is what arrived. */
export interface RecipeCommandInvalidFlagValueError {
  readonly code: "INVALID_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
  readonly got: string;
}

/** Two flags were given that this verb takes only apart. */
export interface RecipeCommandFlagConflictError {
  readonly code: "FLAG_CONFLICT";
  readonly message: string;
  readonly flags: readonly string[];
}

/** `--source` named a corpus source this build does not have. */
export interface RecipeCommandCorpusSourceUnknownError {
  readonly code: "CORPUS_SOURCE_UNKNOWN";
  readonly message: string;
  readonly source: string;
  readonly choices: readonly string[];
}

/** A firing's attempt record could not be read while the seat was planning. */
export interface RecipeCommandSlotAttemptUnreadableError {
  readonly code: "SLOT_ATTEMPT_UNREADABLE";
  readonly message: string;
  readonly cause: RecipeSlotAttemptError;
}

/** `automation repair` refused a take: the recipe is not defined, or the row cannot be repairing anything. */
export interface RecipeCommandRepairRefusedError {
  readonly code: "REPAIR_REFUSED";
  readonly message: string;
  readonly recipeId: string;
  readonly row: string;
}

/** Every failure this directory authors. */
export type RecipeCommandError =
  | RecipeCommandExplainRefusedError
  | RecipeCommandRepairRefusedError
  | RecipeCommandFlagsInvalidError
  | RecipeCommandArgumentMissingError
  | RecipeCommandInvalidFlagValueError
  | RecipeCommandFlagConflictError
  | RecipeCommandCorpusSourceUnknownError
  | RecipeCommandSlotAttemptUnreadableError;

/** A missing argument, named. */
function argumentMissing({ name, message }: { name: string; message: string }): RecipeCommandArgumentMissingError {
  return { code: "ARGUMENT_MISSING", message, name };
}

/** A refused flag value, named. */
function invalidFlagValue({
  flag,
  got,
  message,
}: {
  flag: string;
  got: string;
  message: string;
}): RecipeCommandInvalidFlagValueError {
  return { code: "INVALID_FLAG_VALUE", flag, got, message };
}

/** Two flags given together, named. */
function flagConflict({
  flags,
  message,
}: {
  flags: readonly string[];
  message: string;
}): RecipeCommandFlagConflictError {
  return { code: "FLAG_CONFLICT", flags, message };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const RecipeCommandErrors = {
  claimantMissing: (): RecipeCommandArgumentMissingError =>
    argumentMissing({
      message: "automation claim needs --by <who> — a claim nobody holds is a row nobody can be chased through",
      name: "--by",
    }),
  corpusSourceUnknown: ({
    source,
    choices,
  }: {
    source: string;
    choices: readonly string[];
  }): RecipeCommandCorpusSourceUnknownError => ({
    choices,
    code: "CORPUS_SOURCE_UNKNOWN",
    message: `\`${source}\` is not a corpus source — this build has: ${choices.join(", ")}`,
    source,
  }),
  explainRecipeIdMissing: (): RecipeCommandArgumentMissingError =>
    argumentMissing({
      message: "automation explain needs the id of the row whose firing failed, as its one positional argument",
      name: "recipe-id",
    }),
  ...RecipeCommandExplainErrors,
  explainWhyMissing: (): RecipeCommandArgumentMissingError =>
    argumentMissing({
      message: "automation explain needs --why: what went wrong and what would fix it, in one plain sentence",
      name: "--why",
    }),
  explainWhyRefused: ({ got, why }: { got: string; why: string }): RecipeCommandInvalidFlagValueError =>
    invalidFlagValue({ flag: "--why", got, message: `--why refused: ${why}` }),
  exitCodeNotInteger: ({ got }: { got: string }): RecipeCommandInvalidFlagValueError =>
    invalidFlagValue({ flag: "--exit-code", got, message: `--exit-code must be an integer, got '${got}'` }),
  flagsInvalid: ({ reasons }: { reasons: readonly string[] }): RecipeCommandFlagsInvalidError => ({
    code: "FLAGS_INVALID",
    message: reasons.join("; "),
    reasons,
  }),
  limitNotWhole: ({ got }: { got: string }): RecipeCommandInvalidFlagValueError =>
    invalidFlagValue({
      flag: "--limit",
      got,
      message: `--limit takes a whole number of rows, at least 1 — \`${got}\` is not one`,
    }),
  listWithTarget: (): RecipeCommandFlagConflictError =>
    flagConflict({
      flags: ["--list", "--atlas", "--source"],
      message: "--list prints the whole roster, so it takes neither --atlas nor --source",
    }),
  mediaPathEmpty: ({ got }: { got: string }): RecipeCommandInvalidFlagValueError =>
    invalidFlagValue({ flag: "--media", got, message: "--media takes comma-separated paths and one of them is empty" }),
  mediaWithoutClaim: (): RecipeCommandFlagConflictError =>
    flagConflict({
      flags: ["--media", "--claim-id"],
      message:
        "--media is only accepted alongside --claim-id: a capture is taken in a seated session's own " +
        "browser, so a tick that was not seated has nothing to attach",
    }),
  propagateBatchMissing: (): RecipeCommandArgumentMissingError =>
    argumentMissing({
      message: "--done needs --batch <id>, the batch `automation propagate --status` printed",
      name: "--batch",
    }),
  propagateJsonWithoutStatus: (): RecipeCommandFlagConflictError =>
    flagConflict({ flags: ["--json", "--status"], message: "--json only means anything beside --status" }),
  propagateModeMissing: (): RecipeCommandArgumentMissingError =>
    argumentMissing({ message: "name exactly one of --status, --done or --seat", name: "mode" }),
  propagateRevisionMissing: ({ got }: { got: string }): RecipeCommandInvalidFlagValueError =>
    invalidFlagValue({
      flag: "--through-revision",
      got,
      message: "--done needs --through-revision <n>, the revision `automation propagate --status` printed",
    }),
  propagateRevisionWithoutDone: (): RecipeCommandFlagConflictError =>
    flagConflict({
      flags: ["--through-revision", "--batch", "--done"],
      message: "--through-revision and --batch only mean anything beside --done",
    }),
  reasonMissing: (): RecipeCommandArgumentMissingError =>
    argumentMissing({
      message: "--reason is what was observed, in the verb's own words — it is required unless --clear",
      name: "--reason",
    }),
  recipeIdMissing: (): RecipeCommandArgumentMissingError =>
    argumentMissing({
      message: "automation claim needs the recipe id to claim, as its first positional argument",
      name: "recipe-id",
    }),
  retireFlagMissing: ({ flag }: { flag: "--anchor" | "--words" | "--why" }): RecipeCommandArgumentMissingError =>
    argumentMissing({
      message:
        `automation retire needs ${flag}: a retirement records the anchor, their exact words there and why, ` +
        "so a wrong one is visible and nothing is retired on an unstated word",
      name: flag,
    }),
  retireRecipeIdMissing: (): RecipeCommandArgumentMissingError =>
    argumentMissing({
      message: "automation retire needs the recipe id to retire (or undo), as its one positional argument",
      name: "recipe-id",
    }),
  retireUndoWithWord: (): RecipeCommandFlagConflictError =>
    flagConflict({
      flags: ["--undo", "--anchor", "--words", "--why"],
      message: "--undo removes a retirement, so it takes none of --anchor, --words or --why",
    }),
  switchFlagMissing: ({
    verb,
    flag,
  }: {
    verb: "enable" | "disable";
    flag: "--anchor" | "--words" | "--why";
  }): RecipeCommandArgumentMissingError =>
    argumentMissing({
      message:
        `automation ${verb} needs ${flag}: a switch records the anchor, their exact words there and why, ` +
        "so a wrong one is visible and no row is switched on an unstated word",
      name: flag,
    }),
  switchRecipeIdMissing: ({ verb }: { verb: "enable" | "disable" }): RecipeCommandArgumentMissingError =>
    argumentMissing({
      message: `automation ${verb} needs the recipe id to switch, as its one positional argument`,
      name: "recipe-id",
    }),
  repointRecipeIdMissing: (): RecipeCommandArgumentMissingError =>
    argumentMissing({
      message: "automation repoint needs the drifted row's recipe id, as its one positional argument",
      name: "recipe-id",
    }),
  repairRecipeIdMissing: (): RecipeCommandArgumentMissingError =>
    argumentMissing({
      message: "automation repair needs the stopped recipe's id, as its first positional argument",
      name: "recipe-id",
    }),
  repairRefused: ({
    recipeId,
    row,
    why,
  }: {
    recipeId: string;
    row: string;
    why: string;
  }): RecipeCommandRepairRefusedError => ({
    code: "REPAIR_REFUSED",
    message: `automation repair · ${recipeId} was not taken by ${row}: ${why}`,
    recipeId,
    row,
  }),
  repairRowMissing: (): RecipeCommandArgumentMissingError =>
    argumentMissing({
      message: "automation repair needs --row <slug> — the seat repairing it is named by its board row",
      name: "--row",
    }),
  settlingClaimIdMissing: (): RecipeCommandArgumentMissingError =>
    argumentMissing({
      message:
        "a release carrying --exit-code settles the firing, so it must quote the --claim-id it was given " +
        "when the row was claimed — without it a worker whose lease expired would settle its successor's",
      name: "--claim-id",
    }),
  slotAttemptUnreadable: ({ cause }: { cause: RecipeSlotAttemptError }): RecipeCommandSlotAttemptUnreadableError => ({
    cause,
    code: "SLOT_ATTEMPT_UNREADABLE",
    message: `automation seat · ${cause.message}`,
  }),
  stepEntryEmpty: ({ got }: { got: string }): RecipeCommandInvalidFlagValueError =>
    invalidFlagValue({ flag: "--steps", got, message: "every entry of --steps must be a non-empty string" }),
  stepsEmpty: ({ got }: { got: string }): RecipeCommandInvalidFlagValueError =>
    invalidFlagValue({
      flag: "--steps",
      got,
      message: "--steps needs at least one step; a blocker with no way to clear it is the thing this avoids",
    }),
  stepsMissing: (): RecipeCommandArgumentMissingError =>
    argumentMissing({
      message: "--steps is required unless --clear: a blocker with no way to clear it is not actionable",
      name: "--steps",
    }),
  stepsNotArray: ({ got }: { got: string }): RecipeCommandInvalidFlagValueError =>
    invalidFlagValue({ flag: "--steps", got, message: "--steps as JSON must be a non-empty array of strings" }),
  stepsNotJson: ({ got, cause }: { got: string; cause: unknown }): RecipeCommandInvalidFlagValueError =>
    invalidFlagValue({
      flag: "--steps",
      got,
      message: `--steps opened with \`[\` so it was read as JSON, and is not: ${String(cause)}`,
    }),
  targetMissing: (): RecipeCommandArgumentMissingError =>
    argumentMissing({ message: "name a target: --atlas <platform>, or --source <corpus source>", name: "target" }),
  targetsAmbiguous: (): RecipeCommandFlagConflictError =>
    flagConflict({
      flags: ["--atlas", "--source"],
      message: "--atlas and --source name two different targets — pass exactly one",
    }),
} as const;

/**
 * The lines a {@link RecipeCommandError} prints, one per problem. The tokeniser's list gives each entry its own
 * line, as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function recipeCommandErrorLines({ error }: { error: RecipeCommandError }): readonly string[] {
  if (error.code === "FLAGS_INVALID") {
    return error.reasons;
  }
  return [error.message];
}
