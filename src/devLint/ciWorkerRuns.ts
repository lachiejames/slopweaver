/**
 * The setup steps a job may carry, pinned WHOLE, and the `run` steps an offload worker may carry. A step can hand
 * the next one an environment through `$GITHUB_ENV` — `BASH_ENV` among it, which bash sources before that step's
 * first line — and no reading of shell text can prove a step does not: it can be spelled `'BASH''_ENV'`,
 * or done from a custom `shell` on a `run` whose text was pinned. So a setup step is compared whole,
 * every key, and a worker's own commands carry no key beyond their name and text.
 */
import { isDeepStrictEqual } from "node:util";
import { OFFLOADED_COMMANDS, workerJobs } from "./ciOffloadCommands.js";
import { RUNNER_FACTS_STEP } from "./ciRunnerFacts.js";
import { actionOf, jobOf, type OffloadFinding, stepsOf } from "./ciWorkflowRead.js";
import { FLOOR_BASE_ENV } from "./gitAtCommit.js";

/** The base fetch `lint` and `unit` run, whole: a new ref has no base to fetch. */
export const FETCH_BASE_RUN = [
  `if [ "$${FLOOR_BASE_ENV}" = "0000000000000000000000000000000000000000" ]; then`,
  '  echo "coverage-floor: base is all zeroes (new ref, no previous commit) — history half will report skipped"',
  "  exit 0",
  "fi",
  `git fetch --no-tags --depth=1 origin "$${FLOOR_BASE_ENV}"`,
].join("\n");

/** The coverage-base fetch as a whole step. */
export const FETCH_BASE_STEP = {
  name: "Fetch the coverage-floor base commit",
  run: `${FETCH_BASE_RUN}\n`,
  shell: "bash",
} as const;

/**
 * Every setup step a job may carry before its install, each whole. An action is compared by its owner/repo
 * rather than its ref, so a Renovate bump of the ref needs no edit here; every input is compared exactly, because
 * `setup-node`'s `node-version` and `mirror` can put any `node` on `PATH`.
 */
const SETUP_STEPS: readonly Readonly<Record<string, unknown>>[] = [
  RUNNER_FACTS_STEP,
  { uses: "actions/checkout" },
  FETCH_BASE_STEP,
  { uses: "actions/setup-node", with: { "node-version-file": ".nvmrc" } },
  { run: "corepack enable" },
];

/** The keys a worker's own `run` step may carry: its name and its text, and a directory where it is pinned. */
const PLAIN_RUN_KEYS: ReadonlySet<string> = new Set(["name", "run", "working-directory"]);

/**
 * Whether a step is one of {@link SETUP_STEPS}, whole, its action's ref aside.
 *
 * @param step the step as parsed
 * @returns true when every key matches one pinned setup step
 */
export function isSetupStep({ step }: { step: Record<string, unknown> }): boolean {
  const action = actionOf({ step });
  const compared = action === undefined ? step : { ...step, uses: action };
  return SETUP_STEPS.some((pinned) => isDeepStrictEqual(compared, pinned));
}

/**
 * Every worker `run` step that is neither a whole {@link SETUP_STEPS} entry nor one of the worker's own offloaded
 * commands (or its install or CLI build) carrying no key beyond {@link PLAIN_RUN_KEYS}.
 *
 * @param workflow the parsed workflow document
 * @returns one finding per step outside that set, naming its first line
 */
export function workerRunFindings({ workflow }: { workflow: unknown }): readonly OffloadFinding[] {
  const plain = new Set(["yarn install --immutable", "yarn slopweaver dev build"]);
  return workerJobs().flatMap((job): OffloadFinding[] => {
    const entry = jobOf({ job, workflow });
    const own = new Set(OFFLOADED_COMMANDS.filter((command) => command.job === job).map((c) => c.command));
    const steps = entry === undefined ? undefined : stepsOf({ job: entry });
    if (steps === undefined) {
      return [];
    }
    return steps
      .filter((step) => "run" in step && !isSetupStep({ step }))
      .filter((step) => {
        const run = step["run"];
        const known = typeof run === "string" && (plain.has(run.trim()) || own.has(run.trim()));
        return !known || Object.keys(step).some((key) => !PLAIN_RUN_KEYS.has(key));
      })
      .map((step) => ({
        line: `\`jobs.${job}\` runs \`${String(step["run"]).trim().split("\n")[0]}\`, which is neither a whole pinned setup step nor one of its own commands with only a name, and could hand the next step an environment`,
      }));
  });
}
