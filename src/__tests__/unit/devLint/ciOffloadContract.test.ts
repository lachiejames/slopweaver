/**
 * Two describe blocks, the same shape as `gateRegistration.test.ts`: the first exercises the PURE judgement
 * on inline workflow fixtures, the second reads this repository's REAL `.github/workflows/ci.yml` — because
 * a gate whose only tests are fixtures proves the matcher works and never that the contract holds here.
 *
 * The positive fixture is written out by hand rather than generated from `OFFLOADED_COMMANDS`, so a change
 * to the declaration under test cannot silently change what "the good shape" means here too.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { DEPENDENCY_CACHE_INPUTS, SAVE_CONDITION } from "../../../devLint/ciDependencyCache.js";
import { OFFLOADED_COMMANDS, workerJobs } from "../../../devLint/ciOffloadCommands.js";
import {
  aggregatorFindings,
  CI_WORKFLOW_PATH,
  coverageBaseFindings,
  expectedVerdictExpression,
  offloadContractFindings,
} from "../../../devLint/ciOffloadContract.js";
import { RUNNER_FACTS_STEP, RUNNER_SELECTOR, runnerFactsFindings } from "../../../devLint/ciRunnerFacts.js";
import { FETCH_BASE_RUN, FETCH_BASE_STEP } from "../../../devLint/ciWorkerRuns.js";
import { jobOf, stepsOf } from "../../../devLint/ciWorkflowRead.js";
import { repoRootOf } from "../../../lib/gitRepo.js";

const BASE =
  "${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || " +
  "github.event_name == 'merge_group' && github.event.merge_group.base_sha || github.event.before }}";
const FETCH = FETCH_BASE_RUN;
const VERDICT =
  "${{ needs.lint.result == 'success' && needs.typecheck.result == 'success' && needs.unit-1.result == 'success' && " +
  "needs.unit-2.result == 'success' && needs.unit-3.result == 'success' && needs.unit-4.result == 'success' && " +
  "needs.unit-5.result == 'success' && needs.unit-6.result == 'success' && needs.unit.result == 'success' && " +
  "needs.subprocess.result == 'success' && needs.desktop-e2e.result == 'success' && " +
  "needs.compile.result == 'success' && needs.desktop.result == 'success' && needs.site.result == 'success' }}";

/** The unit lane's six shard jobs, written out rather than read from `UNIT_SHARD_COUNT`. */
const SHARDS = ["unit-1", "unit-2", "unit-3", "unit-4", "unit-5", "unit-6"];

/** Every worker, in `build.needs` order. */
const WORKERS = ["lint", "typecheck", ...SHARDS, "unit", "subprocess", "desktop-e2e", "compile", "desktop", "site"];

/** The same workers sorted, as a finding prints them. */
const SORTED_WORKERS =
  "compile, desktop, desktop-e2e, lint, site, subprocess, typecheck, unit, unit-1, unit-2, unit-3, unit-4, unit-5, unit-6";

const VERDICT_STEP_FINDING =
  'the `build` verdict step must be `run: test "$ALL_SUCCEEDED" = "true"` under `if: ${{ always() }}` and ' +
  "`shell: bash`, with no `continue-on-error` — a `shell:` is a TEMPLATE, so one that never substitutes " +
  "`{0}` runs no verdict at all";

const STEP_ENV_FINDING =
  "`jobs.lint` carries an `env` this gate cannot read literally, so `SLOPWEAVER_COVERAGE_BASE_SHA` could be " +
  "set where nothing here would see it";

/** The aggregator's one step, in the shape the gate accepts. */
const verdictStep = (): Record<string, unknown> => ({
  env: { ALL_SUCCEEDED: VERDICT },
  if: "${{ always() }}",
  run: 'test "$ALL_SUCCEEDED" = "true"',
  shell: "bash",
});

/** The cached root install: a restore straight before it, and for the one writer a save straight after. */
const install = ({ writer }: { writer: boolean }): Record<string, unknown>[] => [
  { id: "deps", uses: "actions/cache/restore@v4", with: DEPENDENCY_CACHE_INPUTS },
  { run: "yarn install --immutable" },
  ...(writer ? [{ if: SAVE_CONDITION, uses: "actions/cache/save@v4", with: DEPENDENCY_CACHE_INPUTS }] : []),
];

/** A worker's opening steps: the runner assertion, checkout, (for a coverage-base job) the base fetch, and the install. */
const prelude = ({ fetch, writer = false }: { fetch: boolean; writer?: boolean }): Record<string, unknown>[] => [
  { ...RUNNER_FACTS_STEP },
  { uses: "actions/checkout@v4" },
  ...(fetch ? [{ ...FETCH_BASE_STEP }] : []),
  ...install({ writer }),
];

/** The checks each nested project runs between its install and its build. */
const NESTED_CHECKS: Record<string, readonly string[]> = { desktop: [], site: ["yarn test:nextra-patch"] };

