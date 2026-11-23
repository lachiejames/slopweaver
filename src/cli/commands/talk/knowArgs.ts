/**
 * What the four `talk` verbs behind "the voice knows what the supervisor knows" ACCEPT — `glossary`, `origin`,
 * `knowledge` and `history` — their flag specs, usage blocks and pure parsers.
 *
 * A file of their own rather than more of `args.ts`, which already holds six verbs' worth; the help-truth
 * ratchet reads these specs exactly as it reads that file's.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { DEFAULT_KNOWLEDGE_LIMIT, KNOWLEDGE_MAX_BYTES, MAX_KNOWLEDGE_LIMIT } from "../../../talk/knowledge.js";
import { HISTORY_MAX_BYTES, MAX_HISTORY_HOURS } from "../../../talk/supervisorHistory.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flagNames, numberOf, stringOf } from "./flagValues.js";

/** The flags `talk glossary` accepts. */
const GLOSSARY_FLAGS = { boolean: ["json"], string: ["term"] } satisfies FlagSpec;

/** The flags `talk origin` accepts. */
const ORIGIN_FLAGS = { boolean: ["json"], string: ["slug", "dir", "home"] } satisfies FlagSpec;

/** The flags `talk knowledge` accepts. */
const KNOWLEDGE_FLAGS = { boolean: ["json"], string: ["query", "limit", "max-bytes"] } satisfies FlagSpec;

