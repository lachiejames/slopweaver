/**
 * What `slopweaver github lap` RUNS, as pure functions: the parse, the lane plan and the lanes' environment.
 * What it judges — the preflight, the statuses, the receipt — is `./lapVerdict.ts`'s.
 *
 * ## Why the plan is derived, never listed — and why it must match the head's
 *
 * The lap is the landing's evidence while hosted Actions is off, so it must run exactly what CI's required
 * `build` check stood for. {@link lapPlan} reads {@link OFFLOADED_COMMANDS} — the register `ci-offload-contract`
 * already proves `.github/workflows/ci.yml` runs — and adds only the preparation a CI job does outside that
 * register (an install, the CLI build the subprocess lane spawns). A second list would drift the first week.
 * That register is the RUNNING CLI's, though, not the head's: a lap run from an older CLI over a head that added
 * a lane would post green without running it. So the run refuses unless every file in `LAP_PLAN_SOURCES`
 * (`./lapPlanSources.ts`) reads the same in the CLI's own tree as at the head — the tree the running code lives
 * in, never the directory the lap was invoked from, which can be a different worktree. That set is the register,
 * the modules of this verb (`lap*.ts`, the lap-seat gate's included, a new one added to the list), and `ci.yml`
 * itself, because `ci-offload-contract` proves the register's commands are in `ci.yml` and nothing about the
 * setup around them. What it does not cover is a
 * shared library a lap module imports, such as `#lib/` or the door: a CLI tree that changed one of those runs its
 * own copy. Nor does it cover an edit to the verb that removes the check itself, this list included: the match
 * guards against a CLI whose CI model has DRIFTED from the head's, never against code edited to skip its own
 * guard, which no code can detect about itself. A head always contains the base tip, so only a head that changes
 * one of these files has to be lapped by a CLI carrying the same change.
 *
 * ## Why the head must already contain the base tip
 *
 * A squash of a head that contains the base tip lands that head's own tree, so testing the head IS testing what
 * lands. `github merge --admin` refuses a moved base on its own account too; this verb refuses before an hour of
 * lanes rather than after. A batch is the one exception: it laps the squash chain it simulates instead, and reads
 * every landing back against it (`./lapBatchCore.ts`).
 *
 * ## Why the lanes run in an allowlisted environment
 *
 * CI's runner has no operator state. A lane inheriting the seat's environment could read the installation's own
 * home, record a live cassette (`POLLY_MODE=record`) with a real token, or pass with a hatch open. So a lane sees
 * {@link LAP_ENV_ALLOWLIST} from the seat and nothing else, plus `CI=true`, `POLLY_MODE=replay`, `TZ=UTC`, a
 * throwaway directory as both `HOME` and `SLOPWEAVER_HOME`, and the download caches it may reuse
 * ({@link lapEnvironment}).
 */

import { OFFLOADED_COMMANDS } from "../../../devLint/ciOffloadCommands.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { UNIT_BLOB_DIRECTORY, UNIT_SHARD_COUNT, unitShardBlob, unitShardJobs } from "../../../testLanes/unitShards.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, repeatedFlagValues, stringFlagsOf } from "../../parseFlags.js";
import { parseRepoSlug } from "./core.js";
import {
  lapAcknowledgementFrom,
  lapMembersFrom,
  MEMBER_LOOP_FLAG,
  type MemberLoopAcknowledgement,
  memberLoopAcknowledgementsFrom,
} from "./lapBatchArgs.js";
import { lapDryRunProblems } from "./lapDryRunArgs.js";

const GITHUB_LAP_FLAGS: FlagSpec = {
  boolean: ["dry-run", "land", "land-only"],
  repeatable: [MEMBER_LOOP_FLAG],
  string: ["repo", "number", "home", "acknowledge", "reason", MEMBER_LOOP_FLAG],
};

/** Every accepted flag for the help-truth ratchet. */
export const GITHUB_LAP_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: GITHUB_LAP_FLAGS }),
  ...booleanFlagsOf({ spec: GITHUB_LAP_FLAGS }),
].map((name) => `--${name}`);