/** A nested Yarn project's worker steps: cold, so no restore, its install, its checks and its build, in its directory. */
const nestedSteps = ({ directory }: { directory: string }): Record<string, unknown>[] => [
  { ...RUNNER_FACTS_STEP },
  { uses: "actions/checkout@v4" },
  { uses: "actions/setup-node@v4", with: { "node-version-file": ".nvmrc" } },
  { run: "corepack enable" },
  { run: "yarn install --immutable", "working-directory": directory },
  ...NESTED_CHECKS[directory]!.map((run) => ({ run, "working-directory": directory })),
  { run: "yarn build", "working-directory": directory },
];

/** One shard job: the prelude, its slice of the lane as a blob report, and the upload that ships it. */
const shardJob = ({ index }: { index: number }): Record<string, unknown> => ({
  steps: [
    ...prelude({ fetch: false }),
    { run: `yarn test:unit --shard=${String(index)}/6 --reporter=default --reporter=blob` },
    {
      uses: "actions/upload-artifact@v4",
      with: {
        "if-no-files-found": "error",
        "include-hidden-files": true,
        name: `unit-blob-${String(index)}`,
        path: ".vitest-reports/",
        "retention-days": 1,
      },
    },
  ],
});

/** Every job on the one pinned runner selector. */
const onRunner = ({
  jobs,
}: {
  jobs: Record<string, Record<string, unknown>>;
}): Record<string, Record<string, unknown>> =>
  Object.fromEntries(Object.entries(jobs).map(([job, entry]) => [job, { "runs-on": RUNNER_SELECTOR, ...entry }]));

/** The complete good shape, as a plain object each test copies and breaks one part of. */
const goodWorkflow = (): { jobs: Record<string, Record<string, unknown>>; on?: Record<string, unknown> } => ({
  on: { push: { branches: ["main"] } },
  jobs: onRunner({
    jobs: {
      build: { if: "${{ always() }}", needs: [...WORKERS], steps: [verdictStep()] },
      // The two jobs deliberately outside `build.needs`: a required context of its own, and a timing report.
      integration: { steps: [...prelude({ fetch: false }), { run: "yarn test:integration" }] },
      "ci-timing": {
        needs: ["build"],
        steps: [...prelude({ fetch: false }), { run: "yarn slopweaver github ci-timing" }],
      },
      ...Object.fromEntries(SHARDS.map((job, position) => [job, shardJob({ index: position + 1 })])),
      lint: { env: { SLOPWEAVER_COVERAGE_BASE_SHA: BASE }, steps: [...prelude({ fetch: true }), { run: "yarn lint" }] },
      compile: { steps: [...prelude({ fetch: false }), { run: "yarn build" }] },
      desktop: { steps: nestedSteps({ directory: "desktop" }) },
      "desktop-e2e": { steps: [...prelude({ fetch: false }), { run: "yarn test:e2e" }] },
      site: { steps: nestedSteps({ directory: "site" }) },
      subprocess: { steps: [...prelude({ fetch: false }), { run: "yarn test:subprocess" }] },
      typecheck: { steps: [...prelude({ fetch: false, writer: true }), { run: "yarn typecheck" }] },
      unit: {
        env: { SLOPWEAVER_COVERAGE_BASE_SHA: BASE },
        needs: [...SHARDS],
        steps: [
          ...prelude({ fetch: true }),
          {
            uses: "actions/download-artifact@v4",
            with: { "merge-multiple": true, path: ".vitest-reports", pattern: "unit-blob-*" },
          },
          { run: "yarn test:unit:merge" },
          { run: "yarn coverage:ratchet" },
        ],
      },
    },
  }),
});

const lines = ({ workflow }: { workflow: unknown }): readonly string[] =>
  offloadContractFindings({ text: stringify(workflow) }).map((finding) => finding.line);

describe("workerJobs and expectedVerdictExpression", () => {
  it("offloads the desktop shell's own build to its own worker", () => {
    expect(OFFLOADED_COMMANDS.filter((e) => e.job === "desktop").map((e) => e.command)).toEqual(["yarn build"]);
  });

  it("offloads the console site's Nextra-patch witness, then its build, to its own worker, so a red console reddens `build`", () => {
    expect(OFFLOADED_COMMANDS.filter((entry) => entry.job === "site").map((entry) => entry.command)).toEqual([
      "yarn test:nextra-patch",
      "yarn build",
    ]);
  });

  it("offloads nothing to a raycast worker, the extension being gone", () => {
    expect(OFFLOADED_COMMANDS.filter((entry) => entry.job === "raycast")).toEqual([]);
  });

  it("names each worker once, in declaration order", () => {
    expect(workerJobs()).toEqual(WORKERS);
  });

  it("spells one `== 'success'` per worker, which is what a cancelled or skipped leg fails", () => {
    expect(expectedVerdictExpression()).toBe(VERDICT);
  });
});

