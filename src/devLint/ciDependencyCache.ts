/**
 * The installed-dependency cache a `ci.yml` worker may restore, the one job that may write it, and the one
 * shape both take.
 *
 * MEASURED on three laps (`slopweaver github ci-runs --branch ci-perf-investigation
 * --event pull_request --runs 3 --steps`): `yarn install --immutable` took 0:41 in every one of the fourteen
 * jobs that install the root project, about a third of every runner-second a lap spends, on a runner pool
 * that already queued those jobs for 1:10 waiting on each other. A restored `node_modules` measured 0:10 to
 * restore and 0:12 to install over.
 *
 * A cache entry is unsigned content this run did not install, and it holds the very tools every later step
 * runs, so who may write one is what is pinned, not only how it is read:
 *
 * - **One job writes, and only on a `push` to `main`.** A pull request's entry is readable by that pull
 *   request alone and a merge group's by that queue ref alone, so writing from either spends the repository's
 *   cache quota on entries nothing reuses, and lets a pull request's own tree become the entry. Fourteen
 *   writers would also race for one immutable key with a timing-dependent winner.
 * - **An entry is always a cold install.** There are no `restore-keys`, so a miss restores nothing, and the
 *   writer saves only on a miss, straight after the install, before any command could write into it.
 * - **An entry carries Yarn's package archives** (`~/.yarn/berry/cache`, the global cache `enableGlobalCache`
 *   defaults to) beside `node_modules`, because Yarn fetches a package whenever its archive is absent, whatever
 *   the installed tree holds. MEASURED on the entry that held no archives: every job on a hit printed
 *   `YN0013: 953 packages were added to the project (+ 2.02 GiB)` — a registry download per job, which one
 *   `write ECONNRESET` failed (desktop-e2e, job 140394290086). Re-read it with `slopweaver github run-log
 *   <run-id> --job lint --from "Fetch step"`. The hardlink store (`~/.yarn/berry/store`) stays out: on an
 *   unchanged layout the linker reads `node_modules/.yarn-state.yml` and links nothing. Hardened mode on a public
 *   pull request still queries registry metadata; it downloads no archive.
 * - **The key names every file the install reads**, behind a schema salt a change of this shape bumps:
 *   the Node pin, the Yarn config and plugins, the manifest, the lockfile and the portal stubs' manifests.
 * - **The install still runs** over a restored tree, so a lockfile the tree does not satisfy fails the job.
 *   It checks resolution, not the restored bytes, which is why the writer is the thing held to account. The
 *   install step carries no `shell`, `if`, `continue-on-error`, `env` or `working-directory`, so it cannot be an
 *   install in name only.
 * - **A cache step cannot fail quietly.** Neither restore nor save carries `continue-on-error`, and a restoring
 *   job runs no step in a `working-directory`, so its install and build are the root project's.
 * - **Every job restores but three, named.** `build`, `site` and `desktop` install cold, each held to its pinned
 *   steps in {@link COLD_JOB_RUNS}; no reading of shell text can say which jobs need the root project.
 * - **The writer is an offload worker**, so its first step is the runner-facts assertion, which fails any
 *   runner that is not GitHub-hosted. A GitHub-hosted runner is a fresh machine per job, so no Yarn store a
 *   pull request's job linked into (`nmMode: hardlinks-global`) survives to be linked into the writer's install.
 *
 * This is a tripwire against drift, not a fence against a committer to `main`: one who can write a step
 * before the restore that fills `node_modules` can equally edit this file, and review of `ci.yml` is what
 * holds that line.
 */
import { isDeepStrictEqual } from "node:util";

import { isRecord } from "../lib/parsers.js";
import { OFFLOAD_JOB, workerJobs } from "./ciOffloadCommands.js";
import { RUNNER_FACTS_STEP } from "./ciRunnerFacts.js";
import { isSetupStep } from "./ciWorkerRuns.js";
import { actionOf, jobOf, type OffloadFinding, presentKeys, runOf, stepsOf } from "./ciWorkflowRead.js";

