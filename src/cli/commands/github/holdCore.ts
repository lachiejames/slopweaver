/**
 * `slopweaver github hold` and `slopweaver github release` — every DECISION these two verbs make, as pure
 * functions. The effectful shell in `./holdRun.ts` reads the clock, the session id and the hold document.
 *
 * Two verbs rather than one with a sub-verb, because they are used by different people at different moments:
 * a supervisor places a hold while it watches a rebase, and whoever lands the held pull request releases it
 * — very often the door itself, which clears the hold the instant its own merge succeeds.
 *
 * `--status` stays a FLAG on `hold` rather than a third verb: it answers "is anything held", which is a
 * question about the hold, and a reader who has typed `github hold` once already knows where to ask it.
 * `--history` is the same flag shape for the same reason, asking the past tense of the same question — what
 * HAS held this queue, read back from the journal `outbound/github/holdLedger.ts` describes. Both are
 * reports: neither places, releases, extends or excuses a hold, and both refuse the placement flags by name
 * so an invocation that meant to place one is never silently downgraded into a report.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { type SessionRoster, sessionLiveness } from "../../../measurement/sessions.js";
import type { Measured } from "../../../measurement/status.js";
import { HOLD_LEDGER_DEFAULT_LIMIT } from "../../../outbound/github/holdLedgerLimits.js";
import { DEFAULT_HOLD_STALE_MINUTES } from "../../../outbound/github/mergeHold.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";
import { type GithubVerbError, GithubVerbErrors } from "./errors.js";

/**
 * What a session with no readable id is called in a hold record.
 *
 * A hold placed from a plain terminal is still a real hold, so this is a label rather than a refusal —
 * matching `cmux send`'s own wording for the same situation.
 */
const UNIDENTIFIED_HOLDER = "an unidentified session";

/**
 * Who a new hold names as its holder.
 *
 * @param sessionId this session's id, when it has a readable one
 * @returns the session id, or {@link UNIDENTIFIED_HOLDER} when there is none
 */
export function holderNamedBy({ sessionId }: { sessionId: string | undefined }): string {
  if (sessionId === undefined) {
    return UNIDENTIFIED_HOLDER;
  }
  return sessionId;
}

/**
 * Whether a hold's holder is still a live session, according to a roster.
 *
 * {@link UNIDENTIFIED_HOLDER} is the label a hold placed with no readable session id carries, not an id the registry
 * could lack: asking for it answers "absent", which `--status` reads as PROVABLY gone and answers with a release
 * command, for a holder that may be a live terminal. It is passed on as no session id at all, so the verdict is
 * "nothing to ask about" and the hold reads `(liveness unknown)`.
 *
 * @param holder the session id the hold names, or {@link UNIDENTIFIED_HOLDER}
 * @param roster the live-session registry, or the reason there is none
 * @returns the holder's liveness verdict, unmeasurable for a hold that recorded no session
 */
export function holderLiveness({
  holder,
  roster,
}: {
  holder: string;
  roster: Measured<SessionRoster>;
}): Measured<boolean> {
  if (holder === UNIDENTIFIED_HOLDER) {
    return sessionLiveness({ roster, sessionId: undefined });
  }
  return sessionLiveness({ roster, sessionId: holder });
}

/** The flags `github hold` accepts. */
export const GITHUB_HOLD_FLAGS: FlagSpec = {
  boolean: ["status", "history", "json"],
  string: ["pr", "repo", "why", "stale-minutes", "limit", "home"],
};

/** The flags `github release` accepts. */
export const GITHUB_RELEASE_FLAGS: FlagSpec = {
  boolean: [],
  string: ["pr", "repo", "sha", "home"],
};

/** Every flag `github hold` advertises, WITH the `--`, for the help-truth ratchet. */
export const GITHUB_HOLD_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_HOLD_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_HOLD_FLAGS }),
].map((name) => `--${name}`);

/** Every flag `github release` advertises, WITH the `--`, for the help-truth ratchet. */
export const GITHUB_RELEASE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_RELEASE_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_RELEASE_FLAGS }),
].map((name) => `--${name}`);

/** One `github hold` invocation: either a placement, or a status report. */
export type GithubHoldArgs =
  | {
      readonly mode: "place";
      readonly pr: number;
      readonly repo: string;
      readonly why: string;
      readonly staleMinutes: number;
      readonly asJson: boolean;
      readonly home: string | undefined;
    }
  | { readonly mode: "status"; readonly asJson: boolean; readonly home: string | undefined }
  | { readonly mode: "history"; readonly limit: number; readonly asJson: boolean; readonly home: string | undefined };

/** One `github release` invocation. */
export interface GithubReleaseArgs {
  readonly pr: number;
  readonly repo: string;
  readonly sha: string | undefined;
  readonly home: string | undefined;
}

/** One declared string flag, or `undefined`. */
function stringFlag({
  values,
  name,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
}): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/** `--repo`, validated as an `owner/name` slug and kept in that exact spelling — the hold's key. */
function repoSlugFrom({
  values,
  errors,
}: {
  values: Readonly<Record<string, string | boolean>>;
  errors: string[];
}): string | undefined {
  const raw = stringFlag({ name: "repo", values });
  if (raw === undefined) {
    errors.push("--repo owner/name is required");
    return undefined;
  }
  const slug = parseRepoSlug({ slug: raw });
  if (slug === undefined) {
    errors.push(`--repo must be owner/name; "${raw}" is not`);
    return undefined;
  }
  return `${slug.owner}/${slug.repo}`;
}