/** The context a lap posts for every CI lane `build` aggregated. */
const LAP_BUILD_CONTEXT = "build";
/** The context a lap posts for the integration lane, which CI ran as its own required job. */
const LAP_INTEGRATION_CONTEXT = "integration";
/** Every context a lap posts, so the preflight can refuse a required one it never would. */
export const LAP_CONTEXTS: readonly string[] = [LAP_BUILD_CONTEXT, LAP_INTEGRATION_CONTEXT];
/** GitHub caps a commit status description at 140 characters and refuses a longer one. */
export const STATUS_DESCRIPTION_MAX = 140;

/**
 * The one ceiling on a step, after which it is killed and reads red (exit {@link LAP_STEP_TIMEOUT_EXIT}). CI's
 * largest job ceiling is 20 minutes on a runner doing one lane; a local lane shares the machine with the fleet,
 * and the whole unit lane measured 27.5 minutes across its six shards at load 31 (repro:
 * `slopweaver github lap --repo <o/r> --number <n>` then each step's wall time in its `lap.json`).
 */
export const LAP_STEP_CEILING_MS = 45 * 60_000;
/** The exit a step killed at {@link LAP_STEP_CEILING_MS} reports, the same as coreutils' `timeout`. */
export const LAP_STEP_TIMEOUT_EXIT = 124;

/**
 * The only variables a lane inherits from the seat: what a process needs to find its tools and a temp dir.
 * `HOME` is deliberately absent — the seat's home holds its GitHub, Codex and Claude credentials and its git
 * identity, none of which a CI runner has — so a lane's `HOME` is the throwaway one ({@link lapEnvironment}),
 * and only the download caches under the real home are pointed at, by the variable each tool reads.
 * `PATH` passes through whole, home entries included, because it is how a lane finds its tools; the lap runs as
 * the seat's OS user, so this bounds what a lane reaches by default and is not a sandbox.
 */
export const LAP_ENV_ALLOWLIST: readonly string[] = [
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "USER",
];

/**
 * The environment every lane runs in: the allowlisted seat variables, CI's own switches, a throwaway home as
 * both `HOME` and `SLOPWEAVER_HOME`, and the cache and coverage variables the lap supplies. Nothing else reaches
 * a lane but the store variables its own CI job set ({@link stepEnvironment}).
 *
 * @param ambient the seat's environment, read once by the caller
 * @param laneHome a throwaway directory minted for this lap, the lanes' `HOME` and `SLOPWEAVER_HOME`
 * @param extra the tool-cache locations and the coverage base the lap supplies
 * @returns the exact environment a lane child starts with
 */