describe("jobOf and stepsOf", () => {
  it("reads a job's map", () => {
    expect(jobOf({ job: "lint", workflow: { jobs: { lint: { steps: [] } } } })).toEqual({ steps: [] });
  });

  it("returns undefined for a job that is not there", () => {
    expect(jobOf({ job: "lint", workflow: { jobs: {} } })).toBe(undefined);
  });

  it("rejects a steps list holding a non-map, rather than filtering the bad member away", () => {
    expect(stepsOf({ job: { steps: [{ run: "a" }, "b"] } })).toBe(undefined);
  });

  it("returns undefined for a `steps:` key with nothing under it", () => {
    expect(stepsOf({ job: { steps: null } })).toBe(undefined);
  });
});

describe("offloadContractFindings", () => {
  it("reports nothing for the complete good shape", () => {
    expect(lines({ workflow: goodWorkflow() })).toEqual([]);
  });

  it("names the lap that was swapped for the local lane — the whole point of the gate", () => {
    const workflow = goodWorkflow();
    workflow.jobs["lint"]!["steps"] = [...prelude({ fetch: true }), { run: "yarn lint:local" }];
    expect(lines({ workflow })).toEqual([
      "`jobs.lint` has no step whose whole `run:` is `yarn lint` — the full lane: 62 of the 67 gates, everything the opt-in local lane does not flag offRepoState",
      "`jobs.lint` runs `yarn lint:local`, which is neither a whole pinned setup step nor one of its own commands with only a name, and could hand the next step an environment",
    ]);
  });

  // When `site` became a worker: the root cache restored and a bare root `yarn build`
  // satisfied every gate, so the console could go unbuilt with `build` green. Only the directory pin catches it.
  it("refuses a nested project's build run at the root over a restored root install", () => {
    const workflow = goodWorkflow();
    workflow.jobs["site"]!["steps"] = [...prelude({ fetch: false }), { run: "yarn build" }];
    expect(lines({ workflow })).toEqual([
      "`jobs.site` has no step whose whole `run:` is `yarn test:nextra-patch` under `working-directory: site` — the witness that the installed Nextra is the patched one, with no Twoslash transformer for a TypeScript bump to break",
      "`jobs.site` has no step whose whole `run:` is `yarn build` under `working-directory: site` — the console's " +
        "`next build`, its only typecheck — outside `build`, a red console left the required check green",
    ]);
  });

  it("refuses a cold nested job whose build runs at the root or in another directory, by both gates", () => {
    const cold = nestedSteps({ directory: "site" }).slice(0, -1);
    const variants = [
      [...cold, { run: "yarn build" }],
      [...cold, { run: "yarn build", "working-directory": "desktop" }],
    ];
    expect(
      variants.map((steps) => {
        const workflow = goodWorkflow();
        workflow.jobs["site"]!["steps"] = steps;
        return lines({ workflow });
      }),
    ).toEqual(
      variants.map(() => [
        "`jobs.site` does not run exactly its pinned cold steps (COLD_JOB_RUNS), in order and with none of their " +
          "unsafe keys, so it could skip its build or use the root project cold",
        "`jobs.site` has no step whose whole `run:` is `yarn build` under `working-directory: site` — the console's " +
          "`next build`, its only typecheck — outside `build`, a red console left the required check green",
      ]),
    );
  });

  it("refuses a root command moved into a directory", () => {
    const workflow = goodWorkflow();
    workflow.jobs["compile"]!["steps"] = [
      ...prelude({ fetch: false }),
      { run: "yarn build", "working-directory": "site" },
    ];
    expect(lines({ workflow })).toEqual([
      "`jobs.compile` runs a step in a `working-directory`, which could install or build outside the root project it restored",
      "`jobs.compile` has no step whose whole `run:` is `yarn build` — would run NOWHERE without this entry — no workflow, no hook, not `yarn validate` — while the required check is named `build`",
    ]);
  });

  it("does not accept a command buried in a block that could exit first", () => {
    const workflow = goodWorkflow();
    workflow.jobs["typecheck"]!["steps"] = [
      ...prelude({ fetch: false, writer: true }),
      { run: "exit 0\nyarn typecheck" },
    ];
    expect(lines({ workflow })).toEqual([
      "`jobs.typecheck` has no step whose whole `run:` is `yarn typecheck` — off the developer machine by the owner's rule; CI is the only place it runs",
      "`jobs.typecheck` runs `exit 0`, which is neither a whole pinned setup step nor one of its own commands with only a name, and could hand the next step an environment",
    ]);
  });

  it("names every command of a worker that is gone, and the need that now points at nothing", () => {
    const workflow = goodWorkflow();
    delete workflow.jobs["unit"];
    expect(lines({ workflow })).toEqual([
      "`yarn test:unit:merge` runs nowhere: `jobs.unit` or its steps list is missing — rebuilds the WHOLE lane's coverage from every shard's report, refusing an inexact set",
      "`yarn coverage:ratchet` runs nowhere: `jobs.unit` or its steps list is missing — the MEASURED coverage half, which needs the merged report",
      "`jobs.unit` does not open with the pinned runner-facts step (RUNNER_FACTS_STEP)",
    ]);
  });

  it("names a coverage floor that runs before the report it reads", () => {
    const workflow = goodWorkflow();
    workflow.jobs["unit"]!["steps"] = [
      ...prelude({ fetch: true }),
      { run: "yarn coverage:ratchet" },
      { run: "yarn test:unit:merge" },
    ];
    expect(lines({ workflow })).toEqual([
      "`jobs.unit` runs `yarn test:unit:merge` and `yarn coverage:ratchet` out of declared order",
    ]);
  });

  it("names a proof step that could fail without failing its job", () => {
    const workflow = goodWorkflow();
    workflow.jobs["subprocess"]!["steps"] = [
      ...prelude({ fetch: false }),
      { "continue-on-error": true, run: "yarn test:subprocess" },
    ];
    expect(lines({ workflow })).toEqual([
      "the `yarn test:subprocess` step in `jobs.subprocess` sets `continue-on-error`, which can let it fail without failing the job",
      "`jobs.subprocess` runs `yarn test:subprocess`, which is neither a whole pinned setup step nor one of its own commands with only a name, and could hand the next step an environment",
    ]);
  });

  it("names a worker skipped by `if:`, whose skipped result would otherwise stand beside a passing verdict", () => {
    const workflow = goodWorkflow();
    workflow.jobs["typecheck"]!["if"] = "github.event_name == 'pull_request'";
    expect(lines({ workflow })).toEqual([
      "`jobs.typecheck` sets `if`, which can stop its failure — or its running at all — reaching `build`",
    ]);
  });

  // A counterexample. `actions/checkout` defaults to the event's own ref, so naming one
  // is how a worker passes over a tree nobody proposed.
  it("names a worker that checks out a named ref rather than the event's own tree", () => {
    const workflow = goodWorkflow();
    workflow.jobs["typecheck"]!["steps"] = [
      { ...RUNNER_FACTS_STEP },
      { uses: "actions/checkout@v4", with: { ref: "main" } },
      ...install({ writer: true }),
      { run: "yarn typecheck" },
    ];
    expect(lines({ workflow })).toEqual([
      "`jobs.typecheck` runs a step before its install that is not pinned setup, which could keep the install from running",
      "`jobs.typecheck` checks out a named ref or repository, so a green lap says nothing about the event's own tree",
    ]);
  });

  // The two spellings the Codex review walked past a matcher that compared the string as written. An empty
  // subpath still resolves to the same action, so this is caught as the named-ref checkout it is.
  it("reads a subpath spelling as the same action, so a second checkout of a ref is still caught", () => {
    const workflow = goodWorkflow();
    workflow.jobs["typecheck"]!["steps"] = [
      { ...RUNNER_FACTS_STEP },
      { uses: "actions/checkout@v4" },
      { uses: "Actions/checkout/@v4", with: { ref: "main" } },
      ...install({ writer: true }),
      { run: "yarn typecheck" },
    ];
    expect(lines({ workflow })).toEqual([
      "`jobs.typecheck` runs a step before its install that is not pinned setup, which could keep the install from running",
      "`jobs.typecheck` checks out a named ref or repository, so a green lap says nothing about the event's own tree",
    ]);
  });

  // The closing rule of that family: an action nobody listed cannot appear at all, whatever it is spelled.
  it("refuses an action a worker does not need", () => {
    const workflow = goodWorkflow();
    workflow.jobs["subprocess"]!["steps"] = [
      { ...RUNNER_FACTS_STEP },
      { uses: "actions/checkout@v4" },
      { uses: "some-org/restore-tree@v1" },
      ...install({ writer: false }),
      { run: "yarn test:subprocess" },
    ];
    expect(lines({ workflow })).toEqual([
      "`jobs.subprocess` uses `some-org/restore-tree@v1`, which is not one of actions/checkout or actions/setup-node or actions/cache/restore or actions/cache/save",
      "`jobs.subprocess` runs a step before its install that is not pinned setup, which could keep the install from running",
    ]);
  });

  it("reads a checkout input by what Actions does with it, not by how it was spelled", () => {
    const workflow = goodWorkflow();
    workflow.jobs["typecheck"]!["steps"] = [
      { ...RUNNER_FACTS_STEP },
      { uses: "actions/checkout@v4", with: { REF: "main" } },
      ...install({ writer: true }),
      { run: "yarn typecheck" },
    ];
    expect(lines({ workflow })).toEqual([
      "`jobs.typecheck` runs a step before its install that is not pinned setup, which could keep the install from running",
      "`jobs.typecheck` checks out a named ref or repository, so a green lap says nothing about the event's own tree",
    ]);
  });

  it("refuses a checkout input named through an expression, which reads as no input at all here", () => {
    const workflow = goodWorkflow();
    workflow.jobs["typecheck"]!["steps"] = [
      { ...RUNNER_FACTS_STEP },
      { uses: "actions/checkout@v4", with: { "${{ 'ref' }}": "main" } },
      ...install({ writer: true }),
      { run: "yarn typecheck" },
    ];
    expect(lines({ workflow })).toEqual([
      "`jobs.typecheck` runs a step before its install that is not pinned setup, which could keep the install from running",
      "`jobs.typecheck` checks out a named ref or repository, so a green lap says nothing about the event's own tree",
    ]);
  });

  it("names a worker that checks nothing out at all", () => {
    const workflow = goodWorkflow();
    workflow.jobs["subprocess"]!["steps"] = [
      { ...RUNNER_FACTS_STEP },
      ...install({ writer: false }),
      { run: "yarn test:subprocess" },
    ];
    expect(lines({ workflow })).toEqual([
      "`jobs.subprocess` checks nothing out, so what it ran on is not the event's tree",
    ]);
  });

  // A second counterexample: pinning the verdict step's shell left every
  // worker inheriting a workflow-level one. Both steps of that same idea are tested, so a future edit that
  // relaxes either half has a failing witness.
  it("refuses a workflow-level `defaults`, which every command step would inherit a shell from", () => {
    const workflow: Record<string, unknown> = {
      ...goodWorkflow(),
      defaults: { run: { shell: "bash -c 'exit 0' {0}" } },
    };
    expect(lines({ workflow })).toEqual([
      ".github/workflows/ci.yml declares a workflow-level `defaults`, which every step inherits — a `defaults.run.shell` that never substitutes `{0}` runs no offloaded command at all",
    ]);
  });

  it("names an aggregator whose own `defaults` could replace its verdict's shell", () => {
    const workflow = goodWorkflow();
    workflow.jobs["build"]!["defaults"] = { run: { shell: "bash -c 'exit 0' {0}" } };
    expect(lines({ workflow })).toEqual([
      "`jobs.build` sets `defaults`, which can stop its verdict being the one the ruleset reads",
    ]);
  });

  it("refuses an expression-valued env on any worker, not only the two carrying the coverage base", () => {
    const workflow = goodWorkflow();
    workflow.jobs["typecheck"]!["env"] = '${{ fromJSON(\'{"EXAMPLE":"value"}\') }}';
    expect(lines({ workflow })).toEqual([
      "`jobs.typecheck` carries an `env` this gate cannot read literally",
      '`jobs.typecheck` sets `${{ fromJSON(\'{"EXAMPLE":"value"}\') }}` in an `env`, outside ENV_KEYS (ciEnvKeys.ts), which could change what a pinned command does before it runs — `BASH_ENV` and `NODE_OPTIONS` among them',
    ]);
  });

  it("reads text that is not YAML as UNEVALUATED, so no policy refusal is rendered over it", () => {
    expect(offloadContractFindings({ text: "jobs:\n  build:\n   - bad\n  indent" })).toEqual([
      expect.objectContaining({ unevaluated: true }),
    ]);
  });

  it("reads a document with no jobs map as UNEVALUATED", () => {
    expect(offloadContractFindings({ text: "name: CI\n" })).toEqual([
      { line: ".github/workflows/ci.yml has no `jobs` map to read", unevaluated: true },
    ]);
  });
});

