/**
 * `slopweaver github search` — the pure argument handling. Repo resolution (parsing `--repo`, or falling
 * back to the current checkout's `origin` remote) is impure and lives in `./searchRun.ts`'s shell; this
 * module only decides what was TYPED, never what the current git checkout says.
 */

import { err, ok } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";

const DEFAULT_GITHUB_SEARCH_LIMIT = 10;
/**
 * GitHub's own ceiling for one search page (`per_page` on `/search/issues` caps at 100). A caller asking
 * for a SET rather than a sample passes `--complete`, which requests this whole page and refuses a bounded
 * one — raising the ceiling alone only moves the cliff, so the ceiling and the refusal ship together.
 */
const MAX_GITHUB_SEARCH_LIMIT = 100;

/** The flags this verb accepts; the help-truth ratchet reads the names derived from it below. */
const GITHUB_SEARCH_FLAGS: FlagSpec = {
  boolean: ["json", "complete"],
  string: ["repo", "limit", "home"],
};

/** Every accepted flag, with the `--` callers type. */
export const GITHUB_SEARCH_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_SEARCH_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_SEARCH_FLAGS }),
].map((name) => `--${name}`);

/** A parsed, side-effect-free search invocation. `repo` is the raw `owner/name` typed, or absent. */
export interface GithubSearchArgs {
  readonly term: string;
  readonly repo: string | undefined;
  readonly limit: number;
  readonly complete: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** Parse `--limit`, refusing anything outside the bound rather than silently clamping. */
function searchLimit({
  value,
  complete,
}: {
  value: string | boolean | undefined;
  complete: boolean;
}): GithubVerbResult<number> {
  if (value === undefined) {
    return ok(complete ? MAX_GITHUB_SEARCH_LIMIT : DEFAULT_GITHUB_SEARCH_LIMIT);
  }
  const limit = typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(limit) && limit > 0 && limit <= MAX_GITHUB_SEARCH_LIMIT
    ? ok(limit)
    : err(GithubVerbErrors.searchLimitOutOfRange({ got: String(value), max: MAX_GITHUB_SEARCH_LIMIT }));
}

/**
 * Parse one `github search` invocation before any credential, git remote or network is touched.
 *
 * @param rest the argv tail after `github search`
 * @returns the resolved options, or every usage problem found
 */
export function parseGithubSearchArgs({ rest }: { rest: readonly string[] }): GithubVerbResult<GithubSearchArgs> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: GITHUB_SEARCH_FLAGS });
  if (parsed.isErr()) {
    return err(GithubVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  if (parsed.value.positionals.length === 0) {
    return err(GithubVerbErrors.searchTermMissing());
  }
  const complete = parsed.value.values["complete"] === true;
  const limit = searchLimit({ complete, value: parsed.value.values["limit"] });
  if (limit.isErr()) {
    return err(limit.error);
  }
  const repo = parsed.value.values["repo"];
  const home = parsed.value.values["home"];
  return ok({
    complete,
    home: typeof home === "string" ? home : undefined,
    json: parsed.value.values["json"] === true,
    limit: limit.value,
    repo: typeof repo === "string" ? repo : undefined,
    term: parsed.value.positionals.join(" "),
  });
}
