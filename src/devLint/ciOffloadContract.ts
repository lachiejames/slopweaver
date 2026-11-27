/**
 * The gate that keeps "it runs in CI" true.
 *
 * ## The hole this closes
 *
 * The whole-repo `ts.Program` gate and both test lanes came OFF the developer
 * machine's `pre-push` hook, because the answer to a gate that needs 2.9 GiB is a bigger machine and never a
 * bigger heap ceiling. Everything about that is safe on exactly one condition — that CI still runs them.
 *
 * Nothing enforced that condition. `gate-registration` proves every `src/devLint/*.entry.ts` is wired into
 * the lint PLAN; it says nothing about which lane CI invokes, and there was no contract at all tying CI to
 * `test:unit`, `test:subprocess` or `coverage:ratchet`. So changing one line of `ci.yml` from `yarn lint` to
 * `yarn lint:local`, or deleting the subprocess step, would leave the `build` check green while the
 * offloaded work ran NOWHERE — locally skipped by the lane, remotely deleted from the job. A missing
 * invocation is precisely the failure a passing suite cannot see, which is why this is a gate and not a
 * comment in the workflow (`ci.yml` carries plenty of those, and they enforce nothing).
 *
 * A pre-mortem on the change that moved the laps named this as a failure mode.
 *
 * **The opt-in local lane makes this gate load-bearing rather than merely prudent.** The local lane is now an
 * OPT-IN — `devLint.ts`'s `checksForLane` keeps only the gates flagged `offRepoState`, five of them, and
 * every other gate in the plan runs on a runner and nowhere else. Before that, this gate stood between CI
 * and three gates plus the test lanes; now it stands between CI and 62 of 67 gates. Nothing about the
 * property below changed, and neither did `OFFLOADED_COMMANDS` — `yarn lint` was always the FULL lane — but
 * what a false verdict here would cost went up by an order of magnitude.
 *
 * ## Why the property is about SUCCESS PROPAGATION, not command presence
 *
 * The one serial `build` job is split into four parallel workers — `lint`,
 * `typecheck`, `unit`, `subprocess` — with `build` kept as the required context that reports their
 * verdict (the unit lane has since split into six shards whose reports `build` merges after it); a fifth, `compile`, runs the `yarn build` that had been running nowhere at all, and the
 * desktop shell a sixth, `desktop`, whose `yarn build` runs in its own Yarn project under `desktop/`. The
 * console's `site` job joined as the seventh after it had stood outside `build` while a red console merged.
 * "The `build` job runs `yarn lint`" stopped being a sentence that could be true, and its obvious
 * replacement, "some job in ci.yml runs `yarn lint`", is satisfied by a job nothing requires. So the
 * property is now:
 *
 * > **`build` succeeding implies every offloaded command succeeded on that event's tree.**
 *
 * Proved over a deliberately narrow, reviewable shape rather than by evaluating arbitrary Actions
 * expressions or shell — each half is its own finding, so a failure names which one broke:
 *
 * 1. **Workers.** Each command runs in its declared worker as a step whose whole `run` IS the command (not a
 *    block that could `exit 0` first), in its declared `working-directory` or none, with no `if`, `continue-on-error` or `shell` override on that step,
 *    and no `if`, `continue-on-error`, `strategy` or `defaults` on the job. Two commands in one job run in
 *    declared order, so `coverage:ratchet` reads the report `test:unit` just wrote.
 * 2. **The aggregator.** `build` directly needs EXACTLY the workers, runs under `always()` — without it a
 *    failed need SKIPS `build`, and a skipped conclusion counts as passing — and its FIRST step fails
 *    unless each worker's result is spelled `== 'success'`. `!contains(needs.*.result, 'failure')` would
 *    admit a cancelled or skipped leg, which is why the expression is pinned rather than pattern-matched.
 *    After the verdict it runs exactly its pinned tail — setup, the shards' report download, the unit merge
 *    and the measured floor — compared whole, so no step there carries an `if`, a `continue-on-error`, a
 *    `shell` or a `|| true`. It merges there rather than in a job of its own because that job waited for a
 *    fresh runner between the shards and `build`. Both step rules live in `./ciAggregatorSteps.ts`.
 * 3. **Runner facts.** Every worker's FIRST step is the same runner assertion, byte for byte, and `build`'s
 *    second, straight after its verdict. Each worker is its own machine, so the one that proved the premise
 *    is not the one running the next worker's lap.
 * 4. **No inherited shell.** A `shell:` value is a TEMPLATE, so `bash -c 'exit 0' {0}` runs the shell and
 *    never the script GitHub wrote the `run:` block into. The workers ban `shell` on a command step, the
 *    verdict step pins it to `bash`, and a workflow-level `defaults` is refused outright. Both halves came
 *    from Codex review counterexamples against this gate's own property, one pass apart.
 * 5. **The coverage base.** Both jobs that read the floor against the base (`lint`'s `--summary-only`
 *    integrity half and `build`'s measured half) declare the same base expression and fetch it after
 *    checkout. Losing it does not fail anything — the history half reports skipped — which is exactly why
 *    it has to be asserted.
 *
 * ## What it does not prove
 *
 * That `build` is a REQUIRED check on the base branch — that lives in GitHub's branch protection, which no
 * file in this repository can see — nor that a command does what its name says. `src/__tests__/subprocess/
 * devLint/ciAggregatorVerdict.test.ts` runs the aggregator's real `run:` line through `bash`, which proves
 * the shell predicate; GitHub's own expression evaluation is proved only by a hosted run.
 *
 * **And it cannot read arbitrary shell**, which is where this gate's line is deliberately drawn. The Codex
 * review's fourth counterexample was a step inserted after checkout running `git checkout --force --detach
 * FETCH_HEAD` on `main`, which no criterion over YAML can separate from a legitimate `git` call. Each round
 * before it named a shape that looks ORDINARY in review — a `shell:` template, a workflow-level `defaults`,
 * a `with: { ref: … }` — and those are what a gate is for. This one names sabotage, and a tripwire that
 * tried to cover sabotage would have to enumerate every step a worker may run. Rule 3's framing applies:
 * a block confirms you were wrong, its absence means nothing.
 *
 * **Eleven review rounds, and where they stopped.** The first five each named a shape a careful author could
 * write by accident, and each is closed above. The rest were spellings rather than shapes — `REF` for `ref`,
 * `Actions/checkout`, `actions/checkout/@v4`, an `env` or `with` KEY written as `${{ '…' }}` — so the gate
 * normalises what Actions itself normalises (owner case, an empty subpath) and refuses outright anything it
 * cannot read literally: an expression where a key, an `env` block or a `with` block belongs, and any action
 * outside `allowedActions` in `./ciWorkerActions.ts`. That is the end of the line worth walking. A twelfth spelling is not a
 * defect this file can close; it is the same sabotage boundary arriving in different clothes.
 *
 * Reading the workflow document is not judging it, so the defensive readers — `jobOf`, `stepsOf`, `runOf`,
 * `actionOf`, `isCheckout`, `presentKeys` and the {@link OffloadFinding} shape — live in
 * `./ciWorkflowRead.ts`. They moved there when this file crossed its own recorded size floor, and
 * the seam is why that was the split to make rather than a marker: every one of them answers what the
 * document SAYS, with no opinion about what it ought to say, and `ciTriggerContract.ts` re-derives the same
 * readings today.
 *
 * Pure core / effectful shell: {@link offloadContractFindings} takes the workflow text and returns findings;
 * {@link runCiOffloadContract} reads the file and prints.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { repoRootOf } from "../lib/gitRepo.js";
import { isRecord } from "../lib/parsers.js";
import { ALWAYS, verdictStepFindings } from "./ciAggregatorSteps.js";
import { saveTriggerFindings } from "./ciDependencyCache.js";
import { jobCoverageFindings } from "./ciJobCoverage.js";
import { commandJobs, OFFLOAD_JOB, OFFLOADED_COMMANDS, workerJobs } from "./ciOffloadCommands.js";
import { runnerFactsFindings, staleSpecialRunnerFindings } from "./ciRunnerFacts.js";
import { workerActionFindings } from "./ciWorkerActions.js";
import { workerRunFindings } from "./ciWorkerRuns.js";
import { readWorkflowFiles, WORKFLOWS_DIR, workflowActionFindings } from "./ciWorkflowActions.js";
import { isCheckout, jobOf, type OffloadFinding, presentKeys, runOf, stepsOf } from "./ciWorkflowRead.js";
import { FLOOR_BASE_ENV } from "./gitAtCommit.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";

/** The workflow this gate reads, repo-relative. */
export const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";

