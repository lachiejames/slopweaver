/**
 * The one flag parser, built on Node's built-in `node:util` `parseArgs` — so verbs never hand-roll
 * `rest.indexOf('--x')` / `startsWith('--')` loops again. It runs `parseArgs` in non-strict mode (so it
 * never throws) and folds the result into this repo's `Result` + error-list style:
 *   - an unknown flag → `unknown flag: --x`
 *   - a value flag given with no value → `--x requires a value`
 *   - a stray positional when positionals aren't allowed → `unexpected argument: x`
 *   - a value flag given twice → `--x was given more than once …`, unless the spec declares it `repeatable`
 * When positionals ARE allowed (the query verbs' free-text tail), they're returned for the caller to join.
 *
 * Pure: no I/O. `parseArgs` is called positionally because that is the stdlib's own signature — an imported
 * parameter list is not the named-object rule's subject. The logger is NOT an example of the same thing any
 * more: it takes `{ msg }` now. Everything here otherwise follows the house style.
 */
import { parseArgs } from "node:util";

import { err, ok, type Result } from "../lib/result.js";

/** Which flags take a value (`--home x`) vs are boolean switches (`--json`). Names omit the `--`. */
export interface FlagSpec {
  readonly string?: readonly string[];
  readonly boolean?: readonly string[];
  /**
   * The `string` flags whose repeats are a LIST the verb reads off the raw argv itself (`--term a --term b`).
   * Every other value flag given twice is refused; this parser's own value for a repeatable one is the last.
   */
  readonly repeatable?: readonly string[];
}

/**
 * The value-taking flags a spec declares, in declared order.
 *
 * {@link FlagSpec} declares both halves optional, so a spec with no value-taking flags simply omits the key.
 * That absence is named here, once, at a binding, rather than coalesced at every reader.
 *
 * @param spec the verb's declared flags
 * @returns the names without their `--`, empty when the spec declares none
 */
export function stringFlagsOf({ spec }: { spec: FlagSpec }): readonly string[] {
  const { string: names = [] } = spec;
  return names;
}

/**
 * The boolean switches a spec declares, in declared order — {@link stringFlagsOf}'s other half, for the same reason.
 *
 * @param spec the verb's declared flags
 * @returns the names without their `--`, empty when the spec declares none
 */
export function booleanFlagsOf({ spec }: { spec: FlagSpec }): readonly string[] {
  const { boolean: names = [] } = spec;
  return names;
}

/**
 * The value flags a spec lets repeat, {@link stringFlagsOf}'s list-reading subset, for the same reason.
 *
 * @param spec the verb's declared flags
 * @returns the names without their `--`, empty when the spec declares none
 */
function repeatableFlagsOf({ spec }: { spec: FlagSpec }): readonly string[] {
  const { repeatable: names = [] } = spec;
  return names;
}

/**
 * Every value a `repeatable` flag was given, read off the raw argv tail in order.
 *
 * The parser keeps one value per flag, so a verb whose input is a list (`--term a --term b`) declares the flag
 * `repeatable` in its spec and collects the list here. Both spellings the parser accepts are read — the spaced
 * `--x v` and the inline `--x=v` — because a value the parser saw and this list missed is one no check ever judged
 * (an inline `--example=` can slip past the scene check beside a valid gap).
 *
 * @param rest the verb's own argv tail
 * @param name which flag to collect, without its `--`
 * @returns every value that flag was given, in order
 */
export function repeatedFlagValues({ rest, name }: { rest: readonly string[]; name: string }): readonly string[] {
  const inline = `--${name}=`;
  const values: string[] = [];
  rest.forEach((token, index) => {
    const next = rest[index + 1];
    if (token.startsWith(inline)) {
      values.push(token.slice(inline.length));
    } else if (token === `--${name}` && next !== undefined && !next.startsWith("--")) {
      values.push(next);
    }
  });
  return values;
}