export function lapEnvironment({
  ambient,
  laneHome,
  extra,
}: {
  ambient: Readonly<Record<string, string | undefined>>;
  laneHome: string;
  extra: Readonly<Record<string, string>>;
}): Readonly<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const key of LAP_ENV_ALLOWLIST) {
    const value = ambient[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return { ...env, CI: "true", HOME: laneHome, POLLY_MODE: "replay", SLOPWEAVER_HOME: laneHome, TZ: "UTC", ...extra };
}

/** One resolved `github lap` invocation. */
export interface GithubLapArgs {
  readonly owner: string;
  readonly repo: string;
  /** The pull request, or a batch's FIRST member. */
  readonly number: number;
  /** Every member of a batch, in landing order, when `--number` named more than one; absent for one. */
  readonly batch?: readonly number[];
  readonly land: boolean;
  /** Land on the lap the head already earned, running no lane: `landOnlyFindings` says when it has. */
  readonly landOnly: boolean;
  readonly dryRun: boolean;
  readonly home: string | undefined;
  /** Finding subjects `--land`'s `github merge` accepts, and why — handed to it verbatim, never read here. */
  readonly acknowledge: { readonly subjects: string; readonly reason: string } | undefined;
  /** A batch's per-member `codex-loop-incomplete` acknowledgements, each handed to its own member's merge only. */
  readonly memberLoop?: readonly MemberLoopAcknowledgement[];
}

/**
 * Parse a lap invocation before any credential or network.
 *
 * @param rest argv after `github lap`
 * @returns the resolved invocation, or every usage problem
 */
export function parseGithubLapArgs({ rest }: { rest: readonly string[] }): Result<GithubLapArgs> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: GITHUB_LAP_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const errors: string[] = [];
  const repoValue = parsed.value.values["repo"];
  const repo = typeof repoValue === "string" ? parseRepoSlug({ slug: repoValue }) : undefined;
  if (repo === undefined) {
    errors.push("--repo owner/name is required");
  }
  const landOnly = parsed.value.values["land-only"] === true;
  const { members, errors: memberErrors } = lapMembersFrom({ landOnly, value: parsed.value.values["number"] });
  errors.push(...memberErrors);
  const number = members.length > 0 ? members[0]! : Number.NaN;
  const land = parsed.value.values["land"] === true || landOnly;
  const dryRun = parsed.value.values["dry-run"] === true;
  errors.push(...lapDryRunProblems({ dryRun, land, landOnly, memberCount: members.length }));
  const acknowledgement = lapAcknowledgementFrom({
    land,
    members,
    reason: parsed.value.values["reason"],
    subjects: parsed.value.values["acknowledge"],
  });
  errors.push(...acknowledgement.errors);
  const memberLoop = memberLoopAcknowledgementsFrom({
    land,
    members,
    values: repeatedFlagValues({ name: MEMBER_LOOP_FLAG, rest }),
  });
  errors.push(...memberLoop.errors);
  if (errors.length > 0 || repo === undefined) {
    return err(errors);
  }
  const home = parsed.value.values["home"];
  const resolved: GithubLapArgs = {
    acknowledge: acknowledgement.acknowledge,
    dryRun,
    home: typeof home === "string" ? home : undefined,
    land,
    landOnly,
    number,
    owner: repo.owner,
    repo: repo.repo,
  };
  return ok(members.length < 2 ? resolved : { ...resolved, batch: members, memberLoop: memberLoop.acknowledgements });
}

/** One step of a lap: a command run without a shell, in a directory of the lap's tree, under one context. */
export interface LapStep {
  /** A short unique name, used for the step's log file and in every report line. */
  readonly id: string;
  readonly argv: readonly string[];
  /** Relative to the lap's tree; absent means its root. */
  readonly directory: string | undefined;
  /** The status this step's outcome decides. */
  readonly context: string;
  /** The CI job this step stands in for (`ci.yml`), whose fresh checkout the lap's tree is cleaned back to. */
  readonly job: string;
  /** `prepare` for an install or a build a CI job ran before its lane; `lane` for a command CI's register names. */
  readonly kind: "prepare" | "lane";
  /** The throwaway store's variables this step's CI job sets (`ci.yml`), and none for any other step. */
  readonly storeVariables: readonly string[];
  /**
   * Whether a red run is re-run once, whole, before its red stands — only a Vitest lane is: the lap's equivalent
   * of CI's "re-run failed jobs". A lap shares the machine with the fleet, and a contention timeout there is not
   * a defect; a real one fails the fresh run too. Every retried step is named in the status it earns, so a green
   * that needed one never reads as a clean one. MEASURED at load average 16 on 15 cores (`uptime`;
   * `sysctl -n hw.ncpu`): two laps each went red in one unit shard — `imageCaps.test.ts` (a regexp
   * stack overflow) and `pruneRemoved.test.ts` (a 20s timeout on a delete) — and the first passed a whole-shard
   * re-run, 17982 of 17982 (`CI=true yarn test:unit --shard=3/6 --maxWorkers=4`).
   */
  readonly retryable: boolean;
}

/**
 * Which CI jobs point at the `postgres:17` service, and through which variables (`ci.yml`'s job `env:` blocks).
 * Only these lanes get the lap's store: a live-store test in any other lane is skipped in CI, because its
 * variable is unset there, and handing it the store runs it against a database nothing migrated. MEASURED: a lap
 * went red in `integration` on `doorLedgerStore.test.ts`, `relation "door_register"
 * does not exist` (`grep -n "_URL:" .github/workflows/ci.yml` lists the jobs that set one).
 */
