/**
 * `slopweaver github ci-runs` — the pure argument handling. Repo resolution (parsing `--repo`, or falling
 * back to the current checkout's `origin` remote) is impure and lives in `./ciRunsRun.ts`'s shell; this
 * module only decides what was TYPED.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";
import { type CiUsageIssues, ciFlagNames, ciPositiveInteger, ciTextFlag } from "./ciFlagParsing.js";
import { GithubCiRunsUsageIssues } from "./ciRunsErrors.js";

/** The window the owner's own question was asked over — the last twenty runs of `main`. */
const DEFAULT_RUN_WINDOW = 20;

/** GitHub's own ceiling for one `per_page` on the Actions runs endpoint. */
const MAX_RUN_WINDOW = 100;

/** The workflow whose jobs carry this repository's required contexts. */
const DEFAULT_WORKFLOW = "ci.yml";

/**
 * The events a run may be selected on, and the reason the flag exists rather than being hardcoded.
 *
 * `integration` is declared `if: github.event_name == 'pull_request' || github.event_name == 'merge_group'`,
 * so a window of `push` runs of `main` carries FIVE of this workflow's six jobs and looks complete. Naming
 * the event at the call site is what makes that visible instead of silent.
 */
const SELECTABLE_EVENTS: readonly string[] = ["push", "pull_request", "merge_group"];

/** The string-valued flags, named once so the spec and the help-truth list cannot disagree. */
const CI_RUNS_STRING_FLAGS: readonly string[] = ["repo", "branch", "event", "runs", "workflow", "home"];

/** The boolean flags, named once for the same reason. */
const CI_RUNS_BOOLEAN_FLAGS: readonly string[] = ["json", "steps"];

/**
 * The flags this verb accepts.
 *
 * @internal — the parser and {@link GITHUB_CI_RUNS_FLAG_NAMES} are its only readers; the names list is what
 * a help-truth check consumes.
 */
export const GITHUB_CI_RUNS_FLAGS: FlagSpec = {
  boolean: CI_RUNS_BOOLEAN_FLAGS,
  string: CI_RUNS_STRING_FLAGS,
};

/** Every accepted flag, with the `--` callers type. */
export const GITHUB_CI_RUNS_FLAG_NAMES: readonly string[] = ciFlagNames({
  booleans: CI_RUNS_BOOLEAN_FLAGS,
  strings: CI_RUNS_STRING_FLAGS,
});

/** A parsed, side-effect-free invocation. `repo` is the raw `owner/name` typed, or absent. */
export interface GithubCiRunsArgs {
  readonly repo: string | undefined;
  readonly branch: string;
  readonly event: string;
  readonly runs: number;
  readonly workflow: string;
  readonly json: boolean;
  readonly steps: boolean;
  readonly home: string | undefined;
}

/** A parse problem list, the shape every helper below returns on refusal. */
type UsageIssues = CiUsageIssues;

/** Parse `--runs`, refusing anything outside the bound rather than silently clamping. */
function runWindow({ value }: { value: string | boolean | undefined }): Result<number, UsageIssues> {
  const outcome = ciPositiveInteger({ max: MAX_RUN_WINDOW, value });
  if (outcome.kind === "absent") {
    return ok(DEFAULT_RUN_WINDOW);
  }
  if (outcome.kind === "invalid") {
    return err([GithubCiRunsUsageIssues.runWindowOutOfRange({ max: MAX_RUN_WINDOW })]);
  }
  return ok(outcome.value);
}

/** Parse `--event`, refusing a name GitHub's own trigger list does not carry. */
function selectedEvent({ value }: { value: string | boolean | undefined }): Result<string, UsageIssues> {
  if (value === undefined) {
    return ok("push");
  }
  if (typeof value === "string" && SELECTABLE_EVENTS.includes(value)) {
    return ok(value);
  }
  return err([GithubCiRunsUsageIssues.unknownEvent({ allowed: SELECTABLE_EVENTS })]);
}

/**
 * Parse one `github ci-runs` invocation before any credential, git remote or network is touched.
 *
 * @param rest the argv tail after `github ci-runs`
 * @returns the resolved options, or every usage problem found
 */
export function parseGithubCiRunsArgs({ rest }: { rest: readonly string[] }): Result<GithubCiRunsArgs, UsageIssues> {
  const parsed = parseFlags({ args: rest, spec: GITHUB_CI_RUNS_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error.map((message) => GithubCiRunsUsageIssues.flagParse({ message })));
  }
  const values = parsed.value.values;
  const runs = runWindow({ value: values["runs"] });
  const event = selectedEvent({ value: values["event"] });
  const branch = ciTextFlag({ fallback: "main", flag: "branch", value: values["branch"] });
  const workflow = ciTextFlag({ fallback: DEFAULT_WORKFLOW, flag: "workflow", value: values["workflow"] });
  // Every problem is collected before any is returned, so one invocation reports all four rather than
  // sending a caller round the loop once per flag. The four `isErr` re-tests are what narrow the types.
  const problems = [runs, event, branch, workflow].flatMap((r) => (r.isErr() ? r.error : []));
  if (runs.isErr() || event.isErr() || branch.isErr() || workflow.isErr()) {
    return err(problems);
  }
  const repo = values["repo"];
  const home = values["home"];
  return ok({
    branch: branch.value,
    event: event.value,
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    repo: typeof repo === "string" ? repo : undefined,
    runs: runs.value,
    steps: values["steps"] === true,
    workflow: workflow.value,
  });
}