/** Parsed flags: declared values (string or boolean), plus any positionals (for a free-text tail). */
export interface ParsedFlags {
  readonly values: Readonly<Record<string, string | boolean>>;
  readonly positionals: readonly string[];
}

/** The raw tokenizer result — values + positionals + accumulated errors, WITHOUT short-circuiting. */
export interface FlagTokens extends ParsedFlags {
  readonly errors: readonly string[];
}

/** The `parseArgs` options map for a spec (each declared flag typed string/boolean). Pure. */
function flagOptions({
  stringKeys,
  boolKeys,
}: {
  stringKeys: ReadonlySet<string>;
  boolKeys: ReadonlySet<string>;
}): Record<string, { type: "string" | "boolean" }> {
  const options: Record<string, { type: "string" | "boolean" }> = {};
  for (const key of stringKeys) {
    options[key] = { type: "string" };
  }
  for (const key of boolKeys) {
    options[key] = { type: "boolean" };
  }
  return options;
}

/**
 * Classify one parsed `--flag value` entry: an unknown flag, a value-flag missing its value (parseArgs
 * yields `true`, or "ate" the next `--flag`), an absent value to skip, or an accepted value. Pure.
 *
 * @returns an `error` to accumulate, an `accepted` value to keep, or neither (skip)
 */
function classifyFlagEntry({
  key,
  value,
  stringKeys,
  boolKeys,
}: {
  key: string;
  value: string | boolean | undefined;
  stringKeys: ReadonlySet<string>;
  boolKeys: ReadonlySet<string>;
}): { readonly error?: string; readonly accepted?: string | boolean } {
  if (!stringKeys.has(key) && !boolKeys.has(key)) {
    return { error: `unknown flag: --${key}` };
  }
  if (value === undefined) {
    return {};
  }
  if (stringKeys.has(key) && (typeof value !== "string" || value.startsWith("--"))) {
    return { error: `--${key} requires a value` };
  }
  // A SWITCH given a value is refused rather than coerced, and this one was a live destructive bug rather
  // than a tidiness rule. `parseArgs` runs non-strict, so `--dry-run=true` arrives as the STRING "true";
  // every caller then tests `values["dry-run"] === true`, which is false for a string. So the most explicit
  // possible request for a preview — `--dry-run=true` — silently turned the preview OFF and performed the
  // real write. Measured on the github verb: `--dry-run=true` and even `--dry-run --dry-run=true` both
  // resolved to dryRun=false. Refusing here fixes it for every verb at once, because the coercion each
  // caller does is only safe once a non-boolean can never reach it.
  if (boolKeys.has(key) && typeof value !== "boolean") {
    return {
      error:
        `--${key} is a switch, not a value: write it on its own as \`--${key}\`. ` +
        `\`--${key}=${value}\` would be read as OFF, which is the opposite of what it looks like`,
    };
  }
  return { accepted: value };
}

/**
 * The refusal for every value flag written more than once that the spec does not declare repeatable. Pure.
 *
 * `parseArgs` without `multiple` keeps the LAST of a repeated value flag, so `--policy "" --policy p` read as
 * `p` and the empty value — a refusal on its own — vanished without a word. A verb that hand-patched this for
 * its own flags (`vanta vulnerability deactivate`) was the evidence that it held for every verb at once.
 * Booleans are exempt: `--json --json` asks for one thing twice, and nothing is lost.
 *
 * @param optionNames the name of every option token `parseArgs` saw, in argv order — both `--x v` and `--x=v`
 * @param stringKeys the declared value flags
 * @param repeatable the value flags whose repeats are a list the caller reads itself
 * @returns one refusal per repeated flag, in first-seen order
 */
function repeatedValueFlagErrors({
  optionNames,
  stringKeys,
  repeatable,
}: {
  optionNames: readonly string[];
  stringKeys: ReadonlySet<string>;
  repeatable: ReadonlySet<string>;
}): readonly string[] {
  const guarded = optionNames.filter((name) => stringKeys.has(name) && !repeatable.has(name));
  return [...new Set(guarded)].flatMap((name) => {
    const count = guarded.filter((each) => each === name).length;
    if (count < 2) {
      return [];
    }
    return [
      `--${name} was given ${String(count)} times — pass it once; the parser would keep only the last and drop the rest`,
    ];
  });
}

