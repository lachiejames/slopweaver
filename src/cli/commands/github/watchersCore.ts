/**
 * `slopweaver github watchers` — the pure argument handling and the two renderings.
 *
 * The fold itself is `../../../outbound/github/watchers.ts`; reading the register is the run module's.
 * This module only decides what was TYPED and how an answer is written, so both can be tested without a
 * home on disk.
 */
import type { PullRequestWatch } from "../../../outbound/github/watchers.js";
import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";

/** The flags this verb accepts. */
const GITHUB_WATCHERS_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["repo", "home"],
};

/** `--`-prefixed flags, sorted, for the help-truth ratchet. */
function names({ spec: { string: strings = [], boolean: booleans = [] } }: { spec: FlagSpec }): readonly string[] {
  return [...strings, ...booleans].map((name) => `--${name}`).toSorted();
}

/** Every accepted flag, with the `--` callers type, sorted. */
export const GITHUB_WATCHERS_FLAG_NAMES: readonly string[] = names({ spec: GITHUB_WATCHERS_FLAGS });

/** A parsed, side-effect-free invocation. `repo` narrows the answer to one repository when typed. */
export interface GithubWatchersArgs {
  readonly repo: string | undefined;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * Parse `github watchers`' flags.
 *
 * @param rest the argv after the verb
 * @returns the invocation, or the parser's refusals
 */
export function parseGithubWatchersArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: GITHUB_WATCHERS_FLAGS });
}

/**
 * The typed invocation from parsed flag values.
 *
 * @param values the parsed flag bag
 * @returns the invocation
 */
export function githubWatchersArgsOf({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): GithubWatchersArgs {
  const repo = values["repo"];
  const home = values["home"];
  return {
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    repo: typeof repo === "string" ? repo : undefined,
  };
}

/**
 * The human rendering: one line per pull request, watchers first, then the last read.
 *
 * @param entries the fold, already narrowed to the repositories asked for
 * @returns the lines to print, or the one line that says the register names nothing
 */
export function renderWatchers({ entries }: { entries: readonly PullRequestWatch[] }): readonly string[] {
  if (entries.length === 0) {
    return ["github watchers: the register names no pull request yet — nothing has been read or watched"];
  }
  return entries.map((entry) => {
    const who = entry.watchers.map((watcher) => {
      const state = watcher.stale ? "STALE" : "watching";
      return `${watcher.session} ${state} (${watcher.mode}, since ${watcher.sinceIso}, head ${watcher.headSha.slice(0, 10)})`;
    });
    const watched = who.length === 0 ? "not watched" : who.join("; ");
    let read = "never read";
    if (entry.lastRead !== undefined) {
      read = `last read ${entry.lastRead.atIso} at ${entry.lastRead.headSha.slice(0, 10)}, rollup ${entry.lastRead.rollup}`;
    }
    return `${entry.repo}#${String(entry.number)}  ${watched}  ·  ${read}`;
  });
}