describe("aggregatorFindings", () => {
  it("names a `build` that no longer exists", () => {
    const workflow = goodWorkflow();
    delete workflow.jobs["build"];
    expect(aggregatorFindings({ workflow }).map((f) => f.line)).toEqual([
      "`jobs.build` is gone, so the required context no longer reports the laps at all",
    ]);
  });

  it("names a `build` that dropped `always()`, the edit that turns a red leg into a green verdict", () => {
    const workflow = goodWorkflow();
    delete workflow.jobs["build"]!["if"];
    expect(aggregatorFindings({ workflow }).map((f) => f.line)).toEqual([
      "`jobs.build` is not `if: ${{ always() }}` — a failed leg would SKIP it, and skipped reads as passing",
    ]);
  });

  it("names a missing need", () => {
    const workflow = goodWorkflow();
    workflow.jobs["build"]!["needs"] = ["lint", "typecheck", "unit"];
    expect(aggregatorFindings({ workflow }).map((f) => f.line)).toEqual([
      `\`jobs.build.needs\` is [lint, typecheck, unit], not exactly the workers [${SORTED_WORKERS}]`,
    ]);
  });

  it("names a verdict that only rejects `failure`, which admits a cancelled or skipped leg", () => {
    const workflow = goodWorkflow();
    workflow.jobs["build"]!["steps"] = [
      { ...verdictStep(), env: { ALL_SUCCEEDED: "${{ !contains(needs.*.result, 'failure') }}" } },
    ];
    expect(aggregatorFindings({ workflow }).map((f) => f.line)).toEqual([
      `the \`build\` verdict's \`env\` is not exactly ALL_SUCCEEDED: \`${VERDICT}\` — a leg it omits cannot redden it`,
    ]);
  });

  // A second variable, even one ENV_KEYS allows elsewhere, is not the verdict's.
  it("names a verdict carrying any variable beside ALL_SUCCEEDED", () => {
    const workflow = goodWorkflow();
    workflow.jobs["build"]!["steps"] = [{ ...verdictStep(), env: { ALL_SUCCEEDED: VERDICT, MIN_TOTAL_MIB: 1 } }];
    expect(aggregatorFindings({ workflow }).map((f) => f.line)).toEqual([
      `the \`build\` verdict's \`env\` is not exactly ALL_SUCCEEDED: \`${VERDICT}\` — a leg it omits cannot redden it`,
    ]);
  });

  it("names a verdict run line that was loosened", () => {
    const workflow = goodWorkflow();
    workflow.jobs["build"]!["steps"] = [{ ...verdictStep(), run: "true" }];
    expect(aggregatorFindings({ workflow }).map((f) => f.line)).toEqual([VERDICT_STEP_FINDING]);
  });

  // A counterexample against this gate's own property, and the reason `shell` is pinned
  // rather than merely banned: a `shell:` value is a TEMPLATE, so one that never substitutes `{0}` runs the
  // shell and not the script, leaving `run`, `if`, `env` and `needs` untouched and `build` green over a red
  // leg.
  it("names a verdict whose shell never runs the verdict script", () => {
    const workflow = goodWorkflow();
    workflow.jobs["build"]!["steps"] = [{ ...verdictStep(), shell: "bash -c 'exit 0' {0}" }];
    expect(aggregatorFindings({ workflow }).map((f) => f.line)).toEqual([VERDICT_STEP_FINDING]);
  });

  it("names a second step, which could interfere with the verdict", () => {
    const workflow = goodWorkflow();
    const steps = workflow.jobs["build"]!["steps"] as unknown[];
    workflow.jobs["build"]!["steps"] = [...steps, { run: "echo after" }];
    expect(aggregatorFindings({ workflow }).map((f) => f.line)).toEqual([
      "`jobs.build` must have exactly one step, the verdict — anything else can interfere with it",
    ]);
  });

  it("names a renamed check, which the ruleset would never see arrive", () => {
    const workflow = goodWorkflow();
    workflow.jobs["build"]!["name"] = "verdict";
    expect(aggregatorFindings({ workflow }).map((f) => f.line)).toEqual([
      "`jobs.build` renames its check, which the ruleset still requires as `build`",
    ]);
  });
});