/**
 * Tokenise an argv tail against a flag spec, ACCUMULATING every rejection (never short-circuits, so a
 * caller can add its own value-validation errors to the same list). Never throws. A thin fold over the
 * pure {@link flagOptions} + {@link classifyFlagEntry}.
 *
 * @param args the argv tail (after the noun/verb)
 * @param spec the string + boolean flag names to accept
 * @param allowPositionals keep positionals (true, for a free-text tail) or reject them as errors (false)
 * @returns `{ values, positionals, errors }`
 */
export function tokenizeFlags({
  args,
  spec,
  allowPositionals = false,
}: {
  args: readonly string[];
  spec: FlagSpec;
  allowPositionals?: boolean;
}): FlagTokens {
  const stringKeys = new Set(stringFlagsOf({ spec }));
  const boolKeys = new Set(booleanFlagsOf({ spec }));

  // strict:false ⇒ unknown flags land in `values` (as `true`) and missing string values become `true`,
  // rather than throwing — we turn both into our own domain errors below.
  const parsed = parseArgs({
    allowPositionals: true,
    args: [...args],
    options: flagOptions({ boolKeys, stringKeys }),
    strict: false,
    tokens: true,
  });

  const errors: string[] = [
    ...repeatedValueFlagErrors({
      optionNames: parsed.tokens.flatMap((token) => (token.kind === "option" ? [token.name] : [])),
      repeatable: new Set(repeatableFlagsOf({ spec })),
      stringKeys,
    }),
  ];
  const values: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(parsed.values)) {
    const classified = classifyFlagEntry({ boolKeys, key, stringKeys, value });
    if (classified.error !== undefined) {
      errors.push(classified.error);
    } else if (classified.accepted !== undefined) {
      values[key] = classified.accepted;
    }
  }
  if (!allowPositionals) {
    for (const positional of parsed.positionals) {
      errors.push(`unexpected argument: ${positional}`);
    }
  }
  return { errors, positionals: parsed.positionals, values };
}

/**
 * Parse an argv tail against a flag spec, as a `Result`. The short-circuiting wrapper over
 * {@link tokenizeFlags} for verbs that reject on any bad flag.
 *
 * @param args the argv tail (after the noun/verb)
 * @param spec the string + boolean flag names to accept
 * @param allowPositionals keep positionals (true) or reject them as errors (false)
 * @returns the parsed `{ values, positionals }`, or an error listing every rejection
 */
export function parseFlags({
  args,
  spec,
  allowPositionals = false,
}: {
  args: readonly string[];
  spec: FlagSpec;
  allowPositionals?: boolean;
}): Result<ParsedFlags> {
  const { values, positionals, errors } = tokenizeFlags({ allowPositionals, args, spec });
  return errors.length > 0 ? err(errors) : ok({ positionals, values });
}

/**
 * One declared string flag's value, or the verb's documented default when the caller did not pass it.
 *
 * The {@link ParsedFlags} twin of `flagValueOr` in `optionParsers.ts`: `fallback` NAMES the substitution at the
 * call site, where a `??` would read as "use this instead" when the fact is "the flag was not passed". A string
 * flag passed with no value never reaches here — {@link parseFlags} has already refused it as
 * `--x requires a value`, which is the different error a present-but-wrong flag earns.
 *
 * @param parsed what {@link parseFlags} returned
 * @param name the flag name, without the `--`
 * @param fallback the documented default for an unpassed flag
 * @returns the passed value, or the fallback
 */
export function stringFlagOr({
  parsed,
  name,
  fallback,
}: {
  parsed: ParsedFlags;
  name: string;
  fallback: string;
}): string {
  const given = parsed.values[name];
  if (typeof given !== "string") {
    return fallback;
  }
  return given;
}