/** `--pr`, a positive whole number, required by both verbs' acting paths. */
function pullRequestFrom({
  values,
  errors,
}: {
  values: Readonly<Record<string, string | boolean>>;
  errors: string[];
}): number | undefined {
  const raw = stringFlag({ name: "pr", values });
  if (raw === undefined) {
    errors.push("--pr <n> is required");
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    errors.push(`--pr must be a positive whole number; "${raw}" is not`);
    return undefined;
  }
  return parsed;
}

/** `--stale-minutes`, a positive whole number, defaulting when absent. */
function staleMinutesFrom({
  values,
  errors,
}: {
  values: Readonly<Record<string, string | boolean>>;
  errors: string[];
}): number {
  const raw = stringFlag({ name: "stale-minutes", values });
  if (raw === undefined) {
    return DEFAULT_HOLD_STALE_MINUTES;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    errors.push(`--stale-minutes must be a positive whole number; "${raw}" is not`);
    return DEFAULT_HOLD_STALE_MINUTES;
  }
  return parsed;
}

/** `--limit`, a positive whole number, defaulting to the journal's own bound when absent. */
function limitFrom({
  values,
  errors,
}: {
  values: Readonly<Record<string, string | boolean>>;
  errors: string[];
}): number {
  const raw = stringFlag({ name: "limit", values });
  if (raw === undefined) {
    return HOLD_LEDGER_DEFAULT_LIMIT;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    errors.push(`--limit must be a positive whole number; "${raw}" is not`);
    return HOLD_LEDGER_DEFAULT_LIMIT;
  }
  return parsed;
}

/** The flags that place a hold, refused by every reporting mode so a report is never mistaken for a placement. */
const PLACEMENT_FLAGS: readonly string[] = ["pr", "repo", "why", "stale-minutes"];

/**
 * Parse the reporting half of `github hold` — `--status` or `--history`, never both and never a placement.
 *
 * A combination is REFUSED by name rather than silently resolved one way: `github hold --status --pr <number>`
 * reads, to whoever typed it, as a request that did something, and a verb that quietly ignores half of what
 * it was handed is how a hold gets believed to be standing when it never was.
 *
 * @param asJson whether the caller asked for machine-readable output
 * @param home the state home the caller named
 * @param values every parsed flag
 * @param wantsStatus whether `--status` was given
 * @returns the parsed report, or the usage error that refused it
 */
function parseReportArgs({
  asJson,
  home,
  values,
  wantsStatus,
}: {
  asJson: boolean;
  home: string | undefined;
  values: Readonly<Record<string, string | boolean>>;
  wantsStatus: boolean;
}): Result<GithubHoldArgs, GithubVerbError> {
  const mode = wantsStatus ? "--status" : "--history";
  const conflicting = PLACEMENT_FLAGS.filter((name) => stringFlag({ name, values }) !== undefined);
  if (conflicting.length > 0) {
    return err(GithubVerbErrors.holdReportPlaces({ flags: conflicting, mode }));
  }
  if (wantsStatus) {
    if (stringFlag({ name: "limit", values }) !== undefined) {
      return err(GithubVerbErrors.holdStatusTakesNoLimit());
    }
    return ok({ asJson, home, mode: "status" });
  }
  const errors: string[] = [];
  const limit = limitFrom({ errors, values });
  return errors.length > 0
    ? err(GithubVerbErrors.argumentsRefused({ reasons: errors }))
    : ok({ asJson, home, limit, mode: "history" });
}

/**
 * Parse a `github hold` invocation — a placement, or one of the two reports.
 *
 * @param rest argv after `github hold`
 * @returns the parsed invocation, or every usage error at once
 */
export function parseGithubHoldArgs({ rest }: { rest: readonly string[] }): Result<GithubHoldArgs, GithubVerbError> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_HOLD_FLAGS });
  if (parsed.isErr()) {
    return err(GithubVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const asJson = values["json"] === true;
  const home = stringFlag({ name: "home", values });
  const wantsStatus = values["status"] === true;
  const wantsHistory = values["history"] === true;
  if (wantsStatus && wantsHistory) {
    return err(GithubVerbErrors.holdModesExclusive());
  }
  if (wantsStatus || wantsHistory) {
    return parseReportArgs({ asJson, home, values, wantsStatus });
  }
  const errors: string[] = [];
  const pr = pullRequestFrom({ errors, values });
  const repo = repoSlugFrom({ errors, values });
  const why = stringFlag({ name: "why", values });
  if (why === undefined || why.trim().length === 0) {
    errors.push('--why "…" is required: a hold nobody explained is a hold nobody knows when to release');
  }
  const staleMinutes = staleMinutesFrom({ errors, values });
  if (stringFlag({ name: "limit", values }) !== undefined) {
    errors.push("--limit bounds the --history journal and means nothing when placing a hold");
  }
  if (errors.length > 0 || pr === undefined || repo === undefined || why === undefined) {
    return err(GithubVerbErrors.argumentsRefused({ reasons: errors }));
  }
  return ok({ asJson, home, mode: "place", pr, repo, staleMinutes, why });
}

/**
 * Parse a `github release` invocation.
 *
 * @param rest argv after `github release`
 * @returns the parsed invocation, or every usage error at once
 */
export function parseGithubReleaseArgs({ rest }: { rest: readonly string[] }): Result<GithubReleaseArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_RELEASE_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const errors: string[] = [];
  const pr = pullRequestFrom({ errors, values });
  const repo = repoSlugFrom({ errors, values });
  if (errors.length > 0 || pr === undefined || repo === undefined) {
    return err(errors);
  }
  return ok({
    home: stringFlag({ name: "home", values }),
    pr,
    repo,
    sha: stringFlag({ name: "sha", values }),
  });
}