describe("runnerFactsFindings", () => {
  const withFirstStep = ({ step }: { step: Record<string, unknown> }): ReturnType<typeof goodWorkflow> => {
    const workflow = goodWorkflow();
    for (const job of workerJobs()) {
      const steps = workflow.jobs[job]!["steps"] as Record<string, unknown>[];
      workflow.jobs[job]!["steps"] = [step, ...steps.slice(1)];
    }
    return workflow;
  };

  it("names a worker whose first step drifted from the pinned one", () => {
    const workflow = goodWorkflow();
    workflow.jobs["subprocess"]!["steps"] = [{ run: 'echo "environment: skipped"' }, { run: "yarn test:subprocess" }];
    expect(runnerFactsFindings({ workflow }).map((f) => f.line)).toEqual([
      "`jobs.subprocess` does not open with the pinned runner-facts step (RUNNER_FACTS_STEP)",
    ]);
  });

  it("refuses a shared step that names RUNNER_ENVIRONMENT but refuses nothing", () => {
    const workflow = withFirstStep({ step: { ...RUNNER_FACTS_STEP, run: "echo RUNNER_ENVIRONMENT\n" } });
    expect(runnerFactsFindings({ workflow })).toHaveLength(workerJobs().length);
  });

  it("refuses a shared step whose refusal a leading exit 0 never reaches", () => {
    const workflow = withFirstStep({ step: { ...RUNNER_FACTS_STEP, run: `exit 0\n${RUNNER_FACTS_STEP.run}` } });
    expect(runnerFactsFindings({ workflow })).toHaveLength(workerJobs().length);
  });

  it("refuses a shared step that could be skipped, or whose env sources a file first", () => {
    expect(
      runnerFactsFindings({ workflow: withFirstStep({ step: { ...RUNNER_FACTS_STEP, "continue-on-error": true } }) }),
    ).toHaveLength(workerJobs().length);
    const env = { ...RUNNER_FACTS_STEP.env, BASH_ENV: "/tmp/pass.sh" };
    // Each worker is named twice: its first step drifted, and that step's `env` sets a key outside ENV_KEYS.
    expect(runnerFactsFindings({ workflow: withFirstStep({ step: { ...RUNNER_FACTS_STEP, env } }) })).toHaveLength(
      workerJobs().length * 2,
    );
  });

  it("names a job or workflow env outside ENV_KEYS, and a workflow env it cannot read", () => {
    const workflow = { ...goodWorkflow(), env: { BASH_ENV: "/tmp/pass.sh" } };
    workflow.jobs["typecheck"]!["env"] = { NODE_OPTIONS: "--import=data:text/javascript,process.exit(0)" };
    expect(runnerFactsFindings({ workflow: { ...goodWorkflow(), env: "${{ fromJSON(vars.ENV) }}" } })).toEqual([
      {
        line: "the workflow `env` sets `${{ fromJSON(vars.ENV) }}` in an `env`, outside ENV_KEYS (ciEnvKeys.ts), which could change what a pinned command does before it runs — `BASH_ENV` and `NODE_OPTIONS` among them",
      },
    ]);
    expect(runnerFactsFindings({ workflow }).map((f) => f.line)).toEqual([
      "the workflow `env` sets `BASH_ENV` in an `env`, outside ENV_KEYS (ciEnvKeys.ts), which could change what a pinned command does before it runs — `BASH_ENV` and `NODE_OPTIONS` among them",
      "`jobs.typecheck` sets `NODE_OPTIONS` in an `env`, outside ENV_KEYS (ciEnvKeys.ts), which could change what a pinned command does before it runs — `BASH_ENV` and `NODE_OPTIONS` among them",
    ]);
  });

  // A key written as an expression is that variable on the runner.
  it("names a job or workflow env with a key written as an expression", () => {
    const workflow = { ...goodWorkflow(), env: { "${{ 'BASH_ENV' }}": "/tmp/pass.sh" } };
    workflow.jobs["lint"]!["env"] = { ...workflow.jobs["lint"]!["env"]!, "${{ 'BASH_ENV' }}": "/tmp/pass.sh" };
    expect(runnerFactsFindings({ workflow }).map((f) => f.line)).toEqual([
      "the workflow `env` sets `${{ 'BASH_ENV' }}` in an `env`, outside ENV_KEYS (ciEnvKeys.ts), which could change what a pinned command does before it runs — `BASH_ENV` and `NODE_OPTIONS` among them",
      "`jobs.lint` sets `${{ 'BASH_ENV' }}` in an `env`, outside ENV_KEYS (ciEnvKeys.ts), which could change what a pinned command does before it runs — `BASH_ENV` and `NODE_OPTIONS` among them",
    ]);
  });

  // A container wraps every step. A `run` writing `$GITHUB_ENV` is `workerRunFindings`' to refuse.
  it("names a worker in a container, and one whose step env sets a key outside ENV_KEYS", () => {
    const workflow = goodWorkflow();
    workflow.jobs["lint"]!["container"] = { env: { BASH_ENV: "/tmp/pass.sh" }, image: "example/image" };
    workflow.jobs["compile"]!["steps"] = [
      ...(workflow.jobs["compile"]!["steps"] as Record<string, unknown>[]),
      { env: { BASH_ENV: "/tmp/pass.sh" }, run: "yarn build" },
    ];
    expect(runnerFactsFindings({ workflow }).map((f) => f.line)).toEqual([
      "`jobs.compile` sets `BASH_ENV` in an `env`, outside ENV_KEYS (ciEnvKeys.ts), which could change what a pinned command does before it runs — `BASH_ENV` and `NODE_OPTIONS` among them",
      "`jobs.lint` runs in a `container`, whose image and `env` wrap its runner-facts step",
    ]);
  });

  it("passes the real ci.yml", () => {
    const text = readFileSync(join(repoRootOf({ importMetaUrl: import.meta.url }), CI_WORKFLOW_PATH), "utf8");
    expect(runnerFactsFindings({ workflow: parse(text) })).toEqual([]);
  });
});