/** The two cache actions a worker may use, as `owner/repo/path` with no version. */
export const DEPENDENCY_CACHE_ACTIONS: readonly string[] = ["actions/cache/restore", "actions/cache/save"];

/** The one worker that saves the cache: it runs on every event, `push` included, and is never sharded. */
export const CACHE_WRITER_JOB = "typecheck";

/** The combined action, which saves in its post step whatever the job left in the path — refused everywhere. */
const COMBINED_CACHE_ACTION = "actions/cache";

/** The install the restore must sit directly before, and the save directly after. */
const INSTALL = "yarn install --immutable";

/** What the install step may not carry, each of which could let it pass without installing. */
const INSTALL_UNSAFE_KEYS: readonly string[] = ["shell", "if", "continue-on-error", "env", "working-directory"];

/**
 * The jobs that install cold, and the `run` steps each carries with their `working-directory`, pinned whole and
 * in order: no more, no fewer. A step marked `elsewhere` has its other keys pinned by the gate it names; every
 * other step carries none of {@link INSTALL_UNSAFE_KEYS} beyond its directory. Every
 * other job restores. Which jobs use the root project's packages is not read from shell text, which Codex beat
 * five ways (a comment, a continuation, a name built at run time, an expression, `cd ..`): a job is cold only
 * by being named here, in a reviewed diff. `site` and `desktop` install their own lockfiles; `build` installs
 * nothing.
 */
export const COLD_JOB_RUNS: Readonly<
  Record<string, readonly { readonly directory?: string; readonly elsewhere?: string; readonly run: string }[]>
> = {
  build: [{ elsewhere: "the aggregator verdict in ciOffloadContract.ts", run: 'test "$ALL_SUCCEEDED" = "true"' }],
  desktop: [
    { elsewhere: "RUNNER_FACTS_STEP in ciRunnerFacts.ts", run: RUNNER_FACTS_STEP.run },
    { run: "corepack enable" },
    { directory: "desktop", run: "yarn install --immutable" },
    { directory: "desktop", run: "yarn build" },
  ],
  site: [
    { elsewhere: "RUNNER_FACTS_STEP in ciRunnerFacts.ts", run: RUNNER_FACTS_STEP.run },
    { run: "corepack enable" },
    { directory: "site", run: "yarn install --immutable" },
    { directory: "site", run: "yarn test:nextra-patch" },
    { directory: "site", run: "yarn build" },
  ],
};

/** The actions a cold job may use, each only as its whole `SETUP_STEPS` entry: neither installs the root project. */
const COLD_JOB_ACTIONS: ReadonlySet<string> = new Set(["actions/checkout", "actions/setup-node"]);

/** The restore step's id, which the save step's condition reads. */
const RESTORE_ID = "deps";

/**
 * The exact `with:` both cache steps carry: the installed tree, Yarn's install state and Yarn's package archives.
 * The key's `node-modules-vN` prefix is the schema salt, bumped whenever what an entry holds changes shape.
 */
export const DEPENDENCY_CACHE_INPUTS: Readonly<Record<string, unknown>> = {
  key: "node-modules-v2-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('.nvmrc', '.yarnrc.yml', '.yarn/plugins/**', 'package.json', 'yarn.lock', 'stubs/*/package.json') }}",
  path: "node_modules\n.yarn/install-state.gz\n~/.yarn/berry/cache\n",
};

/**
 * The writer's save condition: a `push` to `main` that missed, so an entry is only ever a cold install on a
 * trusted ref. The ref is in the condition itself rather than left to the workflow's branch filter.
 */
export const SAVE_CONDITION = `github.event_name == 'push' && github.ref == 'refs/heads/main' && steps.${RESTORE_ID}.outputs.cache-hit != 'true'`;

