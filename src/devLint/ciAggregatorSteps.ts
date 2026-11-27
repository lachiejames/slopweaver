/**
 * What the aggregator RUNS, judged apart from what it IS: `build`'s first step is the pinned verdict, and after it
 * runs exactly the pinned unit-merge tail.
 *
 * `ciOffloadContract.ts`'s `aggregatorFindings` judges the job — its needs, its `if`, its name — and hands its
 * steps here. The seam is the question each answers: the job's keys decide whether `build` runs at all and what
 * GitHub calls it, and these steps decide what a green `build` proves once it does. They split when the unit merge
 * left a job of its own, which had waited for a fresh runner between the shards and `build`, and moved in here.
 */
import { isDeepStrictEqual } from "node:util";
import { DEPENDENCY_CACHE_INPUTS } from "./ciDependencyCache.js";
import { OFFLOAD_JOB, OFFLOADED_COMMANDS, workerJobs } from "./ciOffloadCommands.js";
import { RUNNER_FACTS_STEP } from "./ciRunnerFacts.js";
import { artifactInputs, UNIT_MERGE_JOB } from "./ciWorkerActions.js";
import { FETCH_BASE_STEP } from "./ciWorkerRuns.js";
import { actionOf, type OffloadFinding, runOf, stepsOf } from "./ciWorkflowRead.js";

/** The one shape of aggregator step this gate accepts as proof that a non-success leg reddens `build`. */
const VERDICT_RUN = 'test "$ALL_SUCCEEDED" = "true"';

/** The condition that keeps `build` from being SKIPPED — and read as passing — when a leg fails. */
export const ALWAYS = "${{ always() }}";

/**
 * The only shell the verdict step may name, pinned rather than merely banned.
 *
 * A `shell:` value is a TEMPLATE — GitHub writes the `run:` block to a script file and substitutes it for
 * `{0}` — so `bash -c 'exit 0' {0}` runs the shell and never the script, and `build` goes green over a failed
 * leg with its `run`, `if`, `env` and `needs` all untouched. Found by review of the split as the
 * counterexample to this gate's own property: the worker rule banned `shell` on a command step and the
 * aggregator rule forgot to. Pinned to `bash` because that is what `ci.yml` names, and an unpinned default
 * varies by runner OS.
 */
const VERDICT_SHELL = "bash";

/**
 * Every step the aggregator runs AFTER its verdict, exactly and in order: the setup the unit merge needs, the
 * download of every shard's report, then the merge and the measured coverage floor. A closed list rather than
 * "any further steps" because each worker rule elsewhere in this gate admits a family of shapes, and a family
 * is what a later edit widens by accident: here a step carrying an `if`, a `continue-on-error`, a `shell`, an
 * `env`, a `working-directory`, a `|| true` or any step not on the list fails the comparison whole.
 *
 * Nothing after the verdict can turn a red leg green — the verdict already failed the job, and with no `if` of
 * their own these steps skip behind it — so what the pin protects is the merge half of the property: that a
 * green `build` also merged exactly the shards' reports on the event's tree and ran the floor over them. A step
 * BEFORE the verdict could hand it an environment, which is why the verdict is first and this is the tail.
 *
 * A step's `name` is not compared (it renames a log line, nothing else), and an action is compared by its
 * owner/repo rather than its ref, as `isSetupStep` does, so a Renovate bump needs no edit here.
 *
 * @returns the pinned tail, each step as {@link comparableStep} reads it
 */
function aggregatorTail(): readonly Readonly<Record<string, unknown>>[] {
  return [
    RUNNER_FACTS_STEP,
    { uses: "actions/checkout" },
    FETCH_BASE_STEP,
    { uses: "actions/setup-node", with: { "node-version-file": ".nvmrc" } },
    { run: "corepack enable" },
    { id: "deps", uses: "actions/cache/restore", with: DEPENDENCY_CACHE_INPUTS },
    { run: "yarn install --immutable" },
    { uses: "actions/download-artifact", with: artifactInputs({ job: UNIT_MERGE_JOB }) },
    ...OFFLOADED_COMMANDS.filter((entry) => entry.job === OFFLOAD_JOB).map((entry) => ({ run: entry.command })),
  ].map((step) => comparableStep({ step }));
}

/**
 * One step as the tail comparison reads it: its `name` dropped and its action reduced to owner/repo.
 *
 * @param step the step as parsed or as pinned
 * @returns the step with only the keys that change what it does
 */
function comparableStep({ step }: { step: Readonly<Record<string, unknown>> }): Readonly<Record<string, unknown>> {
  const kept = Object.fromEntries(Object.entries(step).filter(([key]) => key !== "name"));
  const action = actionOf({ step });
  return action === undefined ? kept : { ...kept, uses: action };
}

/**
 * The `ALL_SUCCEEDED` expression the aggregator must carry — one `== 'success'` per worker, joined by `&&`.
 *
 * Derived from {@link workerJobs} rather than written out, so adding a worker changes the expected expression
 * by itself and a `ci.yml` that forgot to extend it fails here.
 *
 * @returns the full `${{ … }}` expression
 */
export function expectedVerdictExpression(): string {
  return `\${{ ${workerJobs()
    .map((job) => `needs.${job}.result == 'success'`)
    .join(" && ")} }}`;
}

/**
 * Judge the aggregator's steps: the pinned verdict FIRST, always run, then exactly {@link aggregatorTail}.
 *
 * @param job the aggregator's map
 * @returns one finding per broken part of the verdict step or the tail after it
 */
export function verdictStepFindings({ job }: { job: Record<string, unknown> }): readonly OffloadFinding[] {
  const steps = stepsOf({ job });
  const step = steps?.[0];
  if (steps === undefined || step === undefined) {
    return [{ line: `\`jobs.${OFFLOAD_JOB}\` has no steps, so its verdict never runs` }];
  }
  const findings: OffloadFinding[] = [];
  const shell = step["shell"];
  if (
    runOf({ step }) !== VERDICT_RUN ||
    step["if"] !== ALWAYS ||
    "continue-on-error" in step ||
    shell !== VERDICT_SHELL
  ) {
    findings.push({
      line:
        `the \`${OFFLOAD_JOB}\` verdict must be its FIRST step, \`run: ${VERDICT_RUN}\` under \`if: ${ALWAYS}\` ` +
        `and \`shell: ${VERDICT_SHELL}\`, with no \`continue-on-error\` — a step before it could hand it an ` +
        "environment, and a `shell:` is a TEMPLATE, so one that never substitutes `{0}` runs no verdict at all",
    });
  }
  if (
    !isDeepStrictEqual(
      steps.slice(1).map((each) => comparableStep({ step: each })),
      aggregatorTail(),
    )
  ) {
    findings.push({
      line:
        `\`jobs.${OFFLOAD_JOB}\` runs steps after its verdict other than exactly its pinned merge tail ` +
        "(aggregatorTail), so a step there could pass the unit merge or the coverage floor without running it",
    });
  }
  // Its `env` is pinned whole: a leg the expression omits cannot redden it, and another variable could change
  // what `test` does before it runs.
  if (!isDeepStrictEqual(step["env"], { ALL_SUCCEEDED: expectedVerdictExpression() })) {
    findings.push({
      line: `the \`${OFFLOAD_JOB}\` verdict's \`env\` is not exactly ALL_SUCCEEDED: \`${expectedVerdictExpression()}\` — a leg it omits cannot redden it`,
    });
  }
  return findings;
}