/** The jobs that compare against the base commit: `lint` and `build`, for the coverage floor. */
const COVERAGE_BASE_JOBS: readonly string[] = ["lint", OFFLOAD_JOB];

/**
 * The one expression a coverage-base job may name, pinned rather than merely required to be non-empty.
 *
 * Three events put the base commit in three places, so there is exactly one right answer and no judgement
 * for a reviewer to exercise. Pinning it is also what closes a whole class of counterexample the Codex review
 * walked up one rung at a time: `coverageRatchet.ts` reads the all-zero sha as "no base" and passes, so any
 * literal a job could carry instead of this expression — on a step, or here — silently skips the comparison
 * while every other shape in the file still reads correct.
 */
const COVERAGE_BASE_EXPRESSION =
  "${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || " +
  "github.event_name == 'merge_group' && github.event.merge_group.base_sha || github.event.before }}";

/** The fetch line that puts the coverage base into a depth-1 checkout. */
const FETCH_BASE_LINE = `git fetch --no-tags --depth=1 origin "$${FLOOR_BASE_ENV}"`;

/** Job keys that could let a job's own failure, or its absence, stop reaching `build`. */
const UNSAFE_JOB_KEYS: readonly string[] = ["if", "continue-on-error", "strategy", "defaults"];

/** Step keys that could let a proof-bearing command fail without failing its job. */
const UNSAFE_STEP_KEYS: readonly string[] = ["if", "continue-on-error", "shell"];