/**
 * The `push` trigger the writer's save rides, whole: every push to `main`, with no path or tag filter that could
 * leave a new key unwritten. Without it the save step's condition is never true and every job installs cold
 * with every check still green. `ci-trigger-contract` does not read `push:`.
 */
const SAVE_TRIGGER: Readonly<Record<string, unknown>> = { branches: ["main"] };

/**
 * Whether the workflow still carries {@link SAVE_TRIGGER}, exactly.
 *
 * @param workflow the parsed workflow document
 * @returns one finding when the `push` trigger is missing or reshaped, else none
 */
export function saveTriggerFindings({ workflow }: { workflow: unknown }): readonly OffloadFinding[] {
  const on = isRecord(workflow) ? workflow["on"] : undefined;
  return isRecord(on) && isDeepStrictEqual(on["push"], SAVE_TRIGGER)
    ? []
    : [
        {
          line: `the workflow's \`on.push\` is not exactly ${JSON.stringify(SAVE_TRIGGER)}, so \`jobs.${CACHE_WRITER_JOB}\` could never save the dependency cache`,
        },
      ];
}

/**
 * Judge EVERY job's cache steps against the one shape above — not only the offload workers, because a job
 * outside that list (`integration`, `ci-timing`) could otherwise write an entry every later run restores.
 *
 * @param workflow the parsed workflow document
 * @returns one finding per job whose cache steps are out of shape or unreadable
 */
export function dependencyCacheFindings({ workflow }: { workflow: unknown }): readonly OffloadFinding[] {
  const jobs = isRecord(workflow) && isRecord(workflow["jobs"]) ? Object.keys(workflow["jobs"]) : [];
  return jobs.flatMap((job): OffloadFinding[] => {
    const entry = jobOf({ job, workflow });
    if (entry === undefined) {
      return [{ line: `\`jobs.${job}\` is not a map the gate can read, so its cache steps went unjudged` }];
    }
    // A reusable-workflow call has no `steps` here: its cache steps live in a file this gate does not read.
    const steps = stepsOf({ job: entry });
    if (steps === undefined) {
      return [
        {
          line: `\`jobs.${job}\` has no \`steps\` list the gate can read, so its cache steps went unjudged: inline a reusable workflow's steps`,
        },
      ];
    }
    const problems = [...cacheShapeProblems({ job, steps }), ...jobEnvProblems({ entry, job })];
    return problems.map((problem) => ({ line: `\`jobs.${job}\` ${problem}` }));
  });
}

/**
 * What in a job that is not an offload worker could wrap its install — a `container` — or pass it green over a
 * failed restore: a job `continue-on-error`, or `defaults` every step inherits (`shell: true
 * {0}` makes the install a no-op). A worker is held to the same by `ciRunnerFacts.ts` and `ciOffloadContract.ts`,
 * and every `env` in the workflow by `ciEnvKeys.ts`.
 *
 * @param entry the job map
 * @param job the job's name
 * @returns one sentence per problem, each finishing the job's name
 */
function jobEnvProblems({ entry, job }: { entry: Record<string, unknown>; job: string }): string[] {
  if (workerJobs().includes(job)) {
    return [];
  }
  // The aggregator's `continue-on-error` and `defaults` are refused by `ciOffloadContract.ts`, for its verdict.
  const pinnedElsewhere = job === OFFLOAD_JOB;
  return [
    ...("container" in entry ? ["runs in a `container`, whose image and `env` wrap its install"] : []),
    ...("continue-on-error" in entry && !pinnedElsewhere
      ? ["has a job `continue-on-error`, which could pass it green over a failed restore or install"]
      : []),
    ...("defaults" in entry && !pinnedElsewhere
      ? ["has job `defaults`, whose `shell` or `working-directory` every step inherits, its install among them"]
      : []),
  ];
}

