/**
 * The typed failures the `store` verbs author themselves while reading an invocation: a flag tail the tokeniser
 * refused, a list of problems assembled here, a required argument that was not given, a flag value the verb does
 * not accept, a flag this verb refuses by name, a facet the store does not group by, and an exclusions verb that
 * is neither of the two.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to this directory and named `StoreCommand*` so
 * it never reads as `src/store/errors.ts`'s `StoreError`, whose failures this directory forwards rather than
 * re-authors. A list of problems rides as `reasons`, and {@link storeCommandErrorLines} prints it one line each,
 * as the `readonly string[]` it replaced did.
 */
import type { Result } from "../../../lib/result.js";

/** The flag tokeniser refused the tail; `reasons` is its own list. */
export interface StoreCommandFlagsInvalidError {
  readonly code: "FLAGS_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** An invocation refused for every reason in `reasons`, assembled here or forwarded from the domain that wrote them. */
export interface StoreCommandArgumentsRefusedError {
  readonly code: "ARGUMENTS_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A required argument was not given; `name` is the flag or positional it names. */
export interface StoreCommandArgumentMissingError {
  readonly code: "ARGUMENT_MISSING";
  readonly message: string;
  readonly name: string;
}

/** A flag was given a value it does not accept; `flag` names it and `got` is what arrived. */
export interface StoreCommandInvalidFlagValueError {
  readonly code: "INVALID_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
  readonly got: string;
}

/** `--batch` is not a positive whole number; `reasons` is the refusal and the verb's usage, one line each. */
export interface StoreCommandBatchInvalidError {
  readonly code: "BATCH_INVALID";
  readonly message: string;
  readonly flag: string;
  readonly got: string;
  readonly reasons: readonly string[];
}

/** `--facet` names no column the store groups by; `reasons` is the refusal and the facets it does have. */
export interface StoreCommandFacetUnknownError {
  readonly code: "FACET_UNKNOWN";
  readonly message: string;
  readonly facet: string;
  readonly reasons: readonly string[];
}

/** A flag this verb refuses by name, because taking it would mean something the verb cannot do. */
export interface StoreCommandFlagRefusedError {
  readonly code: "FLAG_REFUSED";
  readonly message: string;
  readonly flag: string;
}

/** `store exclusions` was given a verb that is neither `detect` nor `purge`. */
export interface StoreCommandVerbUnknownError {
  readonly code: "VERB_UNKNOWN";
  readonly message: string;
  readonly got: string | undefined;
}

/** Every failure this directory authors. */
export type StoreCommandError =
  | StoreCommandFlagsInvalidError
  | StoreCommandArgumentsRefusedError
  | StoreCommandArgumentMissingError
  | StoreCommandInvalidFlagValueError
  | StoreCommandBatchInvalidError
  | StoreCommandFacetUnknownError
  | StoreCommandFlagRefusedError
  | StoreCommandVerbUnknownError;

/** What a `store` verb's parser answers: the parsed value, or this directory's typed refusal. */
export type Parsed<T> = Result<T, StoreCommandError>;

/** A missing argument, named. */
function argumentMissing({ name, message }: { name: string; message: string }): StoreCommandArgumentMissingError {
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
}): StoreCommandInvalidFlagValueError {
  return { code: "INVALID_FLAG_VALUE", flag, got, message };
}

/** A flag refused by name. */
function flagRefused({ flag, message }: { flag: string; message: string }): StoreCommandFlagRefusedError {
  return { code: "FLAG_REFUSED", flag, message };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const StoreCommandErrors = {
  aboveZeroRequired: ({ flag, got }: { flag: string; got: string }): StoreCommandInvalidFlagValueError =>
    invalidFlagValue({ flag, got, message: `--${flag} takes a whole number above zero, not "${got}"` }),
  argumentsRefused: ({ reasons }: { reasons: readonly string[] }): StoreCommandArgumentsRefusedError => ({
    code: "ARGUMENTS_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  applyBatchIdInvalid: (): StoreCommandInvalidFlagValueError =>
    invalidFlagValue({
      flag: "apply",
      got: "",
      message: "store import: --apply needs the staged batch id staging printed, a lowercase uuid",
    }),
  applyTakesNoPlanFlags: ({ names }: { names: readonly string[] }): StoreCommandFlagRefusedError =>
    flagRefused({
      flag: "apply",
      message: `store import: --apply applies a batch already staged, so it takes no ${names.map((name) => `--${name}`).join(", ")}`,
    }),
  approveDigestInvalid: (): StoreCommandInvalidFlagValueError =>
    invalidFlagValue({
      flag: "approve",
      got: "",
      message: "store import: --approve needs the plan digest the plan printed, sha256: and 64 hex",
    }),
  containerNameInvalid: ({ got }: { got: string }): StoreCommandInvalidFlagValueError =>
    invalidFlagValue({ flag: "container", got, message: `--container "${got}" is not a name docker accepts` }),
  directoryValueMissing: ({ verb, name }: { verb: string; name: string }): StoreCommandArgumentMissingError =>
    argumentMissing({ message: `store ${verb}: --${name} needs a <dir> value`, name: `--${name}` }),
  fromPrefixInvalid: ({ got }: { got: string }): StoreCommandInvalidFlagValueError =>
    invalidFlagValue({
      flag: "from",
      got,
      message: `--from takes a <project>/<instant>/ prefix as the destination spells it, not "${got}"`,
    }),
  loadSourceUnknown: ({
    known,
    unknown,
  }: {
    known: readonly string[];
    unknown: readonly string[];
  }): StoreCommandInvalidFlagValueError =>
    invalidFlagValue({
      flag: "source",
      got: unknown.join(", "),
      message: `store load pulls ${known.join(", ")} — not ${unknown.join(", ")}`,
    }),
  packageVersionMissing: ({ why }: { why: string }): StoreCommandArgumentMissingError =>
    argumentMissing({
      message: `this checkout's package.json gives no version: ${why}`,
      name: "package.json version",
    }),
  rangeInvalid: ({
    flag,
    got,
    min,
    max,
  }: {
    flag: string;
    got: string;
    min: number;
    max: number;
  }): StoreCommandInvalidFlagValueError =>
    invalidFlagValue({
      flag,
      got,
      message: `--${flag} takes a whole number from ${String(min)} to ${String(max)}, not "${got}"`,
    }),
  slotsInvalid: ({ got }: { got: string }): StoreCommandInvalidFlagValueError =>
    invalidFlagValue({ flag: "slots", got, message: `--slots must be a whole number of at least 1, not "${got}"` }),
  stopOnConflictNeedsApply: (): StoreCommandFlagRefusedError =>
    flagRefused({
      flag: "stop-on-conflict",
      message: "store import: --stop-on-conflict decides how --apply <batch-id> meets a difference; it needs --apply",
    }),
  variantNeedsName: (): StoreCommandArgumentMissingError =>
    argumentMissing({ message: "--variant needs --name — a variant of what?", name: "--name" }),
  waveQuestionMissing: (): StoreCommandArgumentMissingError =>
    argumentMissing({ message: "name the question — a wave with no question briefs nobody", name: "question" }),
  waveTermMissing: (): StoreCommandArgumentMissingError =>
    argumentMissing({ message: "--term is required, once per keyword to probe", name: "--term" }),
  aroundModeUnknown: ({ got, known }: { got: string; known: readonly string[] }): StoreCommandInvalidFlagValueError =>
    invalidFlagValue({
      flag: "mode",
      got,
      message: `no Datadog around mode named "${got}" — it has ${known.join(", ")}`,
    }),
  batchInvalid: ({ flag, got, usage }: { flag: string; got: string; usage: string }): StoreCommandBatchInvalidError => {
    const reasons = [`--${flag} must be a whole number of at least 1, not "${got}"`, usage];
    return { code: "BATCH_INVALID", flag, got, message: reasons.join("; "), reasons };
  },
  botScopeContradictory: (): StoreCommandFlagRefusedError =>
    flagRefused({
      flag: "include-bots",
      message:
        "--include-bots and --exclude-bots contradict each other — human-only is the default, so pass --include-bots alone to widen",
    }),
  cadenceInvalid: ({ got }: { got: string }): StoreCommandInvalidFlagValueError =>
    invalidFlagValue({ flag: "cadence", got, message: `--cadence takes a five-field cron expression, not "${got}"` }),
  collectPathsMissing: (): StoreCommandArgumentMissingError =>
    argumentMissing({ message: "--plan and --replies are both required", name: "--plan/--replies" }),
  datadogRegexRefused: (): StoreCommandFlagRefusedError =>
    flagRefused({
      flag: "regex",
      message:
        "Datadog's search syntax has no regular expressions — pull a bounded page with " +
        "`store hits --source datadog --regex <p>`, which matches locally and says so",
    }),
  datadogShapeRefused: ({ rungs }: { rungs: readonly string[] }): StoreCommandFlagRefusedError =>
    flagRefused({
      flag: "shape",
      message: `--shape is the local store's flag; Datadog's ladder has rungs, not shapes — use --rung ${rungs.join("|")}`,
    }),
  datadogSubjectMissing: (): StoreCommandArgumentMissingError =>
    argumentMissing({ message: "name at least one keyword — a probe with no subject counts nothing", name: "keyword" }),
  exclusionApplyRefused: (): StoreCommandFlagRefusedError =>
    flagRefused({
      flag: "apply",
      message:
        "store exclusions detect --apply: detection never changes policy. It proposes pairs; a proposal " +
        "becomes a denial only when somebody writes it into the denylist, which is what keeps the rule from " +
        "moving on its own as a channel gets busier or quieter.",
    }),
  exclusionDeleteHumanThreadsRefused: (): StoreCommandFlagRefusedError =>
    flagRefused({
      flag: "delete-human-threads",
      message:
        "store exclusions detect --delete-human-threads: rule D is a property of what a PURGE removes, and " +
        "detection removes nothing. A flag that parsed here and then did nothing is the one an operator " +
        "later swears they passed.",
    }),
  exclusionVerbUnknown: ({ got }: { got: string | undefined }): StoreCommandVerbUnknownError => {
    let named = "nothing";
    if (got !== undefined) {
      named = got;
    }
    return { code: "VERB_UNKNOWN", got, message: `store exclusions: expected "detect" or "purge", got ${named}` };
  },
  facetUnknown: ({ facet, known }: { facet: string; known: readonly string[] }): StoreCommandFacetUnknownError => {
    const reasons = [`no facet named "${facet}"`, `facets: ${known.join(", ")}`];
    return { code: "FACET_UNKNOWN", facet, message: reasons.join("; "), reasons };
  },
  flagsInvalid: ({ reasons }: { reasons: readonly string[] }): StoreCommandFlagsInvalidError => ({
    code: "FLAGS_INVALID",
    message: reasons.join("; "),
    reasons,
  }),
  idListEmpty: ({ got }: { got: string }): StoreCommandInvalidFlagValueError =>
    invalidFlagValue({ flag: "id", got, message: "--id named no record" }),
  idsMissing: (): StoreCommandArgumentMissingError =>
    argumentMissing({ message: "--id is required — one record id, or several separated by commas", name: "--id" }),
  integerRequired: ({ flag, got }: { flag: string; got: string }): StoreCommandInvalidFlagValueError =>
    invalidFlagValue({ flag, got, message: `--${flag} takes a whole number, not "${got}"` }),
  positiveWholeNumberRequired: ({ flag, got }: { flag: string; got: string }): StoreCommandInvalidFlagValueError =>
    invalidFlagValue({ flag, got, message: `--${flag} must be a whole number of at least 1, not "${got}"` }),
  probeSubjectMissing: (): StoreCommandArgumentMissingError =>
    argumentMissing({
      message: "name at least one keyword, or a --regex — a probe with no subject counts nothing",
      name: "keyword",
    }),
  questionMissing: (): StoreCommandArgumentMissingError =>
    argumentMissing({ message: "this verb needs a question to search for", name: "question" }),
  regexInvalid: ({ pattern, detail }: { pattern: string; detail: string }): StoreCommandInvalidFlagValueError =>
    invalidFlagValue({ flag: "regex", got: pattern, message: `--regex is not a regular expression: ${detail}` }),
  restoreTargetMissing: (): StoreCommandArgumentMissingError =>
    argumentMissing({ message: "--into <database> is required — the database the restore creates", name: "--into" }),
  rungUnknown: ({ got, known }: { got: string; known: readonly string[] }): StoreCommandInvalidFlagValueError =>
    invalidFlagValue({
      flag: "rung",
      got,
      message: `no rung named "${got}" — Datadog's ladder has ${known.join(", ")}`,
    }),
  shapeMissing: ({ known }: { known: readonly string[] }): StoreCommandArgumentMissingError =>
    argumentMissing({ message: `--shape is required — one of ${known.join(", ")}`, name: "--shape" }),
  shapeUnknown: ({ got, known }: { got: string; known: readonly string[] }): StoreCommandInvalidFlagValueError =>
    invalidFlagValue({ flag: "shape", got, message: `no shape named "${got}" — the ladder has ${known.join(", ")}` }),
  throughMissing: (): StoreCommandArgumentMissingError =>
    argumentMissing({
      message:
        "--through <tag> is required: the last migration this database already reflects, e.g. 0000_polite_lady_mastermind",
      name: "--through",
    }),
  verbRefused: ({ verb, reasons }: { verb: string; reasons: readonly string[] }): StoreCommandArgumentsRefusedError => {
    const said = reasons.length > 0 ? reasons : [`${verb} was refused`];
    return { code: "ARGUMENTS_REFUSED", message: said.join("; "), reasons: said };
  },
  wholeNumberRequired: ({ flag, got }: { flag: string; got: string }): StoreCommandInvalidFlagValueError =>
    invalidFlagValue({ flag, got, message: `--${flag} must be a whole number, not "${got}"` }),
} as const;

/**
 * The lines a {@link StoreCommandError} prints, one per problem. A list-carrying variant gives each entry its own
 * line, as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function storeCommandErrorLines({ error }: { error: StoreCommandError }): readonly string[] {
  if (
    error.code === "FLAGS_INVALID" ||
    error.code === "ARGUMENTS_REFUSED" ||
    error.code === "BATCH_INVALID" ||
    error.code === "FACET_UNKNOWN"
  ) {
    return error.reasons;
  }
  return [error.message];
}

/**
 * Every line the FAILED results among several refuse with, in order — how a parser that checks each flag on its
 * own reports all of them at once. A plain `readonly string[]` failure (one the store's own domain wrote) is
 * carried as it is.
 *
 * @param results each flag's own parse, failed or not
 * @returns one line per problem, empty when none failed
 */
export function refusalLines({
  results,
}: {
  results: readonly Result<unknown, StoreCommandError | readonly string[]>[];
}): readonly string[] {
  return results.flatMap((result) => {
    if (result.isOk()) {
      return [];
    }
    return "code" in result.error ? storeCommandErrorLines({ error: result.error }) : result.error;
  });
}
