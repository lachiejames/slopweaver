import { describe, expect, it } from "vitest";
import {
  CACHE_WRITER_JOB,
  COLD_JOB_RUNS,
  cacheShapeProblems,
  DEPENDENCY_CACHE_INPUTS,
  dependencyCacheFindings,
  SAVE_CONDITION,
} from "../../../devLint/ciDependencyCache.js";
import { workerJobs } from "../../../devLint/ciOffloadCommands.js";

const RESTORE = { id: "deps", uses: "actions/cache/restore@v4", with: DEPENDENCY_CACHE_INPUTS };
const INSTALL = { run: "yarn install --immutable" };
const SAVE = { if: SAVE_CONDITION, uses: "actions/cache/save@v4", with: DEPENDENCY_CACHE_INPUTS };
const CHECKOUT = { uses: "actions/checkout@v7" };
const SETUP_NODE = { uses: "actions/setup-node@v7", with: { "node-version-file": ".nvmrc" } };
const LINT = { run: "yarn lint" };

/** A cold job's pinned `run` steps, each with its directory and no other key. */
const pinned = ({ job }: { job: string }): Record<string, unknown>[] =>
  COLD_JOB_RUNS[job]!.map(({ directory, run }) => ({
    run,
    ...(directory === undefined ? {} : { "working-directory": directory }),
  }));

const INPUTS_PROBLEM = `passes dependency cache inputs other than ${JSON.stringify(DEPENDENCY_CACHE_INPUTS)}, so a restored tree could be one this run would not have installed`;

