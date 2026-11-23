/**
 * `slopweaver github run-log` — the pure argument handling. Repo resolution (parsing `--repo`, or falling
 * back to the current checkout's `origin` remote) is impure and lives in `./runLogRun.ts`'s shell; this
 * module only decides what was TYPED.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import { DEFAULT_TAIL_LINES } from "../../../live/github/jobLog.js";
import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";
import { type GithubRunLogUsageIssue, GithubRunLogUsageIssues } from "./runLogErrors.js";
import { GITHUB_RUN_LOG_USAGE, MAX_TAIL_LINES } from "./runLogUsage.js";

/** The string-valued flags, named once so the spec and the help-truth list cannot disagree. */
const RUN_LOG_STRING_FLAGS: readonly string[] = ["repo", "job", "lines", "home"];

/** The boolean flags, named once for the same reason. */
const RUN_LOG_BOOLEAN_FLAGS: readonly string[] = ["json"];

/**
 * The flags this verb accepts.
 *
 * @internal read through {@link GITHUB_RUN_LOG_FLAG_NAMES}, which is what the help-truth ratchet imports.
 */
export const GITHUB_RUN_LOG_FLAGS: FlagSpec = {
  boolean: RUN_LOG_BOOLEAN_FLAGS,
  string: RUN_LOG_STRING_FLAGS,
};

/** Every accepted flag, with the `--` callers type. */
export const GITHUB_RUN_LOG_FLAG_NAMES: readonly string[] = [...RUN_LOG_STRING_FLAGS, ...RUN_LOG_BOOLEAN_FLAGS].map(
  (name) => `--${name}`,
);

/** A parsed, side-effect-free invocation. `repo` is the raw `owner/name` typed, or absent. */
export interface GithubRunLogArgs {
  readonly runId: number;
  readonly repo: string | undefined;
  readonly job: string | undefined;
  readonly lines: number;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * The usage text for `github run-log`.
 *
 * @returns exact command help, including only the flags its parser accepts
 */
export function githubRunLogUsage(): string {
  return GITHUB_RUN_LOG_USAGE;
}

/** A parse problem list, the shape every helper below returns on refusal. */
type UsageIssues = readonly GithubRunLogUsageIssue[];

/** Parse `--lines`, refusing anything outside the bound rather than silently clamping. */
function tailLines({ value }: { value: string | boolean | undefined }): Result<number, UsageIssues> {
  if (value === undefined) {
    return ok(DEFAULT_TAIL_LINES);
  }
  const lines = typeof value === "string" ? Number(value) : Number.NaN;
  if (Number.isInteger(lines) && lines >= 0 && lines <= MAX_TAIL_LINES) {
    return ok(lines);
  }
  return err([GithubRunLogUsageIssues.tailLinesOutOfRange({ max: MAX_TAIL_LINES })]);
}

/** The run id from the positional tail, refusing anything that is not one positive whole number. */
function runIdOf({ positionals }: { positionals: readonly string[] }): Result<number, UsageIssues> {
  if (positionals.length !== 1) {
    return err([GithubRunLogUsageIssues.runIdInvalid()]);
  }
  const raw = positionals[0];
  const runId = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isInteger(runId) || runId <= 0) {
    return err([GithubRunLogUsageIssues.runIdInvalid()]);
  }
  return ok(runId);
}

/** An optional string flag's value — refusing a blank, which is a typo rather than an omission. */
function optionalText({
  value,
  flag,
}: {
  value: string | boolean | undefined;
  flag: string;
}): Result<string | undefined, UsageIssues> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return ok(value.trim());
  }
  return err([GithubRunLogUsageIssues.blankFlagValue({ flag })]);
}

/**
 * Parse one `github run-log` invocation before any credential, git remote or network is touched.
 *
 * @param rest the argv tail after `github run-log`
 * @returns the resolved options, or every usage problem found
 */
export function parseGithubRunLogArgs({ rest }: { rest: readonly string[] }): Result<GithubRunLogArgs, UsageIssues> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: GITHUB_RUN_LOG_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error.map((message) => GithubRunLogUsageIssues.flagParse({ message })));
  }
  const values = parsed.value.values;
  const runId = runIdOf({ positionals: parsed.value.positionals });
  const lines = tailLines({ value: values["lines"] });
  const job = optionalText({ flag: "job", value: values["job"] });
  const repo = optionalText({ flag: "repo", value: values["repo"] });
  const home = optionalText({ flag: "home", value: values["home"] });
  // Every problem is collected before any is returned, so one invocation reports all of them rather than
  // sending a caller round the loop once per flag. The re-tests below are what narrow the types.
  const problems = [runId, lines, job, repo, home].flatMap((one) => (one.isErr() ? one.error : []));
  if (runId.isErr() || lines.isErr() || job.isErr() || repo.isErr() || home.isErr()) {
    return err(problems);
  }
  return ok({
    home: home.value,
    job: job.value,
    json: values["json"] === true,
    lines: lines.value,
    repo: repo.value,
    runId: runId.value,
  });
}
