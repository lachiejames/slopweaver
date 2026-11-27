/**
 * The runner-facts step: the first step of every offload worker in `ci.yml` (the second of `build`, after its
 * verdict), pinned whole, and the half of `ci-offload-contract` (`ciOffloadContract.ts`) that requires it byte
 * for byte with nothing sourced before it.
 */
import { isDeepStrictEqual } from "node:util";
import { parse } from "yaml";
import { isRecord } from "../lib/parsers.js";
import { envKeyFindings } from "./ciEnvKeys.js";
import { commandJobs, OFFLOAD_JOB } from "./ciOffloadCommands.js";
import { jobOf, type OffloadFinding, stepsOf } from "./ciWorkflowRead.js";
import { RUNNER_FLOOR_MIB } from "./gateCapacity.js";

/**
 * The runner-facts step every worker opens with, pinned whole. A pattern over its shell text cannot prove the
 * refusal RUNS — `echo RUNNER_ENVIRONMENT` and a leading `exit 0` each
 * pass one — while an exact step can: its `env` is one pinned key, it carries no `if` or
 * `continue-on-error`, and nothing runs before the `github-hosted` refusal. GitHub refuses a workflow that
 * overrides a `RUNNER_*` variable, so the refusal reads the runner's own answer. Change this beside `ci.yml`.
 */
export const RUNNER_FACTS_STEP = {
  env: { MIN_TOTAL_MIB: RUNNER_FLOOR_MIB },
  name: "Runner facts — the premise the offload rests on",
  run:
    [
      'total_mib="$(awk \'/^MemTotal:/{printf "%d", $2/1024}\' /proc/meminfo 2>/dev/null || echo 0)"',
      'echo "environment: ${RUNNER_ENVIRONMENT:-<unset>}"',
      'echo "arch/os:     ${RUNNER_ARCH:-?} ${RUNNER_OS:-?}"',
      "echo \"cpus:        $(nproc 2>/dev/null || echo '?')\"",
      'echo "memory:      ${total_mib} MiB total (floor ${MIN_TOTAL_MIB} MiB)"',
      'if [ "${RUNNER_ENVIRONMENT:-}" != "github-hosted" ]; then',
      "  echo \"::error::canon says the heavy gate laps run on a GitHub-hosted runner, but RUNNER_ENVIRONMENT is '${RUNNER_ENVIRONMENT:-<unset>}'. Fix the claim in docs/toolchain/build.md and this workflow's own comments — do not delete this check.\"",
      "  exit 1",
      "fi",
      'if [ "$total_mib" -lt "$MIN_TOTAL_MIB" ]; then',
      '  echo "::error::this runner has ${total_mib} MiB of memory, under the ${MIN_TOTAL_MIB} MiB floor the offloaded laps need. The pre-push hook no longer runs them, so they would run nowhere that can hold them. Move the runner back to a larger machine."',
      "  exit 1",
      "fi",
    ].join("\n") + "\n",
  shell: "bash",
} as const;

/**
 * The one runner selector every job in every workflow file runs on, written as the exact `runs-on` scalar. A job
 * naming another could pick a self-hosted runner whose own service environment sources a file before the
 * runner-facts step.
 *
 * It branches on the KIND of account that owns the repository, read off the event payload every trigger here carries
 * (`push`, `pull_request`, `merge_group`): an `Organization` selects its `default` runner group, where the 16 vCPU /
 * 64 GiB larger runner the gates were measured on lives (MEASURED, `slopweaver github run-log
 * 41032024345 --job desktop` prints `Runner group name: 'default'`), and a `User` — a personal account, or a fork
 * under one — selects GitHub's standard `ubuntu-latest`. Any other value, a payload without the field included,
 * reaches `fromJSON('')`, which fails the job at evaluation rather than guessing a runner. One expression rather
 * than two commits, so the selector is right on both sides of a repository move and names no account. Two states it
 * does not settle: an organisation whose `default` group holds no runner queues the job rather
 * than refusing it, and what that group resolves to is the organisation's runner configuration, outside anything a
 * workflow says. Only the offloaded workers carry the {@link RUNNER_FACTS_STEP}, which refuses an under-floor machine
 * loudly — the standard runner on a private repository included.
 */
export const RUNNER_SELECTOR =
  "${{ fromJSON(github.event.repository.owner.type == 'Organization' && '{\"group\":\"default\"}' || github.event.repository.owner.type == 'User' && '\"ubuntu-latest\"' || '') }}";

/**
 * The closed set of jobs that run somewhere other than {@link RUNNER_SELECTOR}, each named by workflow AND job, so
 * the exception can never pre-authorise a job added later. The one row is the desktop release: an Apple-silicon
 * macOS build is what packages, signs and notarises the app, and no Linux runner can. It offloads no gate lap and
 * carries no runner-facts step, so the premise that step guards does not apply to it.
 */
export const SPECIAL_WORKFLOW_RUNNERS: readonly {
  readonly workflow: string;
  readonly job: string;
  readonly runsOn: string;
}[] = [{ job: "release", runsOn: "macos-15", workflow: ".github/workflows/desktop-release.yml" }];

