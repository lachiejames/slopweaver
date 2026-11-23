/**
 * Flag specs and the shared parse for the `workstreams` noun. Pure: no I/O, no clock.
 *
 * Kept apart from the verb modules so the help-truth ratchet can read a flag list without importing a command,
 * exactly as `../reading/core.ts` does.
 */
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

/** argv positions before a verb's own arguments: `node`, `index.js`, `workstreams`, `<verb>`. */
export const VERB_ARG_OFFSET = 4;

const LIST_FLAGS: FlagSpec = { boolean: ["json"], string: ["home"] };

const PUT_FLAGS: FlagSpec = { boolean: ["json"], string: ["file", "home"] };

const CANDIDATES_FLAGS: FlagSpec = { boolean: ["json", "ruled", "unruled"], string: ["home"] };

/** `onboard workstreams` reads the same document, whole: neither ruled half is its business. */
const ONBOARD_WORKSTREAMS_FLAGS: FlagSpec = { boolean: ["json"], string: ["home"] };

const CANDIDATES_PUT_FLAGS: FlagSpec = { boolean: ["json"], string: ["file", "home"] };

const REACT_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: [
    "anchor",
    "as",
    "by-session",
    "candidate",
    "covered-by",
    "heard",
    "home",
    "milestone-of",
    "outcome-of",
    "owner",
    "reason",
    "same-as",
    "steer",
    "superseded-by",
    "via",
  ],
};

const DEFINE_FLAGS: FlagSpec = {
  boolean: ["all", "json"],
  string: ["by-session", "candidate", "first", "home", "option", "stretch", "text", "via"],
};

const LOOP_IN_FLAGS: FlagSpec = { boolean: ["json"], string: ["candidate", "home", "person"] };

const RETITLE_FLAGS: FlagSpec = { boolean: ["json"], string: ["by-session", "candidate", "home", "title", "via"] };

const PROPOSE_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["anchor", "by-session", "from", "home", "relation", "title", "via", "why"],
};

const WHO_FIRST_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["by-session", "candidate", "home", "people", "team", "via"],
};

/** `--`-prefixed flags, for the help-truth ratchet. */
function names({ spec: { string: strings = [], boolean: booleans = [] } }: { spec: FlagSpec }): readonly string[] {
  return [...strings, ...booleans].map((name) => `--${name}`).toSorted();
}

export const WORKSTREAMS_LIST_FLAG_NAMES: readonly string[] = names({ spec: LIST_FLAGS });
export const WORKSTREAMS_PUT_FLAG_NAMES: readonly string[] = names({ spec: PUT_FLAGS });
export const WORKSTREAMS_CANDIDATES_FLAG_NAMES: readonly string[] = names({ spec: CANDIDATES_FLAGS });
export const ONBOARD_WORKSTREAMS_FLAG_NAMES: readonly string[] = names({ spec: ONBOARD_WORKSTREAMS_FLAGS });
export const WORKSTREAMS_CANDIDATES_PUT_FLAG_NAMES: readonly string[] = names({ spec: CANDIDATES_PUT_FLAGS });
export const WORKSTREAMS_REACT_FLAG_NAMES: readonly string[] = names({ spec: REACT_FLAGS });
export const WORKSTREAMS_DEFINE_FLAG_NAMES: readonly string[] = names({ spec: DEFINE_FLAGS });
export const WORKSTREAMS_LOOP_IN_FLAG_NAMES: readonly string[] = names({ spec: LOOP_IN_FLAGS });
export const WORKSTREAMS_RETITLE_FLAG_NAMES: readonly string[] = names({ spec: RETITLE_FLAGS });
export const WORKSTREAMS_PROPOSE_FLAG_NAMES: readonly string[] = names({ spec: PROPOSE_FLAGS });
export const WORKSTREAMS_WHO_FIRST_FLAG_NAMES: readonly string[] = names({ spec: WHO_FIRST_FLAGS });

/**
 * Parse `workstreams who-first`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseWorkstreamsWhoFirstArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: WHO_FIRST_FLAGS });
}

/**
 * Parse `workstreams retitle`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseWorkstreamsRetitleArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: RETITLE_FLAGS });
}

/**
 * Parse `workstreams propose`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseWorkstreamsProposeArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: PROPOSE_FLAGS });
}

/**
 * Parse `workstreams define`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseWorkstreamsDefineArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: DEFINE_FLAGS });
}

/**
 * Parse `workstreams loop-in`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseWorkstreamsLoopInArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: LOOP_IN_FLAGS });
}

/**
 * Parse `workstreams candidates`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseWorkstreamsCandidatesArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: CANDIDATES_FLAGS });
}

/**
 * Parse `onboard workstreams`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseOnboardWorkstreamsArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: ONBOARD_WORKSTREAMS_FLAGS });
}

/**
 * Parse `workstreams candidates-put`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseWorkstreamsCandidatesPutArgs({
  rest,
}: {
  rest: readonly string[];
}): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: CANDIDATES_PUT_FLAGS });
}

/**
 * Parse `workstreams react`'s flags; the positional tail is their words, joined by the verb.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags and the words, or the parser's refusals
 */
export function parseWorkstreamsReactArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: REACT_FLAGS });
}

/**
 * Parse `workstreams list`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseWorkstreamsListArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: LIST_FLAGS });
}

/**
 * Parse `workstreams put`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseWorkstreamsPutArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: PUT_FLAGS });
}

/**
 * A string flag's value, or undefined when it was not supplied.
 *
 * @param values the parsed flag values
 * @param name the flag, without its `--`
 * @returns the string, or `undefined`
 */
export function stringFlag({
  values,
  name,
}: {
  values: Readonly<Record<string, unknown>>;
  name: string;
}): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}
