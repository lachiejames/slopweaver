/**
 * The `session` noun's flag specs, usage string and shared resolution — mirrors `../fleet/core.ts` and
 * `../cmux/core.ts`, the two sibling nouns this one composes with.
 */
import { nonNegativeIntegerFlag } from "../../optionParsers.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
export const VERB_ARG_OFFSET = 4;

/** Flags every `session` verb accepts, plus each verb's own. */
const SPECS = {
  "reach-grant": { boolean: [], string: ["home", "reason", "tool"] },
  close: { boolean: [], string: ["home", "workspace"] },
  compaction: {
    boolean: ["alert", "check", "json"],
    string: ["days", "home", "projects-dir", "record-reading", "tolerance", "windows"],
  },
  "close-done": { boolean: ["dry-run", "json", "keep-worktrees"], string: ["dir", "home"] },
  depth: { boolean: ["json"], string: ["home", "loop-session-key", "threshold"] },
  fallbacks: { boolean: ["json"], string: [] },
  list: { boolean: ["json"], string: ["home"] },
  record: { boolean: [], string: ["home", "note"] },
  respawn: { boolean: ["confirm", "dry-run", "force"], string: ["home", "successor"] },
  spend: {
    boolean: ["finding", "json"],
    string: ["days", "home", "min-share", "projects-dir", "record-reading", "repos", "tolerance"],
  },
  "re-seat": { boolean: ["dry-run", "json"], string: ["home", "timeout-seconds"] },
  standing: { boolean: ["json"], string: ["home", "loop-session-key"] },
  watch: {
    boolean: ["follow", "include-stale", "json", "json-report", "reset-state"],
    string: ["home", "idle-minutes", "record-reading", "since"],
  },
} satisfies Readonly<Record<string, FlagSpec>>;

/** A `session` verb the noun declares a flag spec for — a closed set, so a spec or usage read for one always hits. */
export type SessionVerb = keyof typeof SPECS;

/** One spec's `--`-prefixed flag names, sorted. */
function flagNamesOf({ spec }: { spec: FlagSpec }): readonly string[] {
  return [...stringFlagsOf({ spec }), ...booleanFlagsOf({ spec })].map((name) => `--${name}`).toSorted();
}

/** `--`-prefixed flag names per verb, for the help-truth ratchet. */
export const SESSION_FLAG_NAMES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(SPECS).map(([verb, spec]) => [verb, flagNamesOf({ spec })]),
);

/** The flags that take a value, so a usage line can render `[--x <value>]` for exactly those. */
const WITH_VALUE: ReadonlySet<string> = new Set([
  "--days",
  "--dir",
  "--home",
  "--idle-minutes",
  "--loop-session-key",
  "--min-share",
  "--note",
  "--projects-dir",
  "--record-reading",
  "--reason",
  "--repos",
  "--since",
  "--successor",
  "--tool",
  "--threshold",
  "--timeout-seconds",
  "--tolerance",
  "--windows",
  "--workspace",
]);

/** What each verb's positional tail is called in its usage line. */
const POSITIONALS: Readonly<Record<string, string>> = {
  close: "<session-key>",
  record: "<session-key>",
  respawn: "loop",
};

/**
 * The usage line for one verb, built from its REAL flag spec.
 *
 * @param verb the verb name
 * @returns the usage line
 */
export function sessionUsage({ verb }: { verb: SessionVerb }): string {
  const rendered = flagNamesOf({ spec: SPECS[verb] })
    .map((flag) => (WITH_VALUE.has(flag) ? `[${flag} <value>]` : `[${flag}]`))
    .join(" ");
  const tail = POSITIONALS[verb];
  const parts = ["usage: slopweaver session", verb, ...(tail === undefined ? [] : [tail]), rendered];
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Parse one session verb's flags.
 *
 * @param verb which verb's spec to use
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, or the errors
 */
export function parseSessionArgs({
  verb,
  rest,
}: {
  verb: SessionVerb;
  rest: readonly string[];
}): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: SPECS[verb] });
}

/**
 * One declared string flag, or `undefined`.
 *
 * @param parsed the verb's parsed flags
 * @param name the flag's name, without the leading `--`
 * @returns the value, or `undefined` when the flag was not passed
 */
export function stringFlag({ parsed, name }: { parsed: ParsedFlags; name: string }): string | undefined {
  const value = parsed.values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * One declared boolean flag. Absent reads as `false`, never as a reason to guess.
 *
 * @param parsed the verb's parsed flags
 * @param name the flag's name, without the leading `--`
 * @returns true only when the switch was actually passed
 */
export function boolFlag({ parsed, name }: { parsed: ParsedFlags; name: string }): boolean {
  return parsed.values[name] === true;
}

/**
 * One declared string flag parsed as a non-negative integer, or `undefined` — the CLI's one
 * `nonNegativeIntegerFlag`, read off this verb's parsed flags.
 *
 * @param parsed the verb's parsed flags
 * @param name the flag's name, without the leading `--`
 * @returns the parsed number, `undefined` when absent, or the error text when it is not a whole number
 */
export function numberFlag({
  parsed,
  name,
}: {
  parsed: ParsedFlags;
  name: string;
}): ReturnType<typeof nonNegativeIntegerFlag> {
  return nonNegativeIntegerFlag({ name, values: parsed.values });
}

/**
 * One declared string flag parsed as a non-negative integer, or the verb's documented default when the caller
 * did not pass it.
 *
 * {@link numberFlag}'s twin for a flag with a stated default: `fallback` NAMES the substitution at the call site,
 * where a `?? DEFAULT` would read as "use this instead". A value that is not a whole number is still refused,
 * with {@link numberFlag}'s own error, rather than quietly becoming the default.
 *
 * @param parsed the verb's parsed flags
 * @param name the flag's name, without the leading `--`
 * @param fallback the documented default for an unpassed flag
 * @returns the parsed number or the fallback, or the error text when it is not a whole number
 */
export function numberFlagOr({
  parsed,
  name,
  fallback,
}: {
  parsed: ParsedFlags;
  name: string;
  fallback: number;
}): { readonly value: number } | { readonly error: string } {
  const read = numberFlag({ name, parsed });
  if ("error" in read) {
    return read;
  }
  if (read.value === undefined) {
    return { value: fallback };
  }
  return { value: read.value };
}