/**
 * Job keys the AGGREGATOR may not set. Its `if` is checked separately against {@link ALWAYS} rather than
 * banned, because it is the one job that must carry one.
 */
const AGGREGATOR_UNSAFE_JOB_KEYS: readonly string[] = ["continue-on-error", "strategy", "defaults"];

/**
 * Judge one command-owning job: it exists, nothing on it can mask its failure, and each command it owns runs as
 * its own clean step, in declared order.
 *
 * @param workflow the parsed workflow document
 * @param job the command-owning job id, the aggregator among them
 * @returns one finding per broken part of that worker
 */
function workerJobFindings({ workflow, job }: { workflow: unknown; job: string }): readonly OffloadFinding[] {
  const entry = jobOf({ job, workflow });
  const steps = entry === undefined ? undefined : stepsOf({ job: entry });
  const owned = OFFLOADED_COMMANDS.filter((command) => command.job === job);
  if (entry === undefined || steps === undefined) {
    return owned.map((command) => ({
      line: `\`${command.command}\` runs nowhere: \`jobs.${job}\` or its steps list is missing — ${command.why}`,
    }));
  }
  // The aggregator's job keys and name are `aggregatorFindings`' to judge: it is the one job that MUST carry an
  // `if`, so the worker ban would refuse the very key that keeps a failed leg from skipping it.
  const aggregator = job === OFFLOAD_JOB;
  const unsafeJob = aggregator
    ? []
    : presentKeys({ keys: UNSAFE_JOB_KEYS, map: entry }).map((key) => ({
        line: `\`jobs.${job}\` sets \`${key}\`, which can stop its failure — or its running at all — reaching \`${OFFLOAD_JOB}\``,
      }));
  // A `name:` renames the CHECK RUN, not the job id `build.needs` points at, so this does not break the
  // verdict — it breaks the rollup a person reads, where `renamed-typecheck` is not a name anyone can map
  // back to a worker. The aggregator's own name is pinned for a harder reason (the ruleset requires it).
  const renamed =
    !aggregator && "name" in entry && entry["name"] !== job
      ? [{ line: `\`jobs.${job}\` renames its check to \`${String(entry["name"])}\`, which no reader can map back` }]
      : [];
  // Every worker's env is read the same way, not only the two that carry the coverage base: an env this gate
  // cannot read literally is one whose contents it is guessing at, and guessing is what the whole file
  // refuses to do.
  const unreadableEnv =
    envHidesBase({ env: entry["env"], level: "job" }) || steps.some((step) => envHidesBase({ env: step["env"] }))
      ? [{ line: `\`jobs.${job}\` carries an \`env\` this gate cannot read literally` }]
      : [];
  const indexes = owned.map((command) =>
    steps.findIndex((step) => runOf({ step }) === command.command && step["working-directory"] === command.directory),
  );
  // `indexes` is `owned` mapped one to one, so every position of `owned` has its index, and every position past
  // the first has the one before it: each read below is an invariant, not an absence.
  const commandFindings = owned.flatMap((command, position) =>
    commandStepFindings({ command, index: indexes[position]!, job, steps }),
  );
  const outOfOrder = indexes.some((index, position) => position > 0 && index !== -1 && index < indexes[position - 1]!);
  const order = outOfOrder
    ? [{ line: `\`jobs.${job}\` runs ${owned.map((c) => `\`${c.command}\``).join(" and ")} out of declared order` }]
    : [];
  return [...unsafeJob, ...renamed, ...unreadableEnv, ...commandFindings, ...order];
}

/**
 * Judge the one step that must carry a command.
 *
 * @param command the offloaded command's declaration
 * @param index where its step sits in the job, or -1 when no step's whole `run` is the command in its directory
 * @param job the worker job id
 * @param steps that job's steps
 * @returns one finding per broken part of that step
 */
function commandStepFindings({
  command,
  index,
  job,
  steps,
}: {
  command: (typeof OFFLOADED_COMMANDS)[number];
  index: number;
  job: string;
  steps: readonly Record<string, unknown>[];
}): readonly OffloadFinding[] {
  const step = steps[index];
  if (step === undefined) {
    const where = command.directory === undefined ? "" : ` under \`working-directory: ${command.directory}\``;
    return [
      {
        line: `\`jobs.${job}\` has no step whose whole \`run:\` is \`${command.command}\`${where} — ${command.why}`,
      },
    ];
  }
  return presentKeys({ keys: UNSAFE_STEP_KEYS, map: step }).map((key) => ({
    line: `the \`${command.command}\` step in \`jobs.${job}\` sets \`${key}\`, which can let it fail without failing the job`,
  }));
}