describe("cacheShapeProblems, for a reader", () => {
  it("accepts a restore straight before the install, with no save", () => {
    expect(cacheShapeProblems({ steps: [CHECKOUT, RESTORE, INSTALL, LINT], job: "lint" })).toEqual([]);
  });

  it("refuses a job outside COLD_JOB_RUNS that does not restore, whatever it runs", () => {
    const problem =
      "must restore the dependency cache straight before its `yarn install --immutable`: only build, desktop, site install cold";
    expect(cacheShapeProblems({ job: "lint", steps: [CHECKOUT, INSTALL, LINT] })).toEqual([problem]);
    expect(cacheShapeProblems({ job: "integration", steps: [CHECKOUT, { run: "echo nothing" }] })).toEqual([problem]);
  });

  it("accepts each cold job running exactly its pinned steps", () => {
    const setup = [CHECKOUT, SETUP_NODE];
    expect(
      ["build", "desktop", "site"].map((job) => cacheShapeProblems({ job, steps: [...setup, ...pinned({ job })] })),
    ).toEqual([[], [], []]);
  });

  // A cold job is named, never inferred from how its shell is spelled.
  it("refuses a cold job running anything beyond its pinned steps, however spelled", () => {
    const problem =
      "does not run exactly its pinned cold steps (COLD_JOB_RUNS), in order and with none of their unsafe keys, so it could skip its build or use the root project cold";
    const extras = [
      INSTALL,
      { ...INSTALL, "working-directory": "." },
      { ...INSTALL, "working-directory": "site/.." },
      { run: "${{ vars.COMMAND }}", "working-directory": "site" },
      { env: { PM: "yarn" }, run: 'corepack "$PM" install --immutable' },
      { run: "cd .. && yarn install", "working-directory": "site" },
      { run: "yarn \\\n install # cold" },
    ];
    expect(
      extras.map((step) => cacheShapeProblems({ job: "site", steps: [CHECKOUT, ...pinned({ job: "site" }), step] })),
    ).toEqual(extras.map(() => [problem]));
    expect(
      cacheShapeProblems({ job: "site", steps: [{ uses: "some-org/install@v1" }, ...pinned({ job: "site" })] }),
    ).toEqual(["uses `some-org/install` other than as a whole pinned setup step, which a job installing cold may not"]);
  });

  // Membership alone let a cold job drop its build, reorder it, or run it as a no-op.
  it("refuses a cold job missing, reordering or hollowing out a pinned step", () => {
    const problem =
      "does not run exactly its pinned cold steps (COLD_JOB_RUNS), in order and with none of their unsafe keys, so it could skip its build or use the root project cold";
    // Named, not positional past the install: a step inserted before the build must not shift `build` onto it.
    const [runnerFacts, corepack, install] = pinned({ job: "site" });
    const witness = pinned({ job: "site" }).find(({ run }) => run === "yarn test:nextra-patch")!;
    const build = pinned({ job: "site" }).find(({ run }) => run === "yarn build")!;
    expect([install!["run"], witness["working-directory"], build["working-directory"]]).toEqual([
      "yarn install --immutable",
      "site",
      "site",
    ]);
    const variants = [
      [CHECKOUT],
      [corepack!, install!, witness, build],
      [runnerFacts!, corepack!, install!, witness],
      [runnerFacts!, corepack!, install!, build],
      [runnerFacts!, corepack!, build, install!, witness],
      [runnerFacts!, corepack!, install!, build, witness],
      [runnerFacts!, corepack!, install!, witness, { ...build, shell: "true {0}" }],
      [runnerFacts!, corepack!, install!, witness, { ...build, "continue-on-error": true }],
      [runnerFacts!, corepack!, install!, { ...witness, shell: "true {0}" }, build],
    ];
    expect(variants.map((steps) => cacheShapeProblems({ job: "site", steps }))).toEqual(variants.map(() => [problem]));
  });

  it("refuses a save, which only the one writer may make", () => {
    expect(cacheShapeProblems({ steps: [RESTORE, INSTALL, SAVE, LINT], job: "lint" })).toEqual([
      "must not save the dependency cache: only `jobs.typecheck` writes it",
    ]);
  });

  it("refuses a restore with no install straight after it", () => {
    expect(cacheShapeProblems({ steps: [CHECKOUT, RESTORE, LINT, INSTALL], job: "lint" })).toEqual([
      "must run `yarn install --immutable` straight after restoring the dependency cache",
    ]);
  });

  // An install in name only, under a shell that never runs it.
  it("refuses an install step carrying a shell, a condition or continue-on-error", () => {
    const fake = { ...INSTALL, "continue-on-error": true, shell: "bash -c 'exit 0' {0}" };
    expect(cacheShapeProblems({ steps: [RESTORE, fake, LINT], job: "lint" })).toEqual([
      "must run `yarn install --immutable` with no `shell` or `continue-on-error`, which could pass it without installing",
    ]);
  });

  // A step before the install, or the install's own env, could source a file before yarn runs.
  it("refuses an unpinned step before the install, and an install carrying an env", () => {
    const handOn = { run: "printf '%s_%s=%s\\n' BASH ENV /tmp/p >> \"$GITHUB_ENV\"" };
    expect(cacheShapeProblems({ job: "integration", steps: [CHECKOUT, handOn, RESTORE, INSTALL] })).toEqual([
      "runs a step before its install that is not pinned setup, which could keep the install from running",
    ]);
    // A pinned `run` under a custom shell, and a `node` from another mirror.
    const shelled = { run: "corepack enable", shell: "bash -c 'echo BASH_ENV=/tmp/p >> $GITHUB_ENV'" };
    const mirrored = { ...SETUP_NODE, with: { mirror: "https://example.test", "node-version": "24" } };
    expect(
      [shelled, mirrored].map((step) => cacheShapeProblems({ job: "integration", steps: [step, RESTORE, INSTALL] })),
    ).toEqual([
      ["runs a step before its install that is not pinned setup, which could keep the install from running"],
      ["runs a step before its install that is not pinned setup, which could keep the install from running"],
    ]);
    expect(cacheShapeProblems({ job: "site", steps: [mirrored, ...pinned({ job: "site" })] })).toEqual([
      "uses `actions/setup-node` other than as a whole pinned setup step, which a job installing cold may not",
    ]);
    const install = { ...INSTALL, env: { BASH_ENV: "/tmp/p" } };
    expect(cacheShapeProblems({ job: "integration", steps: [CHECKOUT, RESTORE, install] })).toEqual([
      "must run `yarn install --immutable` with no `env`, which could pass it without installing",
    ]);
  });

  it("refuses a second restore", () => {
    expect(cacheShapeProblems({ steps: [RESTORE, INSTALL, RESTORE, LINT], job: "lint" })).toEqual([
      "must restore the dependency cache exactly once, or not at all",
    ]);
  });

  it("refuses a restore key with a fallback, which could restore a tree this run would not install", () => {
    const loose = { ...RESTORE, with: { ...DEPENDENCY_CACHE_INPUTS, "restore-keys": "node-modules-" } };
    expect(cacheShapeProblems({ steps: [loose, INSTALL], job: "lint" })).toEqual([INPUTS_PROBLEM]);
  });

  // A restore that may fail quietly leaves every job on the slow path with CI green.
  it("refuses a restore under a condition, or one that may fail quietly", () => {
    const problem = "must restore unconditionally as `id: deps`, with no `continue-on-error`";
    expect(cacheShapeProblems({ steps: [{ ...RESTORE, if: "false" }, INSTALL], job: "lint" })).toEqual([problem]);
    const quiet = { ...RESTORE, "continue-on-error": true };
    expect(cacheShapeProblems({ steps: [quiet, INSTALL], job: "lint" })).toEqual([problem]);
  });

  // `compile` could install and build another Yarn project with every run still pinned.
  it("refuses any step of a restoring job run in a working-directory", () => {
    const problem =
      "runs a step in a `working-directory`, which could install or build outside the root project it restored";
    const elsewhere = { ...INSTALL, "working-directory": "desktop" };
    expect(cacheShapeProblems({ steps: [RESTORE, elsewhere], job: "lint" })).toEqual([
      "must run `yarn install --immutable` with no `working-directory`, which could pass it without installing",
      problem,
    ]);
    const build = { run: "yarn build", "working-directory": "desktop" };
    expect(cacheShapeProblems({ steps: [RESTORE, INSTALL, build], job: "compile" })).toEqual([problem]);
  });
});

