/**
 * Every `talk log` invocation, parsed — split from `./args.ts` for the reason `./courierArgs.ts` is: one verb's flag
 * spec and parser beside each other, which the help-truth ratchet compares against the printed usage.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flagNames, numberOf, stringOf } from "./flagValues.js";

/** The flags `talk log` accepts. */
const LOG_FLAGS = {
  boolean: ["json"],
  string: ["limit", "home", "about-prefix", "turn"],
} satisfies FlagSpec;

/** A relay turn's id, as `--turn` names one: the console mints a UUID per relay. */
const LOG_TURN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_LOG_FLAG_NAMES: readonly string[] = flagNames({ spec: LOG_FLAGS });

/** The default number of receipts `talk log` prints. */
export const DEFAULT_LOG_LIMIT = 20;

/** A parsed `talk log` invocation. */
export interface LogArgs {
  readonly limit: number;
  /**
   * Keep every receipt whose record key opens with this, unbounded — the Alignment page's read of which of its
   * questions the owner has answered. `undefined` reads the most recent {@link LogArgs.limit}.
   */
  readonly aboutPrefix: string | undefined;
  /**
   * Read this one turn as it stands now, its delivery and the chair's receipt included — what became of one relay,
   * read exactly. `undefined` reads receipts.
   */
  readonly turn: string | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse a `talk log` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseLogArgs({ rest }: { rest: readonly string[] }): Result<LogArgs> {
  const parsed = parseFlags({ args: rest, spec: LOG_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const limit = numberOf({ fallback: DEFAULT_LOG_LIMIT, name: "--limit", problems, value: values["limit"] });
  const aboutPrefix = stringOf({ value: values["about-prefix"] });
  if (aboutPrefix !== undefined && values["limit"] !== undefined) {
    problems.push("--about-prefix keeps every matching receipt, so it takes no --limit");
  }
  if (aboutPrefix?.trim() === "") {
    problems.push("--about-prefix wants a record-key prefix such as align:");
  }
  const turn = stringOf({ value: values["turn"] });
  if (turn !== undefined && (aboutPrefix !== undefined || values["limit"] !== undefined)) {
    problems.push("--turn reads one turn, so it takes no --limit or --about-prefix");
  }
  if (turn !== undefined && !LOG_TURN_ID.test(turn)) {
    problems.push("--turn wants a relay turn's UUID");
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({ aboutPrefix, home: stringOf({ value: values["home"] }), json: values["json"] === true, limit, turn });
}
