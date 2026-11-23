/**
 * The `fleet` noun's flag specs, usage string and shared resolution.
 *
 * The specs are exported so the help-truth ratchet compares the manifest's literal usage lines against the REAL
 * parser rather than against a copy of them. Measured on this repo: a usage string that hid ten shipped flags
 * survived for weeks, and the ratchet is what caught it.
 *
 * `up` / `say` / `stop` / `reap` — the headless launcher and the levers built around it — are gone (AGENTS.md
 * rule 2). `status` reads the board; `health`, `resume` and `configure` are the restart recovery the desktop app
 * drives (`../../../fleet/`), and `resume` only ever relaunches seats in their own visible cmux workspaces.
 * `restore-policy` reads, and with `--apply` turns off, cmux's own relaunch of those seats, so `resume` is the one
 * path that brings them back.
 */

import { stateHomePaths } from "../../../stateHome.js";
import { resolveHome } from "../../optionParsers.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
export const VERB_ARG_OFFSET = 4;

/** Flags every fleet verb accepts — where the docs live and which home they live under. */
const COMMON: readonly string[] = ["dir", "home"];

/** Per-verb flag specs. */
const SPECS = {
  configure: { boolean: ["json"], string: ["capacity", "home"] },
  health: { boolean: ["json"], string: ["home"] },
  "restore-policy": { boolean: ["apply", "json"], string: ["config"] },
  resume: { boolean: ["json"], string: ["episode", "home", "reorient-seconds", "timeout-seconds"] },
  status: { boolean: ["json"], string: [...COMMON, "base"] },
} satisfies Readonly<Record<string, FlagSpec>>;

/** A fleet verb that declares a flag spec — every verb the noun dispatches to. */
export type FleetVerb = keyof typeof SPECS;

/** One spec's flag names, `--`-prefixed and sorted. */
function flagNamesOf({ spec }: { spec: FlagSpec }): readonly string[] {
  return [...stringFlagsOf({ spec }), ...booleanFlagsOf({ spec })].map((name) => `--${name}`).toSorted();
}

/** `--`-prefixed flag names per verb, for the help-truth ratchet. */
export const FLEET_FLAG_NAMES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(SPECS).map(([verb, spec]) => [verb, flagNamesOf({ spec })]),
);

/** The flags that take a value, so a usage line can render `[--x <value>]` for exactly those. */
const WITH_VALUE: ReadonlySet<string> = new Set([
  "--base",
  "--capacity",
  "--config",
  "--dir",
  "--episode",
  "--home",
  "--reorient-seconds",
  "--timeout-seconds",
]);

/** What each verb's positional tail is called in its usage line. A verb absent from this map renders no tail. */
const POSITIONALS: Readonly<Record<string, string>> = {
  status: "[<slug>…]",
};

/**
 * The usage line for one verb, built from its REAL flag spec.
 *
 * The manifest deliberately does NOT call this — it carries literals, so listing the verb surface never loads a
 * command module. This exists so the ratchet can compare those literals against the parser.
 *
 * @param verb the verb name
 * @returns the usage line
 */
export function fleetUsage({ verb }: { verb: FleetVerb }): string {
  const rendered = flagNamesOf({ spec: SPECS[verb] })
    .map((flag) => (WITH_VALUE.has(flag) ? `[${flag} <value>]` : `[${flag}]`))
    .join(" ");
  const tail = POSITIONALS[verb];
  const parts = ["usage: slopweaver fleet", verb, ...(tail === undefined ? [] : [tail]), rendered];
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Parse one fleet verb's flags.
 *
 * @param verb which verb's spec to use
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, or the errors
 */
export function parseFleetArgs({
  verb,
  rest,
}: {
  verb: FleetVerb;
  rest: readonly string[];
}): ReturnType<typeof parseFlags> {
  // Positionals ARE allowed: `status` addresses workstreams by slug. Without this the parser rejects the slug
  // as a stray argument and the whole noun is unreachable.
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

/** Where the docs and journals live for one invocation. */
export interface FleetPaths {
  readonly handoverDir: string;
  readonly runsDir: string;
}

/**
 * Resolve the doc and runs directories.
 *
 * @param parsed the verb's parsed flags
 * @returns the two directories `fleet status` reads
 */
export function fleetPaths({ parsed }: { parsed: ParsedFlags }): FleetPaths {
  const paths = stateHomePaths({ home: resolveHome({ named: stringFlag({ name: "home", parsed }) }) });
  return { handoverDir: handoverDirOf({ homeDocs: paths.handovers, parsed }), runsDir: paths.runs };
}

/** The doc directory `--dir` names, or the home's own handover directory when the flag is absent. */
function handoverDirOf({ parsed, homeDocs }: { parsed: ParsedFlags; homeDocs: string }): string {
  const named = stringFlag({ name: "dir", parsed });
  if (named === undefined) {
    return homeDocs;
  }
  return named;
}