/** The flags `talk history` accepts. */
const HISTORY_FLAGS = { boolean: ["json"], string: ["phrase", "hours", "max-bytes", "home", "now"] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_GLOSSARY_FLAG_NAMES: readonly string[] = flagNames({ spec: GLOSSARY_FLAGS });
/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_ORIGIN_FLAG_NAMES: readonly string[] = flagNames({ spec: ORIGIN_FLAGS });
/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_KNOWLEDGE_FLAG_NAMES: readonly string[] = flagNames({ spec: KNOWLEDGE_FLAGS });
/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_HISTORY_FLAG_NAMES: readonly string[] = flagNames({ spec: HISTORY_FLAGS });

/** The default window `talk history` searches, in hours: the "last 24h". */
const DEFAULT_HISTORY_HOURS = 24;

/**
 * The longest search words a verb accepts, in characters. Each verb echoes its words back in its answer, so an
 * unbounded one would carry the answer past the console's tool cap on its own; a spoken question is a sentence.
 */
export const MAX_WORDS_CHARS = 500;

/** A parsed `talk glossary` invocation. */
export interface GlossaryArgs {
  readonly term: string | undefined;
  readonly json: boolean;
}

/** A parsed `talk origin` invocation. */
export interface OriginArgs {
  readonly slug: string;
  readonly dir: string | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** A parsed `talk knowledge` invocation. */
export interface KnowledgeArgs {
  readonly query: string;
  readonly limit: number;
  readonly maxBytes: number;
  readonly json: boolean;
}

/** A parsed `talk history` invocation. */
export interface HistoryArgs {
  readonly phrase: string;
  readonly hours: number;
  readonly maxBytes: number;
  readonly home: string | undefined;
  readonly now: string | undefined;
  readonly json: boolean;
}

/**
 * Parse a `talk glossary` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseGlossaryArgs({ rest }: { rest: readonly string[] }): Result<GlossaryArgs> {
  const parsed = parseFlags({ args: rest, spec: GLOSSARY_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const term = stringOf({ value: values["term"] });
  const problems: string[] = [];
  refuseLongWords({ flag: "--term", name: "talk glossary", problems, words: term });
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({ json: values["json"] === true, term });
}

/**
 * Parse a `talk origin` invocation. A queue card's `ask:<slug>` key is accepted as its slug.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseOriginArgs({ rest }: { rest: readonly string[] }): Result<OriginArgs> {
  const parsed = parseFlags({ args: rest, spec: ORIGIN_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const given = stringOf({ value: values["slug"] });
  const problems: string[] = [];
  if (given === undefined) {
    problems.push("talk origin needs --slug <board-slug>");
  }
  if (given === undefined || problems.length > 0) {
    return err(problems);
  }
  let slug = given;
  if (slug.startsWith("ask:")) {
    slug = slug.slice("ask:".length);
  }
  return ok({
    dir: stringOf({ value: values["dir"] }),
    home: stringOf({ value: values["home"] }),
    json: values["json"] === true,
    slug,
  });
}

/**
 * Parse a `talk knowledge` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseKnowledgeArgs({ rest }: { rest: readonly string[] }): Result<KnowledgeArgs> {
  const parsed = parseFlags({ args: rest, spec: KNOWLEDGE_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const query = stringOf({ value: values["query"] });
  const problems: string[] = [];
  refuseLongWords({ flag: "--query", name: "talk knowledge", problems, words: query });
  if (query === undefined) {
    problems.push("talk knowledge needs --query <words>");
  }
  const limit = numberOf({ fallback: DEFAULT_KNOWLEDGE_LIMIT, name: "--limit", problems, value: values["limit"] });
  if (limit < 1 || limit > MAX_KNOWLEDGE_LIMIT) {
    problems.push(`talk knowledge --limit is 1 to ${String(MAX_KNOWLEDGE_LIMIT)}`);
  }
  const maxBytes = numberOf({
    fallback: KNOWLEDGE_MAX_BYTES,
    name: "--max-bytes",
    problems,
    value: values["max-bytes"],
  });
  refuseOverCap({ maxBytes, name: "talk knowledge", problems, cap: KNOWLEDGE_MAX_BYTES });
  if (query === undefined || problems.length > 0) {
    return err(problems);
  }
  return ok({ json: values["json"] === true, limit, maxBytes, query });
}

/**
 * Parse a `talk history` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseHistoryArgs({ rest }: { rest: readonly string[] }): Result<HistoryArgs> {
  const parsed = parseFlags({ args: rest, spec: HISTORY_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const phrase = stringOf({ value: values["phrase"] });
  const problems: string[] = [];
  refuseLongWords({ flag: "--phrase", name: "talk history", problems, words: phrase });
  if (phrase === undefined) {
    problems.push("talk history needs --phrase <words>");
  }
  const hours = numberOf({ fallback: DEFAULT_HISTORY_HOURS, name: "--hours", problems, value: values["hours"] });
  if (hours <= 0 || hours > MAX_HISTORY_HOURS) {
    problems.push(
      `talk history --hours is above 0 and at most ${String(MAX_HISTORY_HOURS)}: the console's history window is the last day`,
    );
  }
  const maxBytes = numberOf({ fallback: HISTORY_MAX_BYTES, name: "--max-bytes", problems, value: values["max-bytes"] });
  refuseOverCap({ cap: HISTORY_MAX_BYTES, maxBytes, name: "talk history", problems });
  const now = stringOf({ value: values["now"] });
  if (now !== undefined && Number.isNaN(Date.parse(now))) {
    problems.push(`talk history --now ${now} is not an ISO instant`);
  }
  if (phrase === undefined || problems.length > 0) {
    return err(problems);
  }
  return ok({
    home: stringOf({ value: values["home"] }),
    hours,
    json: values["json"] === true,
    maxBytes,
    now,
    phrase,
  });
}

/**
 * A `--max-bytes` may only LOWER a verb's cap: the default is the ceiling that keeps the answer inside the
 * console's 24 KiB tool cap, so a larger value would be a cap a caller could lift.
 */
function refuseOverCap({
  maxBytes,
  cap,
  name,
  problems,
}: {
  maxBytes: number;
  cap: number;
  name: string;
  problems: string[];
}): void {
  if (maxBytes <= 0 || maxBytes > cap) {
    problems.push(
      `${name} --max-bytes is above 0 and at most ${String(cap)}: the answer must fit the console's tool cap`,
    );
  }
}

/** Refuse search words past {@link MAX_WORDS_CHARS}; absent words are the caller's own check. */
function refuseLongWords({
  words,
  flag,
  name,
  problems,
}: {
  words: string | undefined;
  flag: string;
  name: string;
  problems: string[];
}): void {
  if (words !== undefined && words.length > MAX_WORDS_CHARS) {
    problems.push(`${name} ${flag} is at most ${String(MAX_WORDS_CHARS)} characters: ask in a sentence`);
  }
}