/**
 * Every worker checks out the event's own tree, and says so by naming no ref.
 *
 * `actions/checkout` defaults to the ref the event carries, which on a `pull_request` is GitHub's merge
 * commit and on a `merge_group` is the queue's own ref. `with: { ref: main }` on ONE worker therefore makes
 * that lap pass over a tree the event never proposed, with its command, its job and the aggregator all
 * untouched. Found by review as the counterexample to the earlier shell fix. `repository` is refused for
 * the same reason one level up.
 *
 * @param workflow the parsed workflow document
 * @returns one finding per worker with no checkout, or with one that names a ref or repository
 */
function checkoutFindings({ workflow }: { workflow: unknown }): readonly OffloadFinding[] {
  return commandJobs().flatMap((job): OffloadFinding[] => {
    const entry = jobOf({ job, workflow });
    const steps = entry === undefined ? undefined : stepsOf({ job: entry });
    if (steps === undefined) {
      return [];
    }
    const checkouts = steps.filter((step) => isCheckout({ step }));
    if (checkouts.length === 0) {
      return [{ line: `\`jobs.${job}\` checks nothing out, so what it ran on is not the event's tree` }];
    }
    return checkouts
      .filter((step) => {
        const inputs = step["with"];
        if (!isRecord(inputs)) {
          // A `with:` the gate cannot read as a map is an expression that evaluates to one, so it could
          // carry anything — refused the same way a step `env:` written as an expression is.
          return inputs !== undefined;
        }
        // Actions folds an input name to an `INPUT_*` environment variable, so `REF` and `ref` are the same
        // input. Comparing the spelling as written would have let `with: { REF: main }` through — the Codex
        // review's counterexample to the case-sensitive first version of this check.
        const named = new Set(Object.keys(inputs).map((key) => key.toLowerCase()));
        // An input KEY can be an expression, exactly as a step env key can, so a key the gate cannot read
        // literally is refused rather than read as some other input.
        return named.has("ref") || named.has("repository") || [...named].some((key) => key.includes("${{"));
      })
      .map(() => ({
        line: `\`jobs.${job}\` checks out a named ref or repository, so a green lap says nothing about the event's own tree`,
      }));
  });
}