/**
 * What is wrong with one job's cache steps, if anything. A job may install cold only as a {@link COLD_JOB_RUNS}
 * entry: any other job that stops restoring, or a writer that stops saving, would lose the cache silently.
 *
 * @param job the job's name, which decides whether it writes, and whether it may install cold
 * @param steps the job's steps, in order
 * @returns one sentence per problem, each finishing the job's name
 */
export function cacheShapeProblems({
  job,
  steps,
}: {
  job: string;
  steps: readonly Record<string, unknown>[];
}): readonly string[] {
  const writer = job === CACHE_WRITER_JOB;
  if (indexesOf({ action: COMBINED_CACHE_ACTION, steps }).length > 0) {
    return [
      `must not use \`${COMBINED_CACHE_ACTION}\`, which saves in its post step: restore with \`actions/cache/restore\``,
    ];
  }
  const restores = indexesOf({ action: "actions/cache/restore", steps });
  const saves = indexesOf({ action: "actions/cache/save", steps });
  if (!writer && saves.length > 0) {
    return [`must not save the dependency cache: only \`jobs.${CACHE_WRITER_JOB}\` writes it`];
  }
  if (restores.length === 0 && saves.length === 0) {
    return coldProblems({ job, steps });
  }
  const [restore] = restores;
  if (restores.length !== 1 || restore === undefined || (writer && saves.length !== 1)) {
    return [
      writer
        ? "must restore and save the dependency cache exactly once each: it is the one job that writes it"
        : "must restore the dependency cache exactly once, or not at all",
    ];
  }
  const [save] = saves;
  return [
    ...restoreProblems({ restore, steps }),
    ...(save === undefined ? [] : saveProblems({ restore, save, steps })),
    ...(steps.some((step) => "working-directory" in step)
      ? ["runs a step in a `working-directory`, which could install or build outside the root project it restored"]
      : []),
  ];
}

/**
 * What is wrong with the restore step and the install straight after it.
 *
 * @param restore the restore step's index
 * @param steps the job's steps, in order
 * @returns one sentence per problem, each finishing the job's name
 */
function restoreProblems({ restore, steps }: { restore: number; steps: readonly Record<string, unknown>[] }): string[] {
  const install = steps[restore + 1];
  const problems: string[] = [];
  if (install === undefined || runOf({ step: install }) !== INSTALL) {
    problems.push(`must run \`${INSTALL}\` straight after restoring the dependency cache`);
  } else {
    const unsafe = presentKeys({ keys: INSTALL_UNSAFE_KEYS, map: install });
    if (unsafe.length > 0) {
      problems.push(
        `must run \`${INSTALL}\` with no ${unsafe.map((key) => `\`${key}\``).join(" or ")}, which could pass it without installing`,
      );
    }
  }
  problems.push(...preInstallProblems({ steps: steps.slice(0, restore) }));
  const restoreStep = steps[restore]!;
  if (!isDeepStrictEqual(restoreStep["with"], DEPENDENCY_CACHE_INPUTS)) {
    problems.push(cacheInputsProblem());
  }
  if (restoreStep["id"] !== RESTORE_ID || "if" in restoreStep || "continue-on-error" in restoreStep) {
    problems.push(`must restore unconditionally as \`id: ${RESTORE_ID}\`, with no \`continue-on-error\``);
  }
  return problems;
}

/**
 * What is wrong with the steps a restoring job runs before its install: each must be a whole `SETUP_STEPS` entry
 * (`ciWorkerRuns.ts`). A step there could hand the install a `BASH_ENV` through `$GITHUB_ENV`,
 * from a custom `shell` on a pinned `run` or a `node` from another mirror.
 *
 * @param steps the steps before the restore, in order
 * @returns one sentence per problem, each finishing the job's name
 */
function preInstallProblems({ steps }: { steps: readonly Record<string, unknown>[] }): string[] {
  return steps.some((step) => !isSetupStep({ step }))
    ? ["runs a step before its install that is not pinned setup, which could keep the install from running"]
    : [];
}