const LAP_STORE_VARIABLES: readonly { readonly job: string; readonly variables: readonly string[] }[] = [
  { job: "desktop-e2e", variables: ["DESKTOP_E2E_STORE_ADMIN_URL"] },
  {
    job: "subprocess",
    variables: ["DOOR_LEDGER_STORE_PROOF_URL", "PROFILE_STEERS_PROOF_ADMIN_URL", "STORE_PROOF_ADMIN_URL"],
  },
];

/**
 * What CI hands from job to job, `ci.yml`'s `unit-blob-*` artifacts, and every job each one is spared through.
 * CI uploads each shard's blob and `unit` downloads all six; the lap has one tree, so a blob stands in for its
 * upload by staying on disk past the LATER shards until `unit` merges it, and is never spared for its own shard
 * or an earlier one, whose retry starts as CI's re-run of that job would, with no blob it had not been handed.
 * The plan runs the shards in index order (`OFFLOADED_COMMANDS`). Every other job starts on a fresh checkout.
 */
const LAP_ARTIFACTS: readonly { readonly path: string; readonly jobs: readonly string[] }[] = Array.from(
  { length: UNIT_SHARD_COUNT },
  (_unused, at) => ({
    jobs: [...unitShardJobs().slice(at + 1), "unit"],
    path: `${UNIT_BLOB_DIRECTORY}/${unitShardBlob({ index: at + 1 })}`,
  }),
);

/**
 * What the lap's tree is cleaned of before a step: nothing while one CI job continues, and every untracked,
 * unignored file when a new one starts — bar an artifact that job receives — because CI starts each job on a
 * fresh checkout. MEASURED: a lap at load 13.7 went red in `subprocess` on
 * `onlyFlagScope.test.ts`, its `dev lint --only control-bytes` child out of memory on the unit shards'
 * `.vitest-reports/` blobs, which CI's subprocess job never has (`git status --short --untracked-files=all`
 * in a lap's tree after `unit-1` lists them).
 *
 * @param previous the step that ran last, absent before the first, whose job is new by definition
 * @param step the step about to run
 * @returns `undefined` to leave the tree as it is, else the paths to keep while cleaning it
 */
export function cleanBefore({
  previous,
  step,
}: {
  previous: LapStep | undefined;
  step: LapStep;
}): { readonly keep: readonly string[] } | undefined {
  if (previous !== undefined && previous.job === step.job) {
    return undefined;
  }
  return {
    keep: LAP_ARTIFACTS.filter((artifact) => artifact.jobs.includes(step.job)).map((artifact) => artifact.path),
  };
}

/** The store variables CI's `job` sets, none for a job that has no store. */
function storeVariablesOf({ job }: { job: string }): readonly string[] {
  return LAP_STORE_VARIABLES.filter((row) => row.job === job).flatMap((row) => row.variables);
}

/**
 * One step's environment: every lane's own, plus only the store variables that step's CI job sets.
 *
 * @param env the environment every lane shares ({@link lapEnvironment})
 * @param step the step about to run
 * @param store every variable the throwaway store supplies, mapped to its URL
 * @returns the exact environment the step's child starts with
 */
export function stepEnvironment({
  env,
  step,
  store,
}: {
  env: Readonly<Record<string, string>>;
  step: LapStep;
  store: Readonly<Record<string, string>>;
}): Readonly<Record<string, string>> {
  const picked: Record<string, string> = {};
  for (const variable of step.storeVariables) {
    const url = store[variable];
    if (url !== undefined) {
      picked[variable] = url;
    }
  }
  return { ...env, ...picked };
}

/**
 * The worker cap every Vitest lane runs under in a lap: CI ran each lane alone on a 4-vCPU `ubuntu-latest`
 * runner. Without it a lane takes one worker per local core while the fleet shares the machine, and the
 * lanes' own caps do not hold — `config/vitest/subprocess.ts` caps itself only when `CI` is unset, and a lap
 * sets `CI=true`. MEASURED: an unsharded, uncapped unit run of one pull request's head failed 13 tests whose 6
 * files pass alone (41 of 41), and the trunk showed 14 such reds — load, not defects
 * (`yarn vitest run --config config/vitest/unit.ts <file>` on each named file).
 */