// The ratchet job's base comparison left with it, and so did the case naming a ratchet job that lost its base
// or its fetch.
// deleted-with-code: ciRatchetBaselinesAgainstMain
describe("coverageBaseFindings", () => {
  it("names a job that lost its base, which would otherwise skip the comparison without failing", () => {
    const workflow = goodWorkflow();
    delete workflow.jobs["lint"]!["env"];
    expect(coverageBaseFindings({ workflow }).map((f) => f.line)).toEqual([
      "`jobs.lint` does not name the one `SLOPWEAVER_COVERAGE_BASE_SHA` expression, so its comparison against the base is silently skipped",
      "lint, unit name different `SLOPWEAVER_COVERAGE_BASE_SHA` bases",
    ]);
  });

  // The same class one rung up, and why the expression is pinned rather than merely required: the job's own
  // env could carry the zero sha, which the coverage floor reads as "no base" and passes.
  it("names a job-level base that is a literal rather than the one expression", () => {
    const workflow = goodWorkflow();
    const zeros = "0000000000000000000000000000000000000000";
    workflow.jobs["lint"]!["env"] = { SLOPWEAVER_COVERAGE_BASE_SHA: zeros };
    workflow.jobs["unit"]!["env"] = { SLOPWEAVER_COVERAGE_BASE_SHA: zeros };
    expect(coverageBaseFindings({ workflow }).map((f) => f.line)).toEqual([
      "`jobs.lint` does not name the one `SLOPWEAVER_COVERAGE_BASE_SHA` expression, so its comparison against the base is silently skipped",
      "`jobs.unit` does not name the one `SLOPWEAVER_COVERAGE_BASE_SHA` expression, so its comparison against the base is silently skipped",
    ]);
  });

  // A counterexample: a step's env outranks its job's, and the ratchet reads the zero sha as
  // "no base" and passes, so this one skips both comparisons while every other shape still reads correct.
  it("names a step-level base override, which outranks the job's own", () => {
    const workflow = goodWorkflow();
    workflow.jobs["lint"]!["steps"] = [
      ...prelude({ fetch: true }),
      { env: { SLOPWEAVER_COVERAGE_BASE_SHA: "0000000000000000000000000000000000000000" }, run: "yarn lint" },
    ];
    expect(coverageBaseFindings({ workflow }).map((f) => f.line)).toEqual([STEP_ENV_FINDING]);
  });

  // The same class again, and the last rung: an `env:` written as an expression is a string to YAML and a
  // map to Actions, so reading only records would have missed `${{ fromJSON('{"…":"0000…"}') }}`.
  it("names a step env written as an expression, which YAML reads as a string and Actions as a map", () => {
    const workflow = goodWorkflow();
    workflow.jobs["lint"]!["steps"] = [
      ...prelude({ fetch: true }),
      { env: '${{ fromJSON(\'{"SLOPWEAVER_COVERAGE_BASE_SHA":"0"}\') }}', run: "yarn lint" },
    ];
    expect(coverageBaseFindings({ workflow }).map((f) => f.line)).toEqual([STEP_ENV_FINDING]);
  });

  it("names the same expression KEY one level up, on the job's own env", () => {
    const workflow = goodWorkflow();
    workflow.jobs["lint"]!["env"] = {
      SLOPWEAVER_COVERAGE_BASE_SHA: BASE,
      "${{ 'SLOPWEAVER_COVERAGE_BASE_SHA' }}": "0000000000000000000000000000000000000000",
    };
    expect(coverageBaseFindings({ workflow }).map((f) => f.line)).toEqual([STEP_ENV_FINDING]);
  });

  it("names a step env KEY written as an expression, which reads as an unrelated key here", () => {
    const workflow = goodWorkflow();
    workflow.jobs["lint"]!["steps"] = [
      ...prelude({ fetch: true }),
      { env: { "${{ 'SLOPWEAVER_COVERAGE_BASE_SHA' }}": "0" }, run: "yarn lint" },
    ];
    expect(coverageBaseFindings({ workflow }).map((f) => f.line)).toEqual([STEP_ENV_FINDING]);
  });

  it("names a fetch that runs before checkout, where there is no repository to fetch into", () => {
    const workflow = goodWorkflow();
    workflow.jobs["unit"]!["steps"] = [
      { ...RUNNER_FACTS_STEP },
      { run: FETCH },
      { uses: "actions/checkout@v4" },
      { run: "yarn test:unit:merge" },
      { run: "yarn coverage:ratchet" },
    ];
    expect(coverageBaseFindings({ workflow }).map((f) => f.line)).toEqual([
      "`jobs.unit` does not fetch the base after checkout, so its comparison against the base is silently skipped",
    ]);
  });
});