/**
 * The workflow-level `defaults`, which every step in every job inherits.
 *
 * Refused outright rather than inspected. `defaults.run.shell` is inherited by any step that does not name
 * its own shell, and a shell is a TEMPLATE, so `bash -c 'exit 0' {0}` at the top of the file makes all five
 * offloaded commands exit 0 without running, with every step, job and `needs` in the file untouched. Found by
 * review as the counterexample to the verdict-shell fix: pinning the VERDICT step's shell left the workers
 * inheriting theirs. This repository's `ci.yml` declares no `defaults` at all, so refusing the key costs
 * nothing and leaves no shape to reason about.
 *
 * @param workflow the parsed workflow document
 * @returns one finding when the workflow declares `defaults`, else none
 */
function workflowDefaultsFindings({ workflow }: { workflow: unknown }): readonly OffloadFinding[] {
  if (!isRecord(workflow) || !("defaults" in workflow)) {
    return [];
  }
  return [
    {
      line:
        `${CI_WORKFLOW_PATH} declares a workflow-level \`defaults\`, which every step inherits — a ` +
        "`defaults.run.shell` that never substitutes `{0}` runs no offloaded command at all",
    },
  ];
}

/**
 * Judge the aggregator: exactly the workers as direct needs, always runs, a FIRST verdict step that fails on
 * anything but every leg's `success`, and after it exactly the pinned merge tail.
 *
 * @param workflow the parsed workflow document
 * @returns one finding per broken part of the aggregator
 */
