/**
 * Pure parser, run selection and door request for `slopweaver github rerun`.
 *
 * The verb exists because a seat landing a bump would otherwise re-run a failed run with
 * `SLOPWEAVER_ALLOW_RAW=1 gh run rerun --failed` (a CI cache service outage is one cause), and with no `slopweaver
 * github` verb able to re-run anything, rule 3's one door would have a hole exactly where the fleet's commonest
 * autonomous CI act sits.
 */

import type { DoorRequest } from "../../../admit/types.js";
import type { IngestError } from "../../../lib/ingestError.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { WorkflowRunState } from "../../../outbound/github/rerun.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";
import { GithubVerbErrors } from "./errors.js";

const GITHUB_RERUN_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json"],
  string: ["repo", "run-id", "number", "home"],
};

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_RERUN_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_RERUN_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_RERUN_FLAGS }),
].map((name) => `--${name}`);

/** The conclusions a re-run of failed jobs answers. */
const RERUNNABLE_CONCLUSIONS: ReadonlySet<string> = new Set(["failure", "cancelled", "timed_out"]);

/**
 * The conclusions that leave nothing failed. Every OTHER finished conclusion — `startup_failure`,
 * `action_required`, `stale` — is neither, and is reported as one this verb cannot re-run rather than as clean.
 */
const CLEAN_CONCLUSIONS: ReadonlySet<string> = new Set(["success", "skipped", "neutral"]);

/** What the verb re-runs: one named run, or every failed run on a pull request's current head. */
type RerunTarget = { readonly kind: "run"; readonly runId: number } | { readonly kind: "pr"; readonly number: number };

/** The resolved re-run request. */
export interface GithubRerunArgs {
  readonly owner: string;
  readonly repo: string;
  readonly target: RerunTarget;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
}

/** A positive whole number from a flag's raw value, or undefined when it is absent or is not one. */
function positiveInteger({ value }: { value: unknown }): number | undefined {
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) {
    return undefined;
  }
  return Number(value);
}

/** Which of `--run-id`/`--number` names the target, or the usage problem when not exactly one does. */
function targetOf({ values }: { values: Readonly<Record<string, unknown>> }): Result<RerunTarget> {
  const runIdGiven = values["run-id"] !== undefined;
  const numberGiven = values["number"] !== undefined;
  if (runIdGiven === numberGiven) {
    return err([GithubVerbErrors.rerunTargetRequired().message]);
  }
  const flag = runIdGiven ? "run-id" : "number";
  const value = positiveInteger({ value: values[flag] });
  if (value === undefined) {
    return err([GithubVerbErrors.notPositiveWholeNumber({ flag: `--${flag}`, got: String(values[flag]) }).message]);
  }
  return ok(runIdGiven ? { kind: "run", runId: value } : { kind: "pr", number: value });
}

/**
 * Parse the re-run request before resolving a credential.
 *
 * @param rest argv after `github rerun`
 * @returns the resolved repository and target, or every usage problem
 */
export function parseGithubRerunArgs({ rest }: { rest: readonly string[] }): Result<GithubRerunArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_RERUN_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const values = parsed.value.values;
  const errors: string[] = [];
  const repoValue = values["repo"];
  const repo = typeof repoValue === "string" ? parseRepoSlug({ slug: repoValue }) : undefined;
  if (repo === undefined) {
    errors.push("--repo owner/name is required");
  }
  const target = targetOf({ values });
  if (target.isErr()) {
    errors.push(...target.error);
  }
  if (repo === undefined || target.isErr()) {
    return err(errors);
  }
  const home = values["home"];
  return ok({
    dryRun: values["dry-run"] === true,
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    owner: repo.owner,
    repo: repo.repo,
    target: target.value,
  });
}

/** What one run's state means for a re-run of its failed jobs. */
export type RerunVerdict = "rerun" | "nothing-failed" | "not-completed" | "not-rerunnable";

/**
 * Whether a run's failed jobs can be re-run now.
 *
 * A run still going is `not-completed`: GitHub refuses the re-run with a 403, and waiting is the answer. A
 * finished run that succeeded, was skipped or was neutral has nothing to re-run. Any other finished run —
 * one that never started its jobs, or waits on an approval — has no failed jobs to re-run either, but it is
 * not clean, so it is `not-rerunnable` rather than `nothing-failed`.
 *
 * @param run the run as read
 * @returns the verdict for this run
 */
export function rerunVerdict({ run }: { run: WorkflowRunState }): RerunVerdict {
  if (run.status !== "completed") {
    return "not-completed";
  }
  if (run.conclusion !== null && RERUNNABLE_CONCLUSIONS.has(run.conclusion)) {
    return "rerun";
  }
  if (run.conclusion !== null && CLEAN_CONCLUSIONS.has(run.conclusion)) {
    return "nothing-failed";
  }
  return "not-rerunnable";
}

/**
 * The newer run of the same workflow, on the same commit and for the same event, that replaced this one —
 * or undefined when this run is the latest of its kind. Re-running a replaced run would put its stale checks
 * back on the pull request, and under cancel-in-progress concurrency would cancel the live one.
 *
 * @param run one run on the head
 * @param runs every run on the same head
 * @returns the newest run superseding it, if any
 */
export function supersedingRun({
  run,
  runs,
}: {
  run: WorkflowRunState;
  runs: readonly WorkflowRunState[];
}): WorkflowRunState | undefined {
  return runs
    .filter((other) => other.workflowId === run.workflowId && other.event === run.event && other.id > run.id)
    .toSorted((a, b) => b.id - a.id)[0];
}

/**
 * Whether the read-back shows GitHub started a new attempt — the only evidence a re-run landed, since the
 * mutation answers with an empty 201. An attempt GitHub omitted on either read confirms nothing.
 *
 * @param before the run as read before the write
 * @param after the run as read after it
 * @returns true when the attempt advanced
 */
export function attemptAdvanced({ before, after }: { before: WorkflowRunState; after: WorkflowRunState }): boolean {
  return before.runAttempt !== undefined && after.runAttempt !== undefined && after.runAttempt > before.runAttempt;
}

/**
 * Whether a failed send may still have landed — a lost connection or a server error, where GitHub could have
 * accepted the write before the answer went missing. A 4xx is GitHub's own definite refusal, and an attempt
 * that advanced after one was somebody else's re-run, never this one's.
 *
 * @param error the send's failure
 * @returns true when only a read-back can say whether the re-run landed
 */
export function sendOutcomeUnknown({ error }: { error: IngestError }): boolean {
  if (error.kind === "network") {
    return true;
  }
  return error.kind === "http" && (error.status === undefined || error.status >= 500);
}

/**
 * How a run is named in every line this verb prints — its workflow name and the run id a reader can open.
 *
 * @param run the run being described
 * @returns the label, e.g. `ci (run 36945592960)`
 */
export function runLabel({ run }: { run: WorkflowRunState }): string {
  return `${run.name} (run ${String(run.id)})`;
}

/**
 * The external-write door request for one run's failed-job re-run.
 *
 * @param args the parsed repository
 * @param runId the run being re-run
 * @param home the Slopweaver state home whose door records the write
 * @returns the exact external-write request admitted by the door
 */
export function rerunDoorRequest({
  args,
  runId,
  home,
}: {
  args: GithubRerunArgs;
  runId: number;
  home: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "rerun" },
    artifact: { id: `${args.owner}/${args.repo}/actions/runs/${String(runId)}` },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}
