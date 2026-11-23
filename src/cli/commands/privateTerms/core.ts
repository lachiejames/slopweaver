/**
 * The `private-terms` noun's flag specs, usage lines and typed option parsers. The read-back every edit prints is
 * `./readBack.ts`.
 *
 * Pure: no filesystem, no clock. A `--pattern-file` is carried as a PATH and read at the edge, so a term need never
 * sit on a command line and every parse reject stays I/O-free.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, repeatedFlagValues, stringFlagsOf } from "../../parseFlags.js";

/** How many argv entries precede a verb's own arguments: `[node, cli, noun, verb, …]`. */
export const VERB_ARG_OFFSET = 4;

/** The `private-terms` verbs. */
export type PrivateTermsVerb = "add" | "confirm" | "list" | "narrow" | "remove" | "review-prepare" | "review-record";

/** Flags each verb accepts. */
const SPECS: Readonly<Record<PrivateTermsVerb, FlagSpec>> = {
  add: {
    boolean: ["json"],
    repeatable: ["matches", "misses"],
    string: [
      "allowed-where",
      "case",
      "class",
      "home",
      "matches",
      "meaning",
      "misses",
      "pattern",
      "pattern-file",
      "source",
    ],
  },
  confirm: { boolean: ["json"], string: ["home"] },
  list: { boolean: ["json"], string: ["home"] },
  narrow: {
    boolean: ["json"],
    repeatable: ["matches", "misses"],
    string: ["allowed-where", "case", "home", "matches", "meaning", "misses", "pattern", "pattern-file"],
  },
  remove: { boolean: ["json"], string: ["home"] },
  "review-prepare": { boolean: ["json"], string: ["hold", "home"] },
  "review-record": { boolean: ["json"], string: ["home", "review"] },
};

/** One verb's `--`-prefixed flag names, sorted. */
function flagNamesOf({ spec }: { spec: FlagSpec }): readonly string[] {
  return [...stringFlagsOf({ spec }), ...booleanFlagsOf({ spec })].map((name) => `--${name}`).toSorted();
}

/** `--`-prefixed flag names per verb, for the help-truth ratchet. */
export const PRIVATE_TERMS_FLAG_NAMES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(SPECS).map(([verb, spec]) => [verb, flagNamesOf({ spec })]),
);

/** What each verb's positional tail is called in its usage line. */
const POSITIONALS: Readonly<Partial<Record<PrivateTermsVerb, string>>> = {
  confirm: "<proposal-id>",
  narrow: "<term-id>",
  remove: "<term-id>",
};

/**
 * The usage line for one verb, built from its REAL flag spec.
 *
 * @param verb the verb name
 * @returns the usage line
 */
export function privateTermsUsage({ verb }: { verb: PrivateTermsVerb }): string {
  const spec = SPECS[verb];
  const withValue = new Set(stringFlagsOf({ spec }).map((name) => `--${name}`));
  const rendered = flagNamesOf({ spec })
    .map((flag) => (withValue.has(flag) ? `[${flag} <value>]` : `[${flag}]`))
    .join(" ");
  const tail = POSITIONALS[verb];
  const parts = ["usage: slopweaver private-terms", verb, ...(tail === undefined ? [] : [tail]), rendered];
  return parts.join(" ");
}

/** The tail every verb shares. */
interface CommonOptions {
  readonly home: string | undefined;
  readonly json: boolean;
}

/** A pattern given inline or as the path of a file holding it. */
export type PatternInput =
  { readonly kind: "inline"; readonly text: string } | { readonly kind: "file"; readonly path: string };

/** Probes a read-back reports as counts: texts the row must match, and texts it must not. */
export interface PrivateTermProbes {
  readonly matches: readonly string[];
  readonly misses: readonly string[];
}

