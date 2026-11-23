/**
 * Verb-tail parsing helpers. Tokenising is delegated to {@link parseFlags} (built on Node's `parseArgs`),
 * so verbs never hand-roll a `--flag value` loop again; this module keeps the small VALUE validators
 * (positive-integer, etc.) that turn a raw flag string into a checked number with a domain error.
 */

import { absentAsEmpty } from "#lib/absent.js";
import { slopweaverHome } from "../homeDir.js";
import { err, ok, type Result } from "../lib/result.js";
import { parseFlags } from "./parseFlags.js";

export interface FlagTailSpec {
  /** Flag names (without the `--`) that take a value. */
  readonly value: readonly string[];
  /** Flag names (without the `--`) that are boolean switches. */
  readonly boolean?: readonly string[];
  /** The `value` flags whose repeats are a list the verb reads off the raw argv; see `FlagSpec.repeatable`. */
  readonly repeatable?: readonly string[];
}

export interface ParsedFlagTail {
  readonly values: Readonly<Record<string, string>>;
  readonly flags: ReadonlySet<string>;
}

/**
 * One value flag's argument, or `null` when it was not passed.
 *
 * `values` is a plain record under `noUncheckedIndexedAccess`, so every reader of an optional flag has to
 * turn `undefined` into its own absent case. Named here so that turn happens in one place: a `??` at each
 * call site reads as "use this instead" when the fact is "the caller did not pass it", which is the
 * substitution `no-silent-fallback` exists to make visible.
 *
 * @param parsed what {@link parseFlagTail} returned
 * @param name the flag name, without the `--`
 * @returns the value, or `null`
 */
export function flagValue({ parsed, name }: { parsed: ParsedFlagTail; name: string }): string | null {
  const given = parsed.values[name];
  if (given === undefined) {
    return null;
  }
  return given;
}

/**
 * One value flag's argument, or a stated default when the caller did not pass it.
 *
 * The `fallback` parameter is the point: it NAMES the substitution at the call site, which is what
 * `no-silent-fallback` asks for and a `??` does not do. The caller is a verb with a stated default for one
 * of its flags: `--to now`, `--grant read`, or `--home` as this install's state home.
 *
 * @param parsed what {@link parseFlagTail} returned
 * @param name the flag name, without the `--`
 * @param fallback what to use when the flag was not passed
 * @returns the value, or the fallback
 */
export function flagValueOr({
  parsed,
  name,
  fallback,
}: {
  parsed: ParsedFlagTail;
  name: string;
  fallback: string;
}): string {
  const given = flagValue({ name, parsed });
  if (given === null) {
    return fallback;
  }
  return given;
}

/**
 * A REQUIRED value flag's argument, refusing its absence and an empty value as two different things: a flag
 * never passed gets the caller's `missing` line, which says what the flag is for, and `--name ""` is a
 * malformed value and says so — it never reaches a read as a path or an id that is not there.
 *
 * @param parsed what {@link parseFlagTail} returned
 * @param name the flag name, without the `--`
 * @param missing the refusal when the flag was not passed — what it is for, and its shape
 * @returns the non-empty value, or the one line refusing it
 */
export function requiredFlagValue({
  parsed,
  name,
  missing,
}: {
  parsed: ParsedFlagTail;
  name: string;
  missing: string;
}): Result<string> {
  const given = flagValue({ name, parsed });
  if (given === null) {
    return err([missing]);
  }
  return nonEmptyFlagValue({ name, value: given });
}

/**
 * A value flag that WAS passed, refused when its value is empty — a malformed value, never a path or an id.
 *
 * @param name the flag name, without the `--`
 * @param value what the flag carried
 * @returns the value, or the one line refusing an empty one
 */
export function nonEmptyFlagValue({ name, value }: { name: string; value: string }): Result<string> {
  if (value.length === 0) {
    return err([`--${name} was given an empty value — pass the value itself`]);
  }
  return ok(value);
}

/**
 * Parse a `--flag value` / `--switch` tail into a validated bag, returning `err` for an UNKNOWN flag, a
 * MISSING value, a REPEATED value flag, or a stray positional — instead of silently dropping them. Thin adapter over
 * {@link parseFlags}: string flags become `values`, boolean switches become `flags`.
 *
 * @param rest the argv tail (verb args, after `node cli noun verb`)
 * @param spec the value + boolean flag names to accept
 * @returns the parsed `{ values, flags }`, or an error listing every rejection
 */
