/**
 * The `grant` noun's flag specs, usage strings and typed option parsers.
 *
 * Each verb parses into a domain object rather than a bag of raw flags, so the REFUSALS a verb can produce
 * are visible here — a missing `--change`, a `--check` outside the closed set — instead of being rediscovered
 * in each run function. Pure: no filesystem, no clock. A `--change-file` is carried as a PATH and read at
 * the edge, which keeps every parse reject I/O-free.
 */
import { GRANT_CHECK_CODES, type GrantCheckCode, isGrantCheckCode } from "../../../grants/errors.js";
import type { GrantChangeKind, GrantTarget } from "../../../grants/grant.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
export const VERB_ARG_OFFSET = 4;

/** The `grant` verbs — closed, so a usage line can only be asked for a verb that has a spec. */
type GrantVerb = "list" | "perform" | "record" | "refuse" | "show";

/** Flags each `grant` verb accepts. */
const SPECS: Readonly<Record<GrantVerb, FlagSpec>> = {
  list: { boolean: ["json"], string: ["home"] },
  perform: { boolean: ["json"], string: ["home", "wrote", "wrote-file"] },
  record: {
    boolean: ["json"],
    string: ["anchor", "change", "change-file", "change-kind", "home", "target-file", "target-system"],
  },
  refuse: { boolean: ["json"], string: ["check", "home", "why"] },
  show: { boolean: ["json"], string: ["home"] },
};

/** One verb's `--`-prefixed flag names, sorted — the one rendering both the ratchet and the usage line read. */
function flagNamesOf({ spec }: { spec: FlagSpec }): readonly string[] {
  return [...stringFlagsOf({ spec }), ...booleanFlagsOf({ spec })].map((name) => `--${name}`).toSorted();
}

/** `--`-prefixed flag names per verb, for the help-truth ratchet. */
export const GRANT_FLAG_NAMES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(SPECS).map(([verb, spec]) => [verb, flagNamesOf({ spec })]),
);

/** The flags that take a value, so a usage line renders `[--x <value>]` for exactly those. */
const WITH_VALUE: ReadonlySet<string> = new Set([
  "--anchor",
  "--change",
  "--change-file",
  "--change-kind",
  "--check",
  "--home",
  "--target-file",
  "--target-system",
  "--why",
  "--wrote",
  "--wrote-file",
]);

/** What each verb's positional tail is called in its usage line. */
const POSITIONALS: Readonly<Record<string, string>> = {
  perform: "<grant-id>",
  refuse: "<grant-id>",
  show: "<grant-id>",
};

/**
 * The usage line for one verb, built from its REAL flag spec.
 *
 * @param verb the verb name
 * @returns the usage line
 */
export function grantUsage({ verb }: { verb: GrantVerb }): string {
  const rendered = flagNamesOf({ spec: SPECS[verb] })
    .map((flag) => (WITH_VALUE.has(flag) ? `[${flag} <value>]` : `[${flag}]`))
    .join(" ");
  const tail = POSITIONALS[verb];
  const parts = ["usage: slopweaver grant", verb, ...(tail === undefined ? [] : [tail]), rendered];
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * What `grant record` was asked to write down.
 *
 * @internal — nothing outside this module reads this type; it names the shape for its own readers.
 */
export interface GrantRecordOptions {
  readonly target: GrantTarget;
  readonly changeKind: GrantChangeKind;
  /** The change verbatim, or the path to read it from — exactly one of the two. */
  readonly change:
    { readonly kind: "inline"; readonly text: string } | { readonly kind: "file"; readonly path: string };
  readonly anchor: string;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** What a verb addressing one row was asked to do. *
 * @internal — nothing outside this module reads this type; it names the shape for its own readers.
 */
export interface GrantShowOptions {
  readonly grantId: string;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** What `grant perform` was asked to journal. *
 * @internal — nothing outside this module reads this type; it names the shape for its own readers.
 */
export interface GrantPerformOptions extends GrantShowOptions {
  readonly wrote: { readonly kind: "inline"; readonly text: string } | { readonly kind: "file"; readonly path: string };
}

/** What `grant refuse` was asked to journal — always a named check. *
 * @internal — nothing outside this module reads this type; it names the shape for its own readers.
 */
export interface GrantRefuseOptions extends GrantShowOptions {
  readonly check: GrantCheckCode;
  readonly why: string;
}

/** What `grant list` was asked to print. *
 * @internal — nothing outside this module reads this type; it names the shape for its own readers.
 */
export interface GrantListOptions {
  readonly home: string | undefined;
  readonly json: boolean;
}

/** The common tail every verb shares, resolved once. */
function commonOf({ values }: { values: Readonly<Record<string, string | boolean>> }): {
  home: string | undefined;
  json: boolean;
} {
  const home = values["home"];
  return { home: typeof home === "string" ? home : undefined, json: values["json"] === true };
}

/**
 * Parse `grant record`.
 *
 * @param rest the argv after the noun and verb
 * @returns the options, or every reason it could not be one
 */
export function parseGrantRecordArgs({ rest }: { rest: readonly string[] }): Result<GrantRecordOptions> {
  const parsed = parseFlags({ args: rest, spec: SPECS.record });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const file = values["target-file"];
  const system = values["target-system"];
  let target: GrantTarget | undefined;
  if (typeof file === "string" && typeof system === "string") {
    problems.push("--target-file and --target-system are alternatives — a row names one thing, not two");
  } else if (typeof file === "string") {
    target = { kind: "file", path: file };
  } else if (typeof system === "string") {
    target = { kind: "system", name: system };
  } else {
    problems.push("one of --target-file or --target-system is required — a row must name what the change lands on");
  }
  const change = changeOf({ inline: values["change"], path: values["change-file"], problems });
  const kind = values["change-kind"];
  if (kind !== "diff" && kind !== "literal") {
    problems.push(
      '--change-kind must be "diff" or "literal" — a row records a patch or an exact value, never a paraphrase',
    );
  }
  const anchor = values["anchor"];
  if (typeof anchor !== "string" || anchor.trim().length === 0) {
    problems.push("--anchor is required — a row with no origin is the thing this mechanism exists to refuse");
  }
  if (
    target === undefined ||
    change === undefined ||
    typeof anchor !== "string" ||
    (kind !== "diff" && kind !== "literal")
  ) {
    return err(problems);
  }
  return ok({ anchor: anchor.trim(), change, changeKind: kind, ...commonOf({ values }), target });
}

/** Resolve the `--change`/`--change-file` pair, collecting the reasons it is not exactly one of them. */
function changeOf({
  inline,
  path,
  problems,
}: {
  inline: string | boolean | undefined;
  path: string | boolean | undefined;
  problems: string[];
}): GrantRecordOptions["change"] | undefined {
  if (typeof inline === "string" && typeof path === "string") {
    problems.push("--change and --change-file are alternatives — pass the change once");
    return undefined;
  }
  if (typeof inline === "string") {
    return { kind: "inline", text: inline };
  }
  if (typeof path === "string") {
    return { kind: "file", path };
  }
  problems.push("one of --change or --change-file is required — the EXACT change is what a session checks against");
  return undefined;
}

/** The positional grant id, or the reason there is not exactly one. */
function grantIdOf({ positionals }: { positionals: readonly string[] }): Result<string> {
  const [first, ...extra] = positionals;
  if (first === undefined || first.trim().length === 0) {
    return err(["a grant id is required — `slopweaver grant list` shows the rows this home holds"]);
  }
  if (extra.length > 0) {
    return err(["one grant id at a time — a row is one change"]);
  }
  return ok(first.trim());
}

/**
 * Parse `grant show`.
 *
 * @param rest the argv after the noun and verb
 * @returns the options, or every reason it could not be one
 */
export function parseGrantShowArgs({ rest }: { rest: readonly string[] }): Result<GrantShowOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: SPECS.show });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const id = grantIdOf({ positionals: parsed.value.positionals });
  if (id.isErr()) {
    return err(id.error);
  }
  return ok({ grantId: id.value, ...commonOf({ values: parsed.value.values }) });
}