/** What `private-terms add` was asked to propose. */
export interface PrivateTermsAddOptions extends CommonOptions {
  readonly className: string;
  readonly caseInsensitive: boolean;
  readonly pattern: PatternInput;
  readonly meaning: string;
  readonly allowedWhere: string;
  readonly source: string;
  readonly probes: PrivateTermProbes;
}

/** What `private-terms narrow` was asked to propose. */
export interface PrivateTermsNarrowOptions extends CommonOptions {
  readonly termId: string;
  readonly caseInsensitive: boolean | undefined;
  readonly pattern: PatternInput | undefined;
  readonly meaning: string | undefined;
  readonly allowedWhere: string | undefined;
  readonly probes: PrivateTermProbes;
}

/** What a verb naming one row or one proposal was asked to do. */
export interface PrivateTermsTargetOptions extends CommonOptions {
  readonly target: string;
}

/** What a review verb was asked to do. */
export interface PrivateTermsReviewOptions extends CommonOptions {
  readonly id: string;
}

/** The home and json flags, read once. */
function commonOf({ values }: { values: Readonly<Record<string, string | boolean>> }): CommonOptions {
  const home = values["home"];
  return { home: typeof home === "string" ? home : undefined, json: values["json"] === true };
}

/** A string flag's trimmed value, or undefined when it was not given or is blank. */
function textOf({
  values,
  name,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
}): string | undefined {
  const value = values[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

/** `--case insensitive|sensitive`, or undefined when not given; a problem for anything else. */
function caseOf({
  values,
  problems,
}: {
  values: Readonly<Record<string, string | boolean>>;
  problems: string[];
}): boolean | undefined {
  const value = values["case"];
  if (value === undefined) {
    return undefined;
  }
  if (value === "insensitive") {
    return true;
  }
  if (value === "sensitive") {
    return false;
  }
  problems.push('--case must be "insensitive" or "sensitive"');
  return undefined;
}

/** `--pattern` or `--pattern-file`, never both; undefined when neither. The value is never echoed. */
function patternOf({
  values,
  problems,
}: {
  values: Readonly<Record<string, string | boolean>>;
  problems: string[];
}): PatternInput | undefined {
  const inline = values["pattern"];
  const path = values["pattern-file"];
  if (typeof inline === "string" && typeof path === "string") {
    problems.push("--pattern and --pattern-file are alternatives: give the pattern once");
    return undefined;
  }
  if (typeof inline === "string") {
    return { kind: "inline", text: inline };
  }
  if (typeof path === "string") {
    return { kind: "file", path };
  }
  return undefined;
}

/** The one positional a verb names its target by. */
function targetOf({ positionals, what }: { positionals: readonly string[]; what: string }): Result<string> {
  const [first, ...extra] = positionals;
  if (first === undefined || first.trim().length === 0) {
    return err([`a ${what} is required; \`slopweaver private-terms list\` names them`]);
  }
  if (extra.length > 0) {
    return err([`one ${what} at a time`]);
  }
  return ok(first.trim());
}

/**
 * Parse `private-terms add`.
 *
 * @param rest the argv after the noun and verb
 * @returns the options, or every reason it could not be one
 */
export function parsePrivateTermsAddArgs({ rest }: { rest: readonly string[] }): Result<PrivateTermsAddOptions> {
  const parsed = parseFlags({ args: rest, spec: SPECS.add });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const className = textOf({ name: "class", values });
  const caseInsensitive = caseOf({ problems, values });
  const pattern = patternOf({ problems, values });
  const meaning = textOf({ name: "meaning", values });
  const allowedWhere = textOf({ name: "allowed-where", values });
  const source = textOf({ name: "source", values });
  const required: readonly (readonly [unknown, string])[] = [
    [className, "--class is required: the kind of thing the term names"],
    [values["case"], "--case is required: insensitive or sensitive"],
    [pattern, "one of --pattern or --pattern-file is required"],
    [meaning, "--meaning is required: a term lands with what the owner said it means"],
    [allowedWhere, "--allowed-where is required: where the owner said the term is fine, or `nowhere`"],
    [source, "--source is required: where the rule came from, a relay row or a page"],
  ];
  for (const [value, problem] of required) {
    if (value === undefined) {
      problems.push(problem);
    }
  }
  if (
    problems.length > 0 ||
    className === undefined ||
    caseInsensitive === undefined ||
    pattern === undefined ||
    meaning === undefined ||
    allowedWhere === undefined ||
    source === undefined
  ) {
    return err(problems);
  }
  return ok({
    allowedWhere,
    caseInsensitive,
    className,
    meaning,
    pattern,
    probes: probesOf({ rest }),
    source,
    ...commonOf({ values }),
  });
}

/** The probes a verb was given, in order. */
function probesOf({ rest }: { rest: readonly string[] }): PrivateTermProbes {
  return {
    matches: repeatedFlagValues({ name: "matches", rest }),
    misses: repeatedFlagValues({ name: "misses", rest }),
  };
}

/**
 * Parse `private-terms narrow`.
 *
 * @param rest the argv after the noun and verb
 * @returns the options, or every reason it could not be one
 */
export function parsePrivateTermsNarrowArgs({ rest }: { rest: readonly string[] }): Result<PrivateTermsNarrowOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: SPECS.narrow });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { positionals, values } = parsed.value;
  const target = targetOf({ positionals, what: "term id" });
  const problems: string[] = target.isErr() ? [...target.error] : [];
  const caseInsensitive = caseOf({ problems, values });
  const pattern = patternOf({ problems, values });
  if (target.isErr() || problems.length > 0) {
    return err(problems);
  }
  return ok({
    allowedWhere: textOf({ name: "allowed-where", values }),
    caseInsensitive,
    meaning: textOf({ name: "meaning", values }),
    pattern,
    probes: probesOf({ rest }),
    termId: target.value,
    ...commonOf({ values }),
  });
}

