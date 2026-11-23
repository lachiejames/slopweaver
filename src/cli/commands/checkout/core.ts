/**
 * The `checkout` noun's flag specs, usage strings and shared resolution.
 *
 * The specs are exported so the help-truth ratchet compares the manifest's literal usage lines against the
 * REAL parser rather than against a copy of them — see `cmux/core.ts` for the sibling this mirrors.
 */
import type { MainCheckoutConfig } from "../../../checkouts/inspect.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
export const VERB_ARG_OFFSET = 4;

/**
 * Flags each verb accepts.
 *
 * `--fetch` is opt-in on `status` and unconditional on `sync`, and that asymmetry is the point: `doctor`
 * runs `status`'s reader at every session start, so the free version must stay free. A comparison made
 * without fetching is still worth printing — it just says how old its own refs are, which
 * `renderCheckoutFreshness` does on every line.
 */
const SPECS: Readonly<Record<string, FlagSpec>> = {
  console: { boolean: ["json"], string: [] },
  status: { boolean: ["fetch", "json"], string: ["home", "path"] },
  sync: { boolean: ["dry-run"], string: ["home", "path"] },
};

/** `--`-prefixed flag names per verb, for the help-truth ratchet. */
export const CHECKOUT_FLAG_NAMES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(SPECS).map(([verb, spec]) => [
    verb,
    [...stringFlagsOf({ spec }), ...booleanFlagsOf({ spec })].map((name) => `--${name}`).toSorted(),
  ]),
);

/** A verb's declared flag names; a verb with no spec entry declares none, so its usage line names none. */
function declaredFlagNames({ verb }: { verb: string }): readonly string[] {
  const names = CHECKOUT_FLAG_NAMES[verb];
  if (names === undefined) {
    return [];
  }
  return names;
}

/** The spec a verb parses with; a verb with no entry accepts no flags, so any flag it is given is refused. */
function verbSpec({ verb }: { verb: string }): FlagSpec {
  const spec = SPECS[verb];
  if (spec === undefined) {
    return { string: [] };
  }
  return spec;
}

/** The flags that take a value, so a usage line renders `[--x <value>]` for exactly those. */
const WITH_VALUE: ReadonlySet<string> = new Set(["--home", "--path"]);

/**
 * The usage line for one verb, built from its REAL flag spec.
 *
 * @param verb the verb name
 * @returns the usage line
 */
export function checkoutUsage({ verb }: { verb: string }): string {
  const rendered = declaredFlagNames({ verb })
    .map((flag) => (WITH_VALUE.has(flag) ? `[${flag} <value>]` : `[${flag}]`))
    .join(" ");
  return `usage: slopweaver checkout ${verb} ${rendered}`.replace(/\s+/g, " ").trim();
}

/**
 * Parse one checkout verb's flags.
 *
 * @param verb which verb's spec to use
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, or the errors
 */
export function parseCheckoutArgs({
  verb,
  rest,
}: {
  verb: string;
  rest: readonly string[];
}): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: verbSpec({ verb }) });
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
 * Narrow the declared checkouts to the one `--path` names, or keep them all.
 *
 * An unmatched `--path` yields an EMPTY list rather than silently falling back to every checkout: acting on
 * a different target than the one asked for is worse than doing nothing, and the caller reports the miss.
 *
 * @param configs every declared main checkout
 * @param path the `--path` value, or undefined when the flag was not passed
 * @returns the checkouts to act on
 */
export function selectCheckouts({
  configs,
  path,
}: {
  configs: readonly MainCheckoutConfig[];
  path: string | undefined;
}): readonly MainCheckoutConfig[] {
  return path === undefined ? configs : configs.filter((config) => config.path === path);
}