export function parseFlagTail({ rest, spec }: { rest: readonly string[]; spec: FlagTailSpec }): Result<ParsedFlagTail> {
  const parsed = parseFlags({
    allowPositionals: false,
    args: rest,
    spec: {
      boolean: absentAsEmpty({ value: spec.boolean }),
      string: spec.value,
      // Absent is carried as absent: `FlagSpec.repeatable` is optional and `parseFlags` reads it as none.
      ...(spec.repeatable === undefined ? {} : { repeatable: spec.repeatable }),
    },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (const [key, value] of Object.entries(parsed.value.values)) {
    if (typeof value === "string") {
      values[key] = value;
    } else {
      flags.add(key);
    }
  }
  return ok({ flags, values });
}

/**
 * Parse a flag value as a positive integer, pushing a domain error when it isn't one. Callers accumulate
 * `errors` across every flag on the tail and refuse before touching the return value, so on failure this
 * returns `undefined` rather than a plausible-looking number — an honest "no value", not a fallback the
 * next caller might forget to guard against.
 *
 * @param value the raw flag value
 * @param label the flag name (for the error message)
 * @param errors the error accumulator to push into
 * @returns the parsed positive integer, or `undefined` when `value` failed to parse
 */
export function parsePositiveInteger({
  value,
  label,
  errors,
}: {
  value: string;
  label: string;
  errors: string[];
}): number | undefined {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  errors.push(`${label} must be a positive integer`);
  return undefined;
}

/**
 * The flag tail for a verb, whichever spelling the caller used.
 *
 * The router hands a handler the FULL argv — `[node, cli, noun, verb, …]` — so a noun that offers both a
 * bare form and a named verb has two different tails to strip: 3 for `slopweaver audit`, 4 for
 * `slopweaver audit run`. A handler that hard-codes `argv.slice(3)` passes its own verb name into its flag
 * parser, which rejects it.
 *
 * That was not hypothetical. Measured across the live surface, FOUR advertised verbs exited 2 with
 * `unexpected argument: run` — `audit run`, `derive run`, `compact run` and `seed run` — while their bare
 * forms worked and `slopweaver catalog` advertised both spellings.
 *
 * A `--help` sweep cannot find this, and that is worth knowing: every handler tests for `--help` BEFORE it
 * parses, so `--help` short-circuits past the defect. The first sweep came back clean while all four were
 * broken.
 *
 * @param argv the full process argv
 * @param verbs the verb names this noun answers to, so a flag VALUE that merely looks like one is not eaten
 * @param at where the verb sits, for a verb reached through a noun AND a platform rather than a noun alone
 *   (`atlas vanta sync` puts it one word later than `derive run` does); omitted takes the noun-plus-verb shape
 * @returns argv after the noun and, when present, the verb token
 */
export function verbTail({
  argv,
  verbs,
  at = 3,
}: {
  argv: readonly string[];
  verbs: readonly string[];
  at?: number;
}): readonly string[] {
  const candidate = argv[at];
  return candidate !== undefined && verbs.includes(candidate) ? argv.slice(at + 1) : argv.slice(at);
}

/**
 * Every value given to a repeatable flag, in the order it was written.
 *
 * @param rest the raw argv tail
 * @param name the flag, including its leading dashes
 * @returns each supplied value
 */
export function collectRepeated({ rest, name }: { rest: readonly string[]; name: string }): readonly string[] {
  const values: string[] = [];
  for (const [index, token] of rest.entries()) {
    if (token === name) {
      const value = rest[index + 1];
      if (value !== undefined && !value.startsWith("-")) {
        values.push(value);
      }
      continue;
    }
    if (token.startsWith(`${name}=`)) {
      values.push(token.slice(name.length + 1));
    }
  }
  return values;
}

/**
 * The argv tail with every occurrence of a repeatable flag and its value removed, so the remainder can go
 * through the ordinary single-value parser without it complaining about a duplicate.
 *
 * @param rest the raw argv tail
 * @param name the flag, including its leading dashes
 * @returns the tail with that flag stripped
 */
export function withoutRepeated({ rest, name }: { rest: readonly string[]; name: string }): readonly string[] {
  const kept: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === undefined) {
      continue;
    }
    if (token === name) {
      const value = rest[index + 1];
      if (value !== undefined && !value.startsWith("-")) {
        index += 1;
      }
      continue;
    }
    if (token.startsWith(`${name}=`)) {
      continue;
    }
    kept.push(token);
  }
  return kept;
}