/**
 * Parse a verb naming one target: `remove <term-id>` or `confirm <proposal-id>`.
 *
 * @param rest the argv after the noun and verb
 * @param verb which of the two
 * @returns the options, or every reason it could not be one
 */
export function parsePrivateTermsTargetArgs({
  rest,
  verb,
}: {
  rest: readonly string[];
  verb: "remove" | "confirm";
}): Result<PrivateTermsTargetOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: SPECS[verb] });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const target = targetOf({
    positionals: parsed.value.positionals,
    what: verb === "remove" ? "term id" : "proposal id",
  });
  if (target.isErr()) {
    return err(target.error);
  }
  return ok({ target: target.value, ...commonOf({ values: parsed.value.values }) });
}

/**
 * Parse `private-terms list`.
 *
 * @param rest the argv after the noun and verb
 * @returns the options, or every reason it could not be one
 */
export function parsePrivateTermsListArgs({ rest }: { rest: readonly string[] }): Result<CommonOptions> {
  const parsed = parseFlags({ args: rest, spec: SPECS.list });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok(commonOf({ values: parsed.value.values }));
}

/**
 * Parse `private-terms review-prepare` (`--hold`) or `review-record` (`--review`).
 *
 * @param rest the argv after the noun and verb
 * @param verb which of the two
 * @returns the options, or every reason it could not be one
 */
export function parsePrivateTermsReviewArgs({
  rest,
  verb,
}: {
  rest: readonly string[];
  verb: "review-prepare" | "review-record";
}): Result<PrivateTermsReviewOptions> {
  const parsed = parseFlags({ args: rest, spec: SPECS[verb] });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const flag = verb === "review-prepare" ? "hold" : "review";
  const id = textOf({ name: flag, values: parsed.value.values });
  if (id === undefined) {
    const what = verb === "review-prepare" ? "the hold id a held write printed" : "the Codex pass's artifact id";
    return err([`--${flag} is required: ${what}`]);
  }
  return ok({ id, ...commonOf({ values: parsed.value.values }) });
}