describe("this repository's real workflow", () => {
  const text = readFileSync(join(repoRootOf({ importMetaUrl: import.meta.url }), CI_WORKFLOW_PATH), "utf8");

  it("holds the whole contract, as shipped", () => {
    expect(offloadContractFindings({ text })).toEqual([]);
  });

  it("gives `build` every worker as its only needs, so the lap's wall time is the slowest leg", () => {
    expect(jobOf({ job: "build", workflow: parse(text) })!["needs"]).toEqual(WORKERS);
  });
});

// The save step's condition is never true without the push it rides.
describe("the cache writer's push trigger", () => {
  it("names a workflow whose push to main is gone or filtered", () => {
    const problem =
      'the workflow\'s `on.push` is not exactly {"branches":["main"]}, so `jobs.typecheck` could never save the dependency cache';
    const gone = goodWorkflow();
    gone.on = {};
    const filtered = goodWorkflow();
    filtered.on = { push: { branches: ["main"], paths: ["docs/**"] } };
    expect([gone, filtered].map((workflow) => lines({ workflow }))).toEqual([[problem], [problem]]);
  });
});

describe("a worker's own check name", () => {
  it("names a worker renamed in the rollup, which no reader can map back to a job", () => {
    const workflow = goodWorkflow();
    workflow.jobs["typecheck"]!["name"] = "renamed-typecheck";
    expect(offloadContractFindings({ text: stringify(workflow) }).map((f) => f.line)).toEqual([
      "`jobs.typecheck` renames its check to `renamed-typecheck`, which no reader can map back",
    ]);
  });
});

describe("a job added to ci.yml outside build.needs", () => {
  it("names a new job no register mentions, which could go red while the required `build` stays green", () => {
    const workflow = goodWorkflow();
    workflow.jobs["e2e"] = {
      "runs-on": RUNNER_SELECTOR,
      steps: [...prelude({ fetch: false }), { run: "yarn test:e2e" }],
    };
    expect(lines({ workflow })).toEqual([
      "`jobs.e2e` is outside `jobs.build.needs` and on no exclusion list, so it can go red while the required `build` check stays green",
    ]);
  });
});

describe("build.needs, read as a list rather than as text", () => {
  it("names one comma-joined string, which joins to the same text as the six real needs", () => {
    const workflow = goodWorkflow();
    workflow.jobs["build"]!["needs"] = ["compile,desktop,lint,subprocess,typecheck,unit"];
    expect(aggregatorFindings({ workflow }).map((f) => f.line)).toEqual([
      `\`jobs.build.needs\` is [compile,desktop,lint,subprocess,typecheck,unit], not exactly the workers [${SORTED_WORKERS}]`,
    ]);
  });
});
