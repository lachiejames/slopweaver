/**
 * `slopweaver github checks` — the pure argument handling. Repo resolution (parsing `--repo`, or falling
 * back to the current checkout's `origin` remote) is impure and lives in `./checksRun.ts`'s shell; this
 * module only decides what was TYPED, never what the current git checkout says.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import { DEFAULT_TAIL_LINES } from "../../../live/github/jobLog.js";
import { isIsoZInstant } from "../../../live/github/prEvents.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { MAX_TAIL_LINES } from "./runLogUsage.js";

/**
 * The whole connection by default, not a sample of it.
 *
 * A default of 50 fits only a head with a handful of contexts. MEASURED on one `acme/acme-admin` pull
 * request: its head carries 93, so a smaller default read saw a PAGE and the required-context gate reported
 * `Required CI` as never having run when it had run and passed — the false red written up in
 * `../../../live/github/requiredContexts.ts`. Asking for fewer than GitHub will give buys nothing: one
 * `contexts` connection is one request either way.
 */
const DEFAULT_GITHUB_CHECKS_LIMIT = 100;
/** GitHub's own ceiling on a `contexts` connection page. Above this the gate reports `unproven`. */
const MAX_GITHUB_CHECKS_LIMIT = 100;
/**
 * Roughly double this repository's own CI lap, so a `--wait` outlives one slow run without hiding a hang.
 *
 * MEASURED over 49 `ci.yml` laps across 20 merged pull requests: p50
 * 9m23s, p95 9m45s, max 9m59s, so 1200 s is 2.13x the median. A number carrying no command at all is the
 * rot `.claude/rules/typescript-patterns.md` names: the `~8.5-minute` it replaced came from an older
 * sample whose whole band (7m40s–8m37s) no longer OVERLAPS the current one. Reproduce:
 *
 * ```bash
 * slopweaver github read https://github.com/lachiejames/slopweaver/pull/<n> --json \
 *   | jq '.data.commits.nodes[0].commit.statusCheckRollup.contexts.nodes[]
 *         | {name, startedAt, completedAt, detailsUrl}'
 * ```
 *
 * Group by the run id in `detailsUrl`; one group is one lap. `github checks` itself cannot answer this —
 * its own rollup query asks for `completedAt` without `startedAt` (`../../../live/github/checks.ts`).
 */
const DEFAULT_GITHUB_CHECKS_TIMEOUT_SECONDS = 1200;

/** The flags this verb accepts; the help-truth ratchet reads the names derived from it below. */
const GITHUB_CHECKS_FLAGS: FlagSpec = {
  boolean: ["wait", "json", "log"],
  string: ["repo", "number", "limit", "timeout-seconds", "until", "since", "home", "lines"],
};

/** Every accepted flag, with the `--` callers type. */
export const GITHUB_CHECKS_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_CHECKS_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_CHECKS_FLAGS }),
].map((name) => `--${name}`);

/**
 * What a `--wait` stops on. `ci` is the CI leg alone (the original verb); the other three add the review and
 * comment legs and report every change as one event line: `review` ends on the first new review, `any` on
 * the first of a CI verdict, a review or a comment, and `merge` only when the pull request is merged or
 * closed — the standing watch a parked session arms once and leaves.
 */
export type GithubChecksUntil = "ci" | "review" | "any" | "merge";

const UNTIL_MODES: readonly GithubChecksUntil[] = ["ci", "review", "any", "merge"];

/** A parsed, side-effect-free checks-watch invocation. `repo` is the raw `owner/name` typed, or absent. */
export interface GithubChecksArgs {
  readonly number: number;
  readonly repo: string | undefined;
  readonly wait: boolean;
  readonly until: GithubChecksUntil | undefined;
  readonly since: string | undefined;
  readonly limit: number;
  readonly timeoutSeconds: number;
  readonly json: boolean;
  readonly home: string | undefined;
  /** Read the failed checks' CI logs instead of reporting a status line. */
  readonly log: boolean;
  /** How many trailing lines of each failing step `--log` prints. */
  readonly lines: number;
}

/**
 * Which `--until` condition one event poll satisfied, if any.
 *
 * `merge` is never satisfied here: only a MERGED or CLOSED pull request ends a standing watch, and the
 * caller decides that from the activity read.
 *
 * @param until the mode the watch was armed with
 * @param ci whether a CI verdict was announced on this poll
 * @param reviewed whether a new review arrived on this poll
 * @param commented whether a new comment arrived on this poll
 * @returns the event kind that ended the watch, or `undefined` while it keeps watching
 */
export function untilSatisfied({
  until,
  ci,
  reviewed,
  commented,
}: {
  until: GithubChecksUntil;
  ci: boolean;
  reviewed: boolean;
  commented: boolean;
}): string | undefined {
  if (until === "merge") {
    return undefined;
  }
  if ((until === "ci" || until === "any") && ci) {
    return "ci";
  }
  if ((until === "review" || until === "any") && reviewed) {
    return "review";
  }
  return until === "any" && commented ? "comment" : undefined;
}

/** The typed `--until` mode a raw flag value names, or `undefined` when it names none of the four. */
function untilModeOf({ value }: { value: string }): GithubChecksUntil | undefined {
  return UNTIL_MODES.find((mode) => mode === value);
}