describe("cacheShapeProblems, for the writer", () => {
  it("accepts restore, install, save as three consecutive steps", () => {
    expect(cacheShapeProblems({ steps: [CHECKOUT, RESTORE, INSTALL, SAVE, LINT], job: CACHE_WRITER_JOB })).toEqual([]);
  });

  it("refuses a writer with no cache steps, which would leave nothing writing the cache", () => {
    expect(cacheShapeProblems({ steps: [CHECKOUT, INSTALL, LINT], job: CACHE_WRITER_JOB })).toEqual([
      "must restore and save the dependency cache exactly once each: it is the one job that writes it",
    ]);
  });

  it("refuses a writer that restores but does not save", () => {
    expect(cacheShapeProblems({ steps: [RESTORE, INSTALL, LINT], job: CACHE_WRITER_JOB })).toEqual([
      "must restore and save the dependency cache exactly once each: it is the one job that writes it",
    ]);
  });

  it("refuses a save after a command, which would cache what the command wrote into node_modules", () => {
    expect(cacheShapeProblems({ steps: [RESTORE, INSTALL, LINT, SAVE], job: CACHE_WRITER_JOB })).toEqual([
      "must save straight after the install, so an entry is the install's tree and nothing a command wrote",
    ]);
  });

  it("refuses a save on any event but a push to main, on a hit, or that may fail quietly", () => {
    const problem = `must save only \`if: ${SAVE_CONDITION}\`, with no \`continue-on-error\``;
    const anyEvent = { ...SAVE, if: "steps.deps.outputs.cache-hit != 'true'" };
    expect(cacheShapeProblems({ steps: [RESTORE, INSTALL, anyEvent], job: CACHE_WRITER_JOB })).toEqual([problem]);
    // A push on any branch the workflow is later widened to must not write either.
    const anyBranch = { ...SAVE, if: "github.event_name == 'push' && steps.deps.outputs.cache-hit != 'true'" };
    expect(cacheShapeProblems({ steps: [RESTORE, INSTALL, anyBranch], job: CACHE_WRITER_JOB })).toEqual([problem]);
    // A save that may fail quietly would leave the cache empty with CI green.
    const quiet = { ...SAVE, "continue-on-error": true };
    expect(cacheShapeProblems({ steps: [RESTORE, INSTALL, quiet], job: CACHE_WRITER_JOB })).toEqual([problem]);
    expect(SAVE_CONDITION).toBe(
      "github.event_name == 'push' && github.ref == 'refs/heads/main' && steps.deps.outputs.cache-hit != 'true'",
    );
  });

  it("refuses a save whose inputs differ from the restore's", () => {
    const other = { ...SAVE, with: { ...DEPENDENCY_CACHE_INPUTS, path: "node_modules\n" } };
    expect(cacheShapeProblems({ steps: [RESTORE, INSTALL, other], job: CACHE_WRITER_JOB })).toEqual([INPUTS_PROBLEM]);
  });
});