export function aggregatorFindings({ workflow }: { workflow: unknown }): readonly OffloadFinding[] {
  const entry = jobOf({ job: OFFLOAD_JOB, workflow });
  if (entry === undefined) {
    return [{ line: `\`jobs.${OFFLOAD_JOB}\` is gone, so the required context no longer reports the laps at all` }];
  }
  const unsafe = presentKeys({ keys: AGGREGATOR_UNSAFE_JOB_KEYS, map: entry }).map((key) => ({
    line: `\`jobs.${OFFLOAD_JOB}\` sets \`${key}\`, which can stop its verdict being the one the ruleset reads`,
  }));
  const expected = workerJobs().toSorted();
  const needs = Array.isArray(entry["needs"]) ? entry["needs"].map(String).toSorted() : [];
  const findings: OffloadFinding[] = [...unsafe];
  // Compared element by element rather than as one joined string: `needs: ["lint,typecheck,unit,subprocess"]`
  // is ONE dependency naming no job at all, and it joins to exactly the same text as the four that are
  // right. The Codex review found that collision in this gate's own matcher.
  const sameNeeds = needs.length === expected.length && needs.every((need, index) => need === expected[index]);
  if (!sameNeeds) {
    findings.push({
      line: `\`jobs.${OFFLOAD_JOB}.needs\` is [${needs.join(", ")}], not exactly the workers [${expected.join(", ")}]`,
    });
  }
  if (entry["if"] !== ALWAYS) {
    findings.push({
      line: `\`jobs.${OFFLOAD_JOB}\` is not \`if: ${ALWAYS}\` — a failed leg would SKIP it, and skipped reads as passing`,
    });
  }
  if ("name" in entry && entry["name"] !== OFFLOAD_JOB) {
    findings.push({
      line: `\`jobs.${OFFLOAD_JOB}\` renames its check, which the ruleset still requires as \`${OFFLOAD_JOB}\``,
    });
  }
  return [...findings, ...verdictStepFindings({ job: entry })];
}

/**
 * Whether an `env` block could be setting the coverage base somewhere this gate cannot see it.
 *
 * Three shapes, all from Codex review counterexamples, and all the same idea: what YAML says and what
 * Actions does are not the same reading. A STEP's env outranks its job's, and `coverageRatchet.ts` treats
 * the all-zero sha as "no base" and PASSES, so setting it anywhere skips the comparison while the rest of
 * the file still reads correct. An `env:` written as an expression is a string here and a map there. And a
 * KEY written as an expression — `${{ 'SLOPWEAVER_COVERAGE_BASE_SHA' }}: '0000…'` — is an unrelated key
 * here and this variable there. So an env that cannot be read literally is refused at either level, and the
 * one legitimate place to name this variable is the job-level literal key.
 *
 * @param env the `env` value as parsed, or undefined when the block is absent
 * @param level `"job"` for the job's own env, where the literal key is the ONE legitimate way to set it
 * @returns true when the block could hide the base
 */
function envHidesBase({ env, level }: { env: unknown; level?: "job" }): boolean {
  if (env === undefined) {
    return false;
  }
  if (!isRecord(env)) {
    return true;
  }
  return Object.keys(env).some((key) => key.includes("${{") || (level !== "job" && key === FLOOR_BASE_ENV));
}

/**
 * The coverage-base jobs declare one shared base expression and fetch it after checkout.
 *
 * @param workflow the parsed workflow document
 * @returns one finding per job that lost its base, its fetch, or its agreement with the others
 */
export function coverageBaseFindings({ workflow }: { workflow: unknown }): readonly OffloadFinding[] {
  const expressions = new Set<unknown>();
  const findings = COVERAGE_BASE_JOBS.flatMap((job): OffloadFinding[] => {
    const entry = jobOf({ job, workflow });
    const steps = entry === undefined ? undefined : stepsOf({ job: entry });
    if (entry === undefined || steps === undefined) {
      return [];
    }
    const jobEnv = entry["env"];
    const base = isRecord(jobEnv) ? jobEnv[FLOOR_BASE_ENV] : undefined;
    expressions.add(base);
    const shadowed =
      envHidesBase({ env: jobEnv, level: "job" }) || steps.some((step) => envHidesBase({ env: step["env"] }))
        ? [
            {
              line:
                `\`jobs.${job}\` carries an \`env\` this gate cannot read literally, so \`${FLOOR_BASE_ENV}\` ` +
                "could be set where nothing here would see it",
            },
          ]
        : [];
    const checkout = steps.findIndex((step) => isCheckout({ step }));
    const fetch = steps.findIndex((step) => runOf({ step })?.includes(FETCH_BASE_LINE) === true);
    const lost = base === COVERAGE_BASE_EXPRESSION ? [] : [`does not name the one \`${FLOOR_BASE_ENV}\` expression`];
    const unfetched = checkout !== -1 && fetch > checkout ? [] : ["does not fetch the base after checkout"];
    return [
      ...shadowed,
      ...[...lost, ...unfetched].map((what) => ({
        line: `\`jobs.${job}\` ${what}, so its comparison against the base is silently skipped`,
      })),
    ];
  });
  const disagree =
    expressions.size > 1
      ? [{ line: `${COVERAGE_BASE_JOBS.join(", ")} name different \`${FLOOR_BASE_ENV}\` bases` }]
      : [];
  return [...findings, ...disagree];
}