/**
 * The exact `runs-on` one job must carry: its {@link SPECIAL_WORKFLOW_RUNNERS} row's label, else
 * {@link RUNNER_SELECTOR}.
 *
 * @param path the workflow file's repo-relative path
 * @returns the selector the gate requires of that job
 */
function expectedRunnerSelector({ path, job }: { path: string; job: string }): string {
  const special = SPECIAL_WORKFLOW_RUNNERS.find((row) => row.workflow === path && row.job === job);
  return special === undefined ? RUNNER_SELECTOR : special.runsOn;
}

/**
 * Every job whose `runs-on` is not exactly the selector {@link expectedRunnerSelector} names for it.
 *
 * @param workflow the parsed workflow document
 * @param path the workflow file's repo-relative path, which opens each finding
 * @returns one finding per job on another runner, or with a `runs-on` this gate cannot read as that label
 */
export function runnerSelectorFindings({
  path,
  workflow,
}: {
  path: string;
  workflow: unknown;
}): readonly OffloadFinding[] {
  const jobs = isRecord(workflow) && isRecord(workflow["jobs"]) ? Object.entries(workflow["jobs"]) : [];
  return jobs.flatMap(([job, entry]): OffloadFinding[] => {
    const expected = expectedRunnerSelector({ job, path });
    if (isRecord(entry) && entry["runs-on"] === expected) {
      return [];
    }
    const name = expected === RUNNER_SELECTOR ? "RUNNER_SELECTOR" : "SPECIAL_WORKFLOW_RUNNERS";
    return [
      {
        line: `\`${path}\` \`jobs.${job}\` does not run on exactly \`${expected}\` (${name}), so it could pick a runner whose own environment runs before any step`,
      },
    ];
  });
}

/**
 * One workflow file's `jobs` map, empty when the text does not parse or carries none — the parse failure itself
 * is reported, as unevaluated, by `workflowActionFindings`.
 *
 * @returns the jobs keyed by id
 */
function workflowJobs({ text }: { text: string }): Record<string, unknown> {
  let document: unknown;
  try {
    document = parse(text);
  } catch {
    return {};
  }
  if (isRecord(document) && isRecord(document["jobs"])) {
    return document["jobs"];
  }
  return {};
}

/**
 * Every {@link SPECIAL_WORKFLOW_RUNNERS} row whose workflow file or job is gone, so a stale exception is removed
 * rather than left to authorise whatever job takes the name next.
 *
 * @param workflows every workflow file GitHub would run, with its text; one that does not parse carries no job
 * @returns one finding per row no workflow carries
 */
export function staleSpecialRunnerFindings({
  workflows,
}: {
  workflows: readonly { path: string; text: string }[];
}): readonly OffloadFinding[] {
  return SPECIAL_WORKFLOW_RUNNERS.filter((row) => {
    const file = workflows.find((each) => each.path === row.workflow);
    return file === undefined || !(row.job in workflowJobs({ text: file.text }));
  }).map((row) => ({
    line: `SPECIAL_WORKFLOW_RUNNERS names \`${row.workflow}\` \`jobs.${row.job}\`, which no workflow carries — drop the row`,
  }));
}

/**
 * Where {@link RUNNER_FACTS_STEP} must sit in one command-owning job: first in every worker, and SECOND in the
 * aggregator, whose first step is its verdict — the one step nothing may run before, because a step ahead of it
 * could hand it an environment. The verdict reads only the legs' results, so it needs no runner premise; the
 * merge after it does.
 *
 * @param job the command-owning job id
 * @returns the step index the runner-facts step must occupy
 */
function runnerFactsStepIndex({ job }: { job: string }): number {
  return job === OFFLOAD_JOB ? 1 : 0;
}

/**
 * Every command-owning job runs {@link RUNNER_FACTS_STEP} at {@link runnerFactsStepIndex}, before anything but
 * the aggregator's verdict, no such job runs in a `container`, and no `env` in the workflow sets a variable
 * outside `ENV_KEYS` (`ciEnvKeys.ts`) — `BASH_ENV` among them, which bash would source before the step's first
 * line.
 *
 * @param workflow the parsed workflow document
 * @returns one finding per job whose premise check is missing or has drifted, per container, per unpinned `env`
 */
export function runnerFactsFindings({ workflow }: { workflow: unknown }): readonly OffloadFinding[] {
  const drifted = commandJobs().flatMap((job): OffloadFinding[] => {
    const entry = jobOf({ job, workflow });
    const index = runnerFactsStepIndex({ job });
    const step = entry === undefined ? undefined : stepsOf({ job: entry })?.[index];
    const where = index === 0 ? "open with" : `run, as step ${String(index + 1)}, right after its verdict,`;
    return [
      ...(isDeepStrictEqual(step, RUNNER_FACTS_STEP)
        ? []
        : [{ line: `\`jobs.${job}\` does not ${where} the pinned runner-facts step (RUNNER_FACTS_STEP)` }]),
      // A container's image and `env` wrap every step, the runner-facts one included.
      ...(entry !== undefined && "container" in entry
        ? [{ line: `\`jobs.${job}\` runs in a \`container\`, whose image and \`env\` wrap its runner-facts step` }]
        : []),
    ];
  });
  return [...envKeyFindings({ workflow }), ...drifted];
}
