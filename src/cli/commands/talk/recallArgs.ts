/**
 * What `slopweaver talk recall` ACCEPTS: its flag spec and the pure parser. Two rungs, one verb — `--words` searches,
 * `--open` opens one pointer a search printed — and exactly one of them per invocation.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { RECALL_MAX_BYTES, RECALL_MIN_BYTES, RECALL_SOURCES, type RecallSource } from "../../../talk/recall.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flagNames, numberOf, stringOf } from "./flagValues.js";
import { MAX_WORDS_CHARS } from "./knowArgs.js";

/** The flags `talk recall` accepts. */
const RECALL_FLAGS = {
  boolean: ["json"],
  string: ["words", "days", "source", "open", "from", "max-bytes", "home", "now"],
} satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_RECALL_FLAG_NAMES: readonly string[] = flagNames({ spec: RECALL_FLAGS });

/** The widest `--days` window; past it, all time is the honest ask and is what leaving `--days` off gives. */
const MAX_RECALL_DAYS = 3650;

/** The longest pointer `--open` accepts; a minted one is well under it. */
const MAX_POINTER_CHARS = 400;

/** A parsed `talk recall --words` invocation. */
export interface RecallSearchArgs {
  readonly mode: "search";
  readonly words: string;
  /** The window in days, or `undefined` for all time. */
  readonly days: number | undefined;
  /** The one source to search, or `undefined` for every source. */
  readonly source: RecallSource | undefined;
  readonly maxBytes: number;
  readonly home: string | undefined;
  readonly now: string | undefined;
  readonly json: boolean;
}

/** A parsed `talk recall --open` invocation. */
export interface RecallOpenArgs {
  readonly mode: "open";
  readonly pointer: string;
  readonly from: number;
  readonly maxBytes: number;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** Whether a flag value names one of the sources. */
function isRecallSource(value: string): value is RecallSource {
  return RECALL_SOURCES.some((source) => source === value);
}

/**
 * Parse a `talk recall` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments for one rung, or every usage problem found
 */
export function parseRecallArgs({ rest }: { rest: readonly string[] }): Result<RecallSearchArgs | RecallOpenArgs> {
  const parsed = parseFlags({ args: rest, spec: RECALL_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const words = stringOf({ value: values["words"] });
  const pointer = stringOf({ value: values["open"] });
  const problems: string[] = [];
  const maxBytes = numberOf({ fallback: RECALL_MAX_BYTES, name: "--max-bytes", problems, value: values["max-bytes"] });
  if (maxBytes < RECALL_MIN_BYTES || maxBytes > RECALL_MAX_BYTES) {
    problems.push(
      `talk recall --max-bytes is ${String(RECALL_MIN_BYTES)} to ${String(RECALL_MAX_BYTES)}: the answer's fixed fields need the floor, the console's tool cap sets the ceiling`,
    );
  }
  const home = stringOf({ value: values["home"] });
  const json = values["json"] === true;
  if ((words === undefined) === (pointer === undefined)) {
    problems.push("talk recall needs exactly one of --words <words> (search) or --open <pointer> (open one hit)");
    return err(problems);
  }
  if (pointer !== undefined) {
    return openArgs({ home, json, maxBytes, pointer, problems, values });
  }
  return searchArgs({ home, json, maxBytes, problems, values, words: words! });
}

/** The flags as `parseFlags` returns them. */
type FlagValues = Readonly<Record<string, string | boolean | undefined>>;

/** The search rung's own flags, over what both rungs share. */
function searchArgs({
  words,
  values,
  problems,
  maxBytes,
  home,
  json,
}: {
  words: string;
  values: FlagValues;
  problems: string[];
  maxBytes: number;
  home: string | undefined;
  json: boolean;
}): Result<RecallSearchArgs> {
  if (words.length > MAX_WORDS_CHARS) {
    problems.push(`talk recall --words is at most ${String(MAX_WORDS_CHARS)} characters: ask in a sentence`);
  }
  if (values["from"] !== undefined) {
    problems.push("talk recall --from pages an --open, not a search");
  }
  let days: number | undefined;
  if (values["days"] !== undefined) {
    days = numberOf({ fallback: 0, name: "--days", problems, value: values["days"] });
    if (days < 1 || days > MAX_RECALL_DAYS) {
      problems.push(`talk recall --days is 1 to ${String(MAX_RECALL_DAYS)}; leave it off to search all time`);
    }
  }
  const sourceText = stringOf({ value: values["source"] });
  let source: RecallSource | undefined;
  if (sourceText !== undefined) {
    if (isRecallSource(sourceText)) {
      source = sourceText;
    } else {
      problems.push(`talk recall --source is one of ${RECALL_SOURCES.join(", ")}, got ${sourceText}`);
    }
  }
  const now = stringOf({ value: values["now"] });
  if (now !== undefined && Number.isNaN(Date.parse(now))) {
    problems.push(`talk recall --now ${now} is not an ISO instant`);
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({ days, home, json, maxBytes, mode: "search", now, source, words });
}

/** The open rung's own flags, over what both rungs share. */
function openArgs({
  pointer,
  values,
  problems,
  maxBytes,
  home,
  json,
}: {
  pointer: string;
  values: FlagValues;
  problems: string[];
  maxBytes: number;
  home: string | undefined;
  json: boolean;
}): Result<RecallOpenArgs> {
  if (pointer.length > MAX_POINTER_CHARS) {
    problems.push(
      `talk recall --open takes a pointer a search printed, at most ${String(MAX_POINTER_CHARS)} characters`,
    );
  }
  for (const flag of ["days", "source", "now"]) {
    if (values[flag] !== undefined) {
      problems.push(`talk recall --${flag} narrows a search, not an --open`);
    }
  }
  const from = numberOf({ fallback: 0, name: "--from", problems, value: values["from"] });
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({ from, home, json, maxBytes, mode: "open", pointer });
}