/**
 * Read one positive-integer flag off a {@link parseFlags} bag, accumulating a problem rather than throwing.
 *
 * The accumulating shape is what distinguishes it from {@link parsePositiveInteger}, which answers a
 * `Result` per value: a verb parser reporting EVERY usage problem at once has to keep going past the first
 * bad one, so this appends to `problems` and answers the fallback. Shared because two verb parsers held a
 * byte-identical copy of it and the clone gate caught the second the day it was written
 * (`src/cli/commands/github/reviewStateCore.ts` and `./commands/github/landingCore.ts`).
 *
 * @param values the parsed flag bag
 * @param name the flag's name, without the `--`
 * @param fallback what to answer when the flag is absent, or present and invalid
 * @param problems the list this appends a usage problem to
 * @returns the parsed integer, or the fallback
 */
export function positiveIntFlag({
  values,
  name,
  fallback,
  problems,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
  fallback: number;
  problems: string[];
}): number {
  const raw = values[name];
  if (raw === undefined) {
    return fallback;
  }
  const parsed = typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    problems.push(`--${name} must be a positive whole number`);
    return fallback;
  }
  return parsed;
}

/**
 * Read one string flag off a {@link parseFlags} bag as a non-negative whole number — zero included, which is
 * what separates it from {@link positiveIntFlag} and {@link parsePositiveInteger}. Absence is carried as an
 * explicit `undefined` value for the verb to name, and a present value that is negative, fractional or not a
 * number at all is refused with one line quoting what was passed. The `cmux` and `session` nouns read every
 * count and duration flag through this, through their own `numberFlag` wrappers.
 *
 * @param values the parsed flag bag
 * @param name the flag's name, without the `--`
 * @returns the parsed number, `undefined` when the flag was not passed, or the error text refusing its value
 */
export function nonNegativeIntegerFlag({
  values,
  name,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
}): { readonly value: number | undefined } | { readonly error: string } {
  const raw = values[name];
  if (typeof raw !== "string") {
    return { value: undefined };
  }
  const parsedNumber = Number(raw);
  if (!Number.isInteger(parsedNumber) || parsedNumber < 0) {
    return { error: `--${name} must be a non-negative whole number, got ${JSON.stringify(raw)}` };
  }
  return { value: parsedNumber };
}

/**
 * A comma-separated repeatable flag, as a trimmed list with empties dropped.
 *
 * Shared for the same reason {@link positiveIntFlag} is, and measured the same way: three verb parsers held
 * a byte-identical copy of this and the clone gate named all three pairs at once (reproduce with
 * `slopweaver dev lint --only duplicate-windows`). The fallback is answered for an ABSENT flag and for one
 * whose value was entirely separators, because `--repo ",,"` names no repository and neither does silence.
 *
 * @param values the parsed flag bag
 * @param name the flag's name, without the `--`
 * @param fallback what to answer when the flag is absent, or names nothing
 * @returns the named entries, or the fallback
 */
export function commaListFlag({
  values,
  name,
  fallback,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
  fallback: readonly string[];
}): readonly string[] {
  const raw = values[name];
  if (typeof raw !== "string") {
    return fallback;
  }
  const parts = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  return parts.length === 0 ? fallback : parts;
}

/**
 * The state home a verb should read, given whatever `--home` carried.
 *
 * Written as an early return rather than `named ?? slopweaverHome()` because the substitution is the kind
 * `no-silent-fallback` exists to make audible: an operator who mistypes `--home` gets the REAL home, and the
 * absent case is named where it is decided. The early-return SHAPE is load-bearing, not a style choice —
 * oxlint's `prefer-nullish-coalescing` fires on the reassignment spelling of the same idea
 * (`let home = …; if (home === undefined) { home = … }`), so a `let` here would trade one gate's refusal for
 * another's. Measured on run 35521660124, job `lint`, annotation `run.ts:171`.
 *
 * @param named whatever `--home` carried
 * @returns the named home, or the resolved one
 */
export function resolveHome({ named }: { named: string | undefined }): string {
  if (named === undefined) {
    return slopweaverHome();
  }
  return named;
}
