/**
 * What `slopweaver talk recent` ACCEPTS — its flag spec, usage and pure parser. A file of its own for the reason
 * `./knowArgs.ts` gives: `./args.ts` already holds six verbs' worth.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { CONTINUITY_LOOKBACK_MS, MAX_RECENT_HOURS } from "../../../talk/continuity.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flagNames, numberOf, stringOf } from "./flagValues.js";

/** The flags `talk recent` accepts. */
const RECENT_FLAGS = { boolean: ["json"], string: ["hours", "dir", "home", "now"] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_RECENT_FLAG_NAMES: readonly string[] = flagNames({ spec: RECENT_FLAGS });

/** The default window, in hours — the same three days a call reads at mint. */
const DEFAULT_RECENT_HOURS = CONTINUITY_LOOKBACK_MS / (60 * 60 * 1000);

/** A parsed `talk recent` invocation. */
export interface RecentArgs {
  readonly hours: number;
  readonly dir: string | undefined;
  readonly home: string | undefined;
  readonly now: string | undefined;
  readonly json: boolean;
}

/**
 * Parse a `talk recent` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseRecentArgs({ rest }: { rest: readonly string[] }): Result<RecentArgs> {
  const parsed = parseFlags({ args: rest, spec: RECENT_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const hours = numberOf({ fallback: DEFAULT_RECENT_HOURS, name: "--hours", problems, value: values["hours"] });
  if (hours <= 0 || hours > MAX_RECENT_HOURS) {
    problems.push(`talk recent --hours is above 0 and at most ${String(MAX_RECENT_HOURS)}`);
  }
  const now = stringOf({ value: values["now"] });
  if (now !== undefined && Number.isNaN(Date.parse(now))) {
    problems.push(`talk recent --now ${now} is not an ISO instant`);
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({
    dir: stringOf({ value: values["dir"] }),
    home: stringOf({ value: values["home"] }),
    hours,
    json: values["json"] === true,
    now,
  });
}