export const LAP_VITEST_MAX_WORKERS = 4;

/** The package scripts that run Vitest directly, so the lap can pass {@link LAP_VITEST_MAX_WORKERS} through. */
const VITEST_SCRIPTS: ReadonlySet<string> = new Set(["test:unit", "test:subprocess", "test:integration"]);

/** Whether a register command runs Vitest directly. The register's commands are plain words. */
function runsVitest({ command }: { command: string }): boolean {
  const argv = command.split(" ").filter((word) => word.length > 0);
  return argv[0] === "yarn" && VITEST_SCRIPTS.has(argv[1]!);
}

/** Split a register command into argv, capping a Vitest lane's workers. */
function argvOf({ command }: { command: string }): readonly string[] {
  const argv = command.split(" ").filter((word) => word.length > 0);
  return runsVitest({ command }) ? [...argv, `--maxWorkers=${String(LAP_VITEST_MAX_WORKERS)}`] : argv;
}

/**
 * A filesystem-safe step id for a register entry: the CI job's own name, suffixed with the script only where
 * that job runs more than one command, so a red step reads as the job a CI reader already knows.
 */
function laneId({ job, command, shared }: { job: string; command: string; shared: boolean }): string {
  if (!shared) {
    return job;
  }
  const script = command.replace(/^yarn /u, "").split(" ")[0]!;
  return `${job}.${script.replace(/[^a-z0-9-]+/giu, "-")}`;
}

/** The preparation a register entry needs that no earlier step did: its directory's install, the CLI build. */
function preparationFor({
  entry,
  prepared,
}: {
  entry: (typeof OFFLOADED_COMMANDS)[number];
  prepared: Set<string>;
}): readonly LapStep[] {
  const steps: LapStep[] = [];
  const directory = entry.directory;
  if (directory !== undefined && !prepared.has(directory)) {
    prepared.add(directory);
    steps.push({
      argv: ["yarn", "install", "--immutable"],
      context: LAP_BUILD_CONTEXT,
      directory,
      id: `${directory}-install`,
      job: entry.job,
      kind: "prepare",
      retryable: false,
      storeVariables: [],
    });
  }
  if (entry.job === "subprocess" && !prepared.has("cli-build")) {
    prepared.add("cli-build");
    steps.push({
      argv: ["yarn", "slopweaver", "dev", "build"],
      context: LAP_BUILD_CONTEXT,
      directory: undefined,
      id: "cli-build",
      job: entry.job,
      kind: "prepare",
      retryable: false,
      storeVariables: [],
    });
  }
  return steps;
}

/**
 * The whole lap, in order: `integration` first because it is cheap and decides its own status, then every
 * command CI's register names, each preceded by the preparation its CI job does outside the register.
 *
 * @returns every step, each once, in the order the lap runs them
 */
export function lapPlan(): readonly LapStep[] {
  const steps: LapStep[] = [
    {
      argv: ["yarn", "install", "--immutable"],
      context: LAP_BUILD_CONTEXT,
      directory: undefined,
      id: "install",
      job: "install",
      kind: "prepare",
      retryable: false,
      storeVariables: [],
    },
    {
      argv: argvOf({ command: "yarn test:integration" }),
      context: LAP_INTEGRATION_CONTEXT,
      directory: undefined,
      id: "integration",
      job: "integration",
      kind: "lane",
      retryable: runsVitest({ command: "yarn test:integration" }),
      storeVariables: storeVariablesOf({ job: "integration" }),
    },
  ];
  const prepared = new Set<string>();
  for (const entry of OFFLOADED_COMMANDS) {
    steps.push(...preparationFor({ entry, prepared }));
    const shared = OFFLOADED_COMMANDS.filter((other) => other.job === entry.job).length > 1;
    steps.push({
      argv: argvOf({ command: entry.command }),
      context: LAP_BUILD_CONTEXT,
      directory: entry.directory,
      id: laneId({ command: entry.command, job: entry.job, shared }),
      job: entry.job,
      kind: "lane",
      retryable: runsVitest({ command: entry.command }),
      storeVariables: storeVariablesOf({ job: entry.job }),
    });
  }
  return steps;
}