/**
 * What is wrong with the writer's save step.
 *
 * @param restore the restore step's index, which the save must sit two after
 * @param save the save step's index
 * @param steps the job's steps, in order
 * @returns one sentence per problem, each finishing the job's name
 */
function saveProblems({
  restore,
  save,
  steps,
}: {
  restore: number;
  save: number;
  steps: readonly Record<string, unknown>[];
}): string[] {
  const saveStep = steps[save]!;
  const problems: string[] = [];
  if (save !== restore + 2) {
    problems.push(
      "must save straight after the install, so an entry is the install's tree and nothing a command wrote",
    );
  }
  if (!isDeepStrictEqual(saveStep["with"], DEPENDENCY_CACHE_INPUTS)) {
    problems.push(cacheInputsProblem());
  }
  if (saveStep["if"] !== SAVE_CONDITION || "continue-on-error" in saveStep) {
    problems.push(`must save only \`if: ${SAVE_CONDITION}\`, with no \`continue-on-error\``);
  }
  return problems;
}

/**
 * What is wrong with a job that neither restores nor saves: nothing, when it is in {@link COLD_JOB_RUNS} and
 * runs exactly its pinned steps, in order. A subset would let a build go missing; an extra
 * step could use the root project cold. The writer, or any other job, would install cold with every check green.
 *
 * @param job the job's name
 * @param steps the job's steps, in order
 * @returns one sentence per problem, each finishing the job's name
 */
function coldProblems({ job, steps }: { job: string; steps: readonly Record<string, unknown>[] }): string[] {
  if (job === CACHE_WRITER_JOB) {
    return ["must restore and save the dependency cache exactly once each: it is the one job that writes it"];
  }
  const pinned = COLD_JOB_RUNS[job];
  if (pinned === undefined) {
    return [
      `must restore the dependency cache straight before its \`${INSTALL}\`: only ${Object.keys(COLD_JOB_RUNS).join(", ")} install cold`,
    ];
  }
  const actionProblems = steps.flatMap((step): string[] => {
    const action = actionOf({ step });
    return action === undefined || (COLD_JOB_ACTIONS.has(action) && isSetupStep({ step }))
      ? []
      : [`uses \`${action}\` other than as a whole pinned setup step, which a job installing cold may not`];
  });
  const runs = steps.filter((step) => actionOf({ step }) === undefined);
  const exact =
    runs.length === pinned.length &&
    runs.every((step, position) => {
      const allowed = pinned[position]!;
      const same = allowed.run.trim() === runOf({ step }) && allowed.directory === step["working-directory"];
      const unsafe = presentKeys({ keys: INSTALL_UNSAFE_KEYS.filter((key) => key !== "working-directory"), map: step });
      return same && (allowed.elsewhere !== undefined || unsafe.length === 0);
    });
  return [
    ...actionProblems,
    ...(exact
      ? []
      : [
          "does not run exactly its pinned cold steps (COLD_JOB_RUNS), in order and with none of their unsafe keys, so it could skip its build or use the root project cold",
        ]),
  ];
}

/**
 * The one sentence for a cache step whose inputs are not the pinned set.
 *
 * @returns the problem, finishing the job's name
 */
function cacheInputsProblem(): string {
  return `passes dependency cache inputs other than ${JSON.stringify(DEPENDENCY_CACHE_INPUTS)}, so a restored tree could be one this run would not have installed`;
}

/**
 * The positions of every step using one action.
 *
 * @param action the action as `owner/repo/path`, no version
 * @param steps the job's steps, in order
 * @returns the indexes, in order
 */
function indexesOf({
  action,
  steps,
}: {
  action: string;
  steps: readonly Record<string, unknown>[];
}): readonly number[] {
  return steps.flatMap((step, index) => (actionOf({ step }) === action ? [index] : []));
}