describe("cacheShapeProblems, for any job", () => {
  it("refuses the combined cache action, which saves whatever the job left in its post step", () => {
    const combined = { uses: "actions/cache@v4", with: DEPENDENCY_CACHE_INPUTS };
    const problem = "must not use `actions/cache`, which saves in its post step: restore with `actions/cache/restore`";
    expect(cacheShapeProblems({ steps: [combined, INSTALL], job: "lint" })).toEqual([problem]);
    expect(cacheShapeProblems({ steps: [combined, INSTALL], job: CACHE_WRITER_JOB })).toEqual([problem]);
  });
});

describe("the cache writer", () => {
  it("is an offload worker, so it opens with the assertion that refuses any runner but a fresh GitHub-hosted one", () => {
    expect(workerJobs()).toContain(CACHE_WRITER_JOB);
  });
});

describe("dependencyCacheFindings", () => {
  // A job outside the offload workers, such as `integration`, once went unjudged.
  it("judges every job in the workflow, naming a non-worker that saves and a writer that does not", () => {
    const rogue = { ...SAVE, with: { ...DEPENDENCY_CACHE_INPUTS, key: "node-modules-v1-rogue" } };
    const workflow = {
      jobs: {
        integration: { steps: [CHECKOUT, RESTORE, INSTALL, rogue, LINT] },
        lint: { steps: [CHECKOUT, RESTORE, INSTALL, LINT] },
        [CACHE_WRITER_JOB]: { steps: [CHECKOUT, RESTORE, INSTALL, LINT] },
      },
    };
    expect(dependencyCacheFindings({ workflow })).toEqual([
      { line: "`jobs.integration` must not save the dependency cache: only `jobs.typecheck` writes it" },
      {
        line: "`jobs.typecheck` must restore and save the dependency cache exactly once each: it is the one job that writes it",
      },
    ]);
  });

  it("refuses a job whose steps list holds a non-map, which would hide a cache step beside it", () => {
    const workflow = { jobs: { rogue: { steps: [{ uses: "actions/cache@v4" }, 0] } } };
    expect(dependencyCacheFindings({ workflow })).toEqual([
      {
        line: "`jobs.rogue` has no `steps` list the gate can read, so its cache steps went unjudged: inline a reusable workflow's steps",
      },
    ]);
  });

  it("refuses a job that is not a map, and a reusable-workflow call whose cache steps it cannot see", () => {
    const workflow = { jobs: { broken: 0, reused: { uses: "./.github/workflows/other.yml" } } };
    expect(dependencyCacheFindings({ workflow })).toEqual([
      { line: "`jobs.broken` is not a map the gate can read, so its cache steps went unjudged" },
      {
        line: "`jobs.reused` has no `steps` list the gate can read, so its cache steps went unjudged: inline a reusable workflow's steps",
      },
    ]);
  });

  it("names a job that is not a worker running in a container", () => {
    const workflow = {
      jobs: {
        "ci-timing": { container: { image: "example/image" }, steps: [CHECKOUT, RESTORE, INSTALL, LINT] },
        [CACHE_WRITER_JOB]: { steps: [CHECKOUT, RESTORE, INSTALL, SAVE] },
      },
    };
    expect(dependencyCacheFindings({ workflow })).toEqual([
      { line: "`jobs.ci-timing` runs in a `container`, whose image and `env` wrap its install" },
    ]);
  });

  // A job that may fail green hides a failed restore or install with every step unchanged.
  it("names a job that is not a worker carrying a job-level continue-on-error or defaults", () => {
    const workflow = {
      jobs: {
        integration: { "continue-on-error": true, steps: [CHECKOUT, RESTORE, INSTALL, LINT] },
        "ci-timing": { defaults: { run: { shell: "true {0}" } }, steps: [CHECKOUT, RESTORE, INSTALL, LINT] },
        [CACHE_WRITER_JOB]: { steps: [CHECKOUT, RESTORE, INSTALL, SAVE] },
      },
    };
    expect(dependencyCacheFindings({ workflow })).toEqual([
      {
        line: "`jobs.integration` has a job `continue-on-error`, which could pass it green over a failed restore or install",
      },
      {
        line: "`jobs.ci-timing` has job `defaults`, whose `shell` or `working-directory` every step inherits, its install among them",
      },
    ]);
  });

  it("reports nothing for a workflow with no jobs map", () => {
    expect(dependencyCacheFindings({ workflow: { on: "push" } })).toEqual([]);
  });
});
