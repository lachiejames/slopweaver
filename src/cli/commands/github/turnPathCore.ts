/**
 * `slopweaver github turn-path` — the pure argument handling and classification decision.
 *
 * Replaces the hand-rolled shell recipe the bot's own loop chain has copied forward, uncorrected, through
 * eight cuts of its own handover docs: fetch a pull request's head into `refs/prclass/<n>` and diff it
 * against `origin/main`. That convention had no code surface at all — `git grep prclass` returned nothing
 * tracked — so every session that ran it typed it from memory of the previous cut's doc, and three separate
 * fail-opens were found and re-found the same way before this module existed. See
 * `handovers/prclass-ref-namespace-fail-open.md` for the incident history this is built from.
 */

import { LOOP_CHAIN_PATHS } from "../../../lib/loopChainPaths.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";

/**
 * This verb's own name for {@link LOOP_CHAIN_PATHS} — the anchored path prefixes whose change makes a pull
 * request relevant to the bot's own loop chain's behaviour. Held over from the chain's own handover-doc
 * convention (`30aug-d`), rather than invented here; the shared module carries the reasoning behind the
 * actual path list.
 *
 * @internal — exported for direct inspection/testing of the exact set; no external caller names it.
 */
export const TURN_PATH_PREFIXES: readonly string[] = LOOP_CHAIN_PATHS;

/**
 * Whether one changed path falls under a turn-path prefix.
 *
 * Matched at a directory boundary (`path === prefix` or `path.startsWith(prefix + "/")`), not a bare
 * substring or unanchored prefix — the shape a prior cut's ad hoc `grep -E '^(...)'` already got right by
 * virtue of `^` anchoring each line, but which this module makes structural rather than incidental to how a
 * caller happens to invoke `grep`.
 *
 * @param path a path as reported by `git diff --name-only`
 * @returns whether this path is turn-path
 */
export function isTurnPathPath({ path }: { path: string }): boolean {
  return TURN_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * One classification's outcome over an already-known path list.
 *
 * @internal — {@link classifyTurnPathPaths}'s own return shape; no external caller names it.
 */
export interface TurnPathClassification {
  readonly turnPath: boolean;
  readonly matched: readonly string[];
}

/**
 * Classify a set of changed paths as turn-path or clean.
 *
 * @param paths every path `git diff --name-only` reported for the pull request
 * @returns whether any path is turn-path, and which ones
 */
export function classifyTurnPathPaths({ paths }: { paths: readonly string[] }): TurnPathClassification {
  const matched = paths.filter((path) => isTurnPathPath({ path }));
  return { matched, turnPath: matched.length > 0 };
}

/**
 * Validate a pull request's `headRefName` before it ever reaches a Git refspec.
 *
 * An empty or whitespace-only source makes the refspec read `":<dest>"`, which `git fetch` ACCEPTS, exits 0
 * on, and resolves the destination ref to the remote's OWN HEAD rather than refusing — measured directly,
 * `git fetch origin ":refs/prclass/witness-test"` exits 0 and leaves a genuine 40-character sha equal to
 * `origin/main`. Every guard that trusts the fetch's exit status or the resolved sha's length passes this
 * case, which is why it must be refused here, before any refspec is built at all.
 *
 * @param headRefName the pull request's reported head branch name
 * @returns the trimmed branch name, or why it cannot be used
 */
export function validatedHeadRefName({ headRefName }: { headRefName: string }): GithubVerbResult<string> {
  const trimmed = headRefName.trim();
  if (trimmed.length === 0) {
    return err(GithubVerbErrors.headRefNameBlank());
  }
  return ok(trimmed);
}

/**
 * The flags this verb accepts.
 *
 * @internal — {@link GITHUB_TURN_PATH_FLAG_NAMES} is the exported, externally-consumed derivative.
 */
export const GITHUB_TURN_PATH_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["head", "base", "repo", "number", "cwd", "remote"],
};

/** Every accepted flag, with the `--` callers type. */
export const GITHUB_TURN_PATH_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_TURN_PATH_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_TURN_PATH_FLAGS }),
].map((name) => `--${name}`);

/**
 * A parsed, side-effect-free `turn-path` invocation.
 *
 * @internal — {@link parseGithubTurnPathArgs}'s own return shape; callers destructure it, never name it.
 */
export interface GithubTurnPathArgs {
  readonly head: string;
  readonly base: string;
  readonly repo: string | undefined;
  readonly number: number | undefined;
  readonly cwd: string | undefined;
  readonly remote: string;
  readonly json: boolean;
}

const DEFAULT_BASE = "origin/main";
const DEFAULT_REMOTE = "origin";

/**
 * Parse one `github turn-path` invocation before any git process runs.
 *
 * @param rest the argv tail after `github turn-path`
 * @returns the resolved options, or every usage problem found
 */
export function parseGithubTurnPathArgs({ rest }: { rest: readonly string[] }): Result<GithubTurnPathArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_TURN_PATH_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const errors: string[] = [];

  const head = parsed.value.values["head"];
  const headName = typeof head === "string" ? head.trim() : "";
  if (headName.length === 0) {
    errors.push("--head is required and must name a branch");
  }

  const numberValue = parsed.value.values["number"];
  let number: number | undefined;
  if (numberValue !== undefined) {
    number = Number(numberValue);
    if (!Number.isInteger(number) || number <= 0) {
      errors.push("--number must be a positive whole number");
    }
  }

  if (errors.length > 0) {
    return err(errors);
  }
  const base = parsed.value.values["base"];
  const repo = parsed.value.values["repo"];
  const cwd = parsed.value.values["cwd"];
  const remote = parsed.value.values["remote"];
  return ok({
    base: typeof base === "string" ? base : DEFAULT_BASE,
    cwd: typeof cwd === "string" ? cwd : undefined,
    head: headName,
    json: parsed.value.values["json"] === true,
    number,
    remote: typeof remote === "string" ? remote : DEFAULT_REMOTE,
    repo: typeof repo === "string" ? repo : undefined,
  });
}