/** Parse the `--until`/`--since` pair, which only mean anything together. */
function parseUntilAndSince({ untilValue, sinceValue }: { untilValue: unknown; sinceValue: unknown }): {
  until: GithubChecksUntil | undefined;
  since: string | undefined;
  errors: readonly string[];
} {
  const errors: string[] = [];
  const until = typeof untilValue === "string" ? untilModeOf({ value: untilValue }) : undefined;
  if (untilValue !== undefined && until === undefined) {
    errors.push("--until must be one of ci, review, any, merge");
  }
  const since = typeof sinceValue === "string" ? sinceValue : undefined;
  if (since !== undefined && !isIsoZInstant({ value: since })) {
    errors.push("--since must be a UTC ISO-8601 instant ending in Z, e.g. 2026-09-03T01:30:00Z");
  }
  if (since !== undefined && until === undefined) {
    errors.push("--since only means something with --until");
  }
  return { errors, since, until };
}

/**
 * Parse the three flags that are whole numbers, each with its own bound.
 *
 * Together rather than one helper each: nothing here reads another's value, so the only thing they share is
 * the shape of the check, and three near-identical four-line helpers would say less than this does.
 */
function parseCounts({
  numberValue,
  limitValue,
  timeoutValue,
}: {
  numberValue: unknown;
  limitValue: unknown;
  timeoutValue: unknown;
}): { number: number; limit: number; timeoutSeconds: number; errors: readonly string[] } {
  const errors: string[] = [];
  const number = typeof numberValue === "string" ? Number(numberValue) : Number.NaN;
  if (!Number.isInteger(number) || number <= 0) {
    errors.push("--number must be a positive whole number");
  }
  const limit = limitValue === undefined ? DEFAULT_GITHUB_CHECKS_LIMIT : Number(limitValue);
  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_GITHUB_CHECKS_LIMIT) {
    errors.push(`--limit must be an integer from 1 to ${String(MAX_GITHUB_CHECKS_LIMIT)}`);
  }
  const timeoutSeconds = timeoutValue === undefined ? DEFAULT_GITHUB_CHECKS_TIMEOUT_SECONDS : Number(timeoutValue);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0) {
    errors.push("--timeout-seconds must be a positive whole number");
  }
  return { errors, limit, number, timeoutSeconds };
}

/**
 * Parse the `--log`/`--lines` pair, and refuse the one combination that cannot share a transcript.
 *
 * A one-shot log read and a polling watch print incompatible things: the log report is hundreds of lines and
 * the watch prints one line per change, so interleaving them produces output neither reader can follow.
 */
function parseLogAndLines({
  logValue,
  linesValue,
  waiting,
}: {
  logValue: unknown;
  linesValue: unknown;
  waiting: boolean;
}): { log: boolean; lines: number; errors: readonly string[] } {
  const errors: string[] = [];
  const log = logValue === true;
  const lines = linesValue === undefined ? DEFAULT_TAIL_LINES : Number(linesValue);
  if (!Number.isInteger(lines) || lines < 0 || lines > MAX_TAIL_LINES) {
    errors.push(`--lines must be an integer from 0 to ${String(MAX_TAIL_LINES)}`);
  }
  if (linesValue !== undefined && !log) {
    errors.push("--lines only means something with --log");
  }
  if (log && waiting) {
    errors.push("--log is a one-shot read and cannot be combined with --wait or --until");
  }
  return { errors, lines, log };
}

/**
 * Parse one `github checks` invocation before any credential, git remote or network is touched.
 *
 * @param rest the argv tail after `github checks`
 * @returns the resolved options, or every usage problem found
 */
export function parseGithubChecksArgs({ rest }: { rest: readonly string[] }): Result<GithubChecksArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_CHECKS_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const errors: string[] = [];

  const {
    number,
    limit,
    timeoutSeconds,
    errors: countErrors,
  } = parseCounts({
    limitValue: parsed.value.values["limit"],
    numberValue: parsed.value.values["number"],
    timeoutValue: parsed.value.values["timeout-seconds"],
  });
  errors.push(...countErrors);

  const {
    until,
    since,
    errors: untilErrors,
  } = parseUntilAndSince({
    sinceValue: parsed.value.values["since"],
    untilValue: parsed.value.values["until"],
  });
  errors.push(...untilErrors);

  const {
    log,
    lines,
    errors: logErrors,
  } = parseLogAndLines({
    linesValue: parsed.value.values["lines"],
    logValue: parsed.value.values["log"],
    waiting: parsed.value.values["wait"] === true || until !== undefined,
  });
  errors.push(...logErrors);

  if (errors.length > 0) {
    return err(errors);
  }
  const repo = parsed.value.values["repo"];
  const home = parsed.value.values["home"];
  return ok({
    home: typeof home === "string" ? home : undefined,
    json: parsed.value.values["json"] === true,
    limit,
    lines,
    log,
    number,
    repo: typeof repo === "string" ? repo : undefined,
    since,
    timeoutSeconds,
    until,
    wait: parsed.value.values["wait"] === true || until !== undefined,
  });
}
