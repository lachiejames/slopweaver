/**
 * What every `slopweaver ruling` verb shares: the flag specs its usage lines advertise, the parse, the seams the
 * shell composes, the exit code a refusal earns, and how one ruling prints.
 */
import type { Logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { PagePublisher } from "../../../pages/publish.js";
import type { RulingError } from "../../../ruling/errors.js";
import type { RulingProjection, RulingRecord } from "../../../ruling/registry.js";
import { readRulings } from "../../../ruling/store.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagTailSpec, type ParsedFlagTail, parseFlagTail } from "../../optionParsers.js";
import { repeatedFlagValues } from "../../parseFlags.js";
import { RULING_LIST_USAGE, RULING_RECORD_USAGE, RULING_SEED_USAGE, RULING_VIEW_USAGE } from "./rulingUsage.js";

/** Each verb's flags, as its usage line advertises them. */
export const RULING_FLAG_SPECS = {
  list: { boolean: ["all", "json"], value: ["category", "home"] },
  record: {
    boolean: ["alongside", "new-category", "json"],
    repeatable: ["replaces"],
    value: ["category", "words", "decided-on", "anchor", "context", "replaces", "home"],
  },
  seed: { boolean: ["plan", "apply"], repeatable: ["from"], value: ["from", "decisions", "home"] },
  view: { boolean: [], value: ["home"] },
} as const satisfies Readonly<Record<string, FlagTailSpec>>;

/** A verb this noun has. */
type RulingVerb = keyof typeof RULING_FLAG_SPECS;

/** Each verb's usage line, which also says which verbs exist. */
export const RULING_USAGE: Readonly<Record<RulingVerb, string>> = {
  list: RULING_LIST_USAGE,
  record: RULING_RECORD_USAGE,
  seed: RULING_SEED_USAGE,
  view: RULING_VIEW_USAGE,
};

/**
 * Whether a word is one of this noun's verbs.
 *
 * @param value the word after `ruling`, when there is one
 * @returns true for `list`, `record`, `seed` and `view`
 */
export function isRulingVerb(value: string | undefined): value is RulingVerb {
  return value !== undefined && Object.hasOwn(RULING_FLAG_SPECS, value);
}

/** One verb's parsed flags, plus the repeatable lists read off the raw tail. */
export interface RulingArgs {
  readonly verb: RulingVerb;
  readonly parsed: ParsedFlagTail;
  readonly replaces: readonly string[];
  readonly from: readonly string[];
}

/**
 * Parse one verb's flags.
 *
 * @param verb the verb word, refused when it is not one of this noun's
 * @param rest the words after `ruling <verb>`
 * @returns the parsed flags, or every problem with them
 */
export function parseRulingArgs({
  verb,
  rest,
}: {
  verb: string | undefined;
  rest: readonly string[];
}): Result<RulingArgs> {
  if (!isRulingVerb(verb)) {
    return err([`unknown ruling verb ${String(verb)}`, ...Object.values(RULING_USAGE)]);
  }
  const parsed = parseFlagTail({ rest, spec: RULING_FLAG_SPECS[verb] });
  if (parsed.isErr()) {
    return err([...parsed.error, RULING_USAGE[verb]]);
  }
  return ok({
    from: repeatedFlagValues({ name: "from", rest }),
    parsed: parsed.value,
    replaces: repeatedFlagValues({ name: "replaces", rest }),
    verb,
  });
}

/** The seams the shell composes — real home, clock, ids and store in production, plain fakes in a test. */
export interface RulingDeps {
  readonly home: () => string;
  readonly nowIso: () => string;
  /** A fresh `ruling-` id for a recorded ruling. */
  readonly newId: () => string;
  readonly publish: PagePublisher;
  readonly logger: Pick<Logger, "out" | "error">;
}

/** The exit code a refusal earns: a read or write that failed is an error, a refused input is usage. */
function exitFor({ error }: { error: RulingError }): number {
  switch (error.code) {
    case "REGISTER_UNREADABLE":
    case "REGISTER_MALFORMED":
    case "SOURCE_UNREADABLE":
    case "LOCK_UNAVAILABLE":
    case "APPEND_FAILED":
    case "PAGE_TOO_LARGE":
      return EXIT_ERROR;
    case "CATEGORY_EXISTS":
    case "CATEGORY_INVALID":
    case "CATEGORY_UNKNOWN":
    case "DATE_INVALID":
    case "REPLACES_NOT_CURRENT":
    case "SEED_DECISIONS_INVALID":
    case "UNDISPOSED":
    case "WORDS_EMPTY":
      return EXIT_USAGE;
    default: {
      const unhandled: never = error;
      return unhandled;
    }
  }
}

/**
 * Report a refusal on stderr and say what it exits with.
 *
 * @param error the refusal
 * @param deps where the line goes
 * @returns the exit code the refusal earns
 */
export function reportRefusal({ error, deps }: { error: RulingError; deps: RulingDeps }): number {
  deps.logger.error({ msg: `ruling: ${error.message}` });
  return exitFor({ error });
}

/**
 * Print one ruling: its id, category, date and anchor, then its words, indented.
 *
 * @param record the ruling
 * @param projection the register it sits in, which says whether it was replaced
 */
export function printRuling({
  record,
  projection,
  deps,
}: {
  record: RulingRecord;
  projection: RulingProjection;
  deps: RulingDeps;
}): void {
  const anchor = record.anchor === undefined ? "" : ` · ${record.anchor}`;
  const context = record.context === undefined ? "" : ` · ${record.context}`;
  const replacer = projection.replacedBy.get(record.id);
  const status = replacer === undefined ? "" : ` · REPLACED by ${replacer}`;
  deps.logger.out({
    line: `${record.id} · ${record.category} · decided ${record.decidedOn}${anchor}${context}${status}`,
  });
  for (const line of record.words.split("\n")) {
    deps.logger.out({ line: `    ${line}` });
  }
}

/**
 * The register, or the exit code after reporting why it cannot be read.
 *
 * @param file the register's path
 * @returns the projection, or the exit code of the refusal already reported
 */
export function loadRegister({ file, deps }: { file: string; deps: RulingDeps }): RulingProjection | number {
  const read = readRulings({ file });
  if (read.isErr()) {
    return reportRefusal({ deps, error: read.error });
  }
  return read.value;
}