/**
 * Parse `grant perform`.
 *
 * @param rest the argv after the noun and verb
 * @returns the options, or every reason it could not be one
 */
export function parseGrantPerformArgs({ rest }: { rest: readonly string[] }): Result<GrantPerformOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: SPECS.perform });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const id = grantIdOf({ positionals: parsed.value.positionals });
  const { values } = parsed.value;
  const inline = values["wrote"];
  const path = values["wrote-file"];
  const problems: string[] = id.isErr() ? [...id.error] : [];
  let wrote: GrantPerformOptions["wrote"] | undefined;
  if (typeof inline === "string" && typeof path === "string") {
    problems.push("--wrote and --wrote-file are alternatives — pass the read-back once");
  } else if (typeof inline === "string") {
    wrote = { kind: "inline", text: inline };
  } else if (typeof path === "string") {
    wrote = { kind: "file", path };
  } else {
    problems.push(
      "one of --wrote or --wrote-file is required — the read-back is what makes an over-grant findable afterwards",
    );
  }
  if (id.isErr() || wrote === undefined) {
    return err(problems);
  }
  return ok({ grantId: id.value, ...commonOf({ values }), wrote });
}

/**
 * Parse `grant refuse`.
 *
 * The `--check` value is validated against {@link GRANT_CHECK_CODES} HERE rather than at the journal, so an
 * untyped refusal cannot be written at all. That closed set is the whole mechanism: there is no code for "I
 * do not believe you", so a session that will not act has to name something a reader can go and check.
 *
 * @param rest the argv after the noun and verb
 * @returns the options, or every reason it could not be one
 */
export function parseGrantRefuseArgs({ rest }: { rest: readonly string[] }): Result<GrantRefuseOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: SPECS.refuse });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const id = grantIdOf({ positionals: parsed.value.positionals });
  const { values } = parsed.value;
  const problems: string[] = id.isErr() ? [...id.error] : [];
  const raw = values["check"];
  const check = typeof raw === "string" && isGrantCheckCode(raw) ? raw : undefined;
  if (check === undefined) {
    problems.push(
      `--check must name one of ${GRANT_CHECK_CODES.join(", ")} — a refusal names the check that failed, ` +
        "and there is deliberately no code for disbelieving the sender",
    );
  }
  const rawWhy = values["why"];
  const why = typeof rawWhy === "string" && rawWhy.trim().length > 0 ? rawWhy.trim() : undefined;
  if (why === undefined) {
    problems.push("--why is required — the code says which check, the reason says what this session observed");
  }
  if (id.isErr() || check === undefined || why === undefined) {
    return err(problems);
  }
  return ok({ check, grantId: id.value, ...commonOf({ values }), why });
}

/**
 * Parse `grant list`.
 *
 * @param rest the argv after the noun and verb
 * @returns the options, or every reason it could not be one
 */
export function parseGrantListArgs({ rest }: { rest: readonly string[] }): Result<GrantListOptions> {
  const parsed = parseFlags({ args: rest, spec: SPECS.list });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok(commonOf({ values: parsed.value.values }));
}
