/** Pure argument handling for `slopweaver linear search`. */

import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";
import { type LinearVerbError, LinearVerbErrors } from "./errors.js";

const DEFAULT_LINEAR_SEARCH_LIMIT = 10;
const MAX_LINEAR_SEARCH_LIMIT = 50;

const SEARCH_FLAGS: FlagSpec = { boolean: ["json"], string: ["home", "limit"] };

/** Every accepted flag, derived from the exact spec passed to the parser. */
export const LINEAR_SEARCH_FLAG_NAMES: readonly string[] = ["--home", "--json", "--limit"];

/** A parsed, credential-free `linear search` invocation. */
export interface LinearSearchOptions {
  readonly term: string;
  readonly home: string | undefined;
  readonly json: boolean;
  readonly limit: number;
}

/**
 * The usage text for `slopweaver linear search`.
 *
 * @returns exact command help, including only flags its parser accepts
 */
export function linearSearchUsage(): string {
  return (
    "usage: slopweaver linear search <term> [--limit <1..50>] [--json] [--home <dir>]\n" +
    "  Searches current Linear issues and projects by term through Linear's own search API\n" +
    "  --limit           cap the results returned per object kind (default 10, maximum 50)\n" +
    "  --json            emit one machine-readable document listing every match\n" +
    "  --home            resolve the credential from this Slopweaver state home"
  );
}

/** Parse the per-kind result cap without allowing an accidental unbounded search. */
function linearSearchLimit({ value }: { value: string | boolean | undefined }): Result<number, LinearVerbError> {
  if (value === undefined) {
    return ok(DEFAULT_LINEAR_SEARCH_LIMIT);
  }
  const limit = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(limit) && limit > 0 && limit <= MAX_LINEAR_SEARCH_LIMIT
    ? ok(limit)
    : err(LinearVerbErrors.limitOutOfRange({ got: String(value), max: MAX_LINEAR_SEARCH_LIMIT }));
}

/**
 * Parse one `linear search` invocation before any credential or network is touched.
 *
 * @param rest the argv tail after `linear search`
 * @returns the resolved options, or every usage problem found
 */
export function parseLinearSearchArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<LinearSearchOptions, LinearVerbError> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: SEARCH_FLAGS });
  if (parsed.isErr()) {
    return err(LinearVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  if (parsed.value.positionals.length === 0) {
    return err(LinearVerbErrors.searchTermMissing());
  }
  const limit = linearSearchLimit({ value: parsed.value.values["limit"] });
  if (limit.isErr()) {
    return err(limit.error);
  }
  const home = parsed.value.values["home"];
  return ok({
    home: typeof home === "string" ? home : undefined,
    json: parsed.value.values["json"] === true,
    limit: limit.value,
    term: parsed.value.positionals.join(" "),
  });
}