/**
 * Judge one workflow's text against the offload contract. Pure.
 *
 * @param text the workflow file's contents
 * @returns one finding per broken part of the contract; empty means the contract holds
 */
export function offloadContractFindings({ text }: { text: string }): readonly OffloadFinding[] {
  let workflow: unknown;
  try {
    workflow = parse(text);
  } catch (error: unknown) {
    return [{ line: `${CI_WORKFLOW_PATH} does not parse as YAML: ${String(error)}`, unevaluated: true }];
  }
  if (!isRecord(workflow) || !isRecord(workflow["jobs"])) {
    return [{ line: `${CI_WORKFLOW_PATH} has no \`jobs\` map to read`, unevaluated: true }];
  }
  return [
    ...jobCoverageFindings({ text }),
    ...workflowDefaultsFindings({ workflow }),
    ...workerActionFindings({ workers: commandJobs(), workflow }),
    ...checkoutFindings({ workflow }),
    ...commandJobs().flatMap((job) => workerJobFindings({ job, workflow })),
    ...aggregatorFindings({ workflow }),
    ...runnerFactsFindings({ workflow }),
    ...workerRunFindings({ workflow }),
    ...coverageBaseFindings({ workflow }),
    ...saveTriggerFindings({ workflow }),
  ];
}

/**
 * Fail when CI stopped running a lap the developer machine stopped running too.
 *
 * @returns 0 when the contract holds, else 1
 */
export function runCiOffloadContract(): number {
  const root = repoRootOf({ importMetaUrl: import.meta.url });
  let text: string;
  let workflows: readonly { path: string; text: string }[];
  try {
    text = readFileSync(join(root, CI_WORKFLOW_PATH), "utf8");
    workflows = readWorkflowFiles({ root });
  } catch (error: unknown) {
    // devlint: not-a-refusal -- a workflow file could not be read, so the contract could not be evaluated at all
    process.stderr.write(`ci-offload-contract: cannot read ${WORKFLOWS_DIR}: ${String(error)}\n`);
    return 1;
  }
  const findings = [
    ...offloadContractFindings({ text }),
    ...workflowActionFindings({ cacheWorkflow: CI_WORKFLOW_PATH, workflows }),
    ...staleSpecialRunnerFindings({ workflows }),
  ];
  const unevaluated = findings.filter((finding) => finding.unevaluated === true);
  if (unevaluated.length > 0) {
    for (const finding of unevaluated) {
      // devlint: not-a-refusal -- the workflow could not be parsed or has no jobs to read, so the contract
      // was never evaluated; this reports that rather than claiming the contract is broken
      process.stderr.write(`  ${finding.line}\n`);
    }
    return 1;
  }
  if (findings.length === 0) {
    process.stdout.write(
      `ci-offload-contract: clean (\`${OFFLOAD_JOB}\` succeeds only if all ${String(OFFLOADED_COMMANDS.length)} ` +
        `offloaded lap(s) succeed across ${String(workerJobs().length)} worker job(s))\n`,
    );
    return 0;
  }
  for (const finding of findings) {
    process.stderr.write(`  ${finding.line}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "ci-offload-contract" }),
      detail: `${String(findings.length)} broken contract(s)`,
    })}
`,
  );
  return 1;
}
