/** Pure argument handling for `slopweaver linear states`. */

import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";
import { type LinearVerbError, LinearVerbErrors } from "./errors.js";

/**
 * How many states and members one read requests.
 *
 * 100 rather than a smaller page, because this verb's whole job is to be COMPLETE: a team's states truncated
 * at 25 would silently omit the very id a caller is looking for, and the write gate would then refuse a
 * perfectly real state as unseen. No measured team is near this, and Linear prices the request on the size
 * of the nested connections rather than on how many it returns.
 */
const DEFAULT_LINEAR_STATES_LIMIT = 100;
const MAX_LINEAR_STATES_LIMIT = 250;

const STATES_FLAGS: FlagSpec = { boolean: ["json", "no-record"], string: ["home", "limit", "team"] };

/** Every accepted flag, derived from the exact spec passed to the parser. */
export const LINEAR_STATES_FLAG_NAMES: readonly string[] = ["--home", "--json", "--limit", "--no-record", "--team"];

/** A parsed, credential-free `linear states` invocation. */
export interface LinearStatesOptions {
  readonly teamKey: string;
  readonly home: string | undefined;
  readonly json: boolean;
  readonly limit: number;
  /** When true the read prints and records NOTHING, so an operator can look without moving the write gate. */
  readonly noRecord: boolean;
}

/**
 * The usage text for `slopweaver linear states`.
 *
 * @returns exact command help, including only flags its parser accepts
 */
export function linearStatesUsage(): string {
  return (
    "usage: slopweaver linear states --team <team-key> [--limit <1..250>] [--no-record] [--json] [--home <dir>]\n" +
    "  Reads one team's workflow states and assignable members live, and RECORDS what it saw so\n" +
    "  `linear issue` will accept a stateId from it — the write door refuses any state id it has not seen\n" +
    "  --team            the team's key as it appears in an issue identifier (the `ENG` in `ENG-42`)\n" +
    "  --limit           cap the states and members requested (default 100, maximum 250)\n" +
    "  --no-record       print the read without updating what the write door will accept\n" +
    "  --json            emit one machine-readable document\n" +
    "  --home            resolve the credential from this Slopweaver state home"
  );
}

/** Parse the page cap without allowing an accidental unbounded read. */
function linearStatesLimit({ value }: { value: string | boolean | undefined }): Result<number, LinearVerbError> {
  if (value === undefined) {
    return ok(DEFAULT_LINEAR_STATES_LIMIT);
  }
  const limit = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(limit) && limit > 0 && limit <= MAX_LINEAR_STATES_LIMIT
    ? ok(limit)
    : err(LinearVerbErrors.limitOutOfRange({ got: String(value), max: MAX_LINEAR_STATES_LIMIT }));
}

/**
 * Parse one `linear states` invocation before any credential or network is touched.
 *
 * The team may be given as `--team ENG` or as a bare positional, because both readings are natural and
 * neither is ambiguous — this verb takes exactly one address.
 *
 * @param rest the argv tail after `linear states`
 * @returns the resolved options, or every usage problem found
 */
export function parseLinearStatesArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<LinearStatesOptions, LinearVerbError> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: STATES_FLAGS });
  if (parsed.isErr()) {
    return err(LinearVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const flagged = parsed.value.values["team"];
  const teamKey = typeof flagged === "string" ? flagged : parsed.value.positionals[0];
  if (teamKey === undefined || teamKey.length === 0) {
    return err(LinearVerbErrors.teamMissing());
  }
  const limit = linearStatesLimit({ value: parsed.value.values["limit"] });
  if (limit.isErr()) {
    return err(limit.error);
  }
  const home = parsed.value.values["home"];
  return ok({
    home: typeof home === "string" ? home : undefined,
    json: parsed.value.values["json"] === true,
    limit: limit.value,
    noRecord: parsed.value.values["no-record"] === true,
    teamKey,
  });
}
