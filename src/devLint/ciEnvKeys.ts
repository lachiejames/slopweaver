/**
 * The `env` variables `ci.yml` may set, named exactly. A variable the runner hands a step can change what the
 * step's pinned command does before its first line runs: `BASH_ENV` has bash source a file first (on the aggregator's verdict), and `NODE_OPTIONS=--import=…` has every `node` and `yarn` exit 0 before
 * running. Naming the bad ones loses to the next one, so every `env` block in the workflow
 * — its own, each job's and each step's — may carry only the keys below.
 */
import { isRecord } from "../lib/parsers.js";
import { type OffloadFinding, stepsOf } from "./ciWorkflowRead.js";
import { FLOOR_BASE_ENV } from "./gitAtCommit.js";

/**
 * Every `env` key the workflow sets, and what reads it. Add one here in the same diff as `ci.yml`.
 */
export const ENV_KEYS: ReadonlySet<string> = new Set([
  // the runner-facts step's memory floor
  "MIN_TOTAL_MIB",
  // the aggregator's verdict, pinned by `ciOffloadContract.ts`
  "ALL_SUCCEEDED",
  // the base commit the coverage floor compares against, pinned by `ciOffloadContract.ts`
  FLOOR_BASE_ENV,
  // the ci-timing job's GitHub read
  "GITHUB_TOKEN",
  // the subprocess job's throwaway Postgres service, which the Outlook write cases migrate and record into
  "DOOR_LEDGER_STORE_PROOF_URL",
  // the subprocess job's throwaway Postgres service, its admin connection, read only by `profileSteersContract.test.ts`
  "PROFILE_STEERS_PROOF_ADMIN_URL",
  // the same admin connection, read only by the shared `subprocess/proofDatabase.ts` helper
  "STORE_PROOF_ADMIN_URL",
  // the desktop-e2e job's throwaway Postgres service, its admin connection, read only by `e2e/fixtures/consoleSeed.ts`
  "DESKTOP_E2E_STORE_ADMIN_URL",
]);

/**
 * The keys of an `env` block outside {@link ENV_KEYS}. An expression block cannot be read as a map, and an
 * expression key is any variable on the runner, so each counts as one.
 *
 * @param env the block, as parsed; absent is clean
 * @returns each unpinned key, or the block itself when it is not a map
 */
export function unpinnedEnvKeys({ env }: { env: unknown }): readonly string[] {
  if (env === undefined) {
    return [];
  }
  if (!isRecord(env)) {
    return [typeof env === "string" ? env : JSON.stringify(env)];
  }
  return Object.keys(env).filter((key) => !ENV_KEYS.has(key));
}

/**
 * Every `env` block in the workflow that sets a variable outside {@link ENV_KEYS}.
 *
 * @param workflow the parsed workflow document
 * @returns one finding for the workflow's own block and one per job whose block or step blocks do
 */
export function envKeyFindings({ workflow }: { workflow: unknown }): readonly OffloadFinding[] {
  if (!isRecord(workflow)) {
    return [];
  }
  const own = unpinnedEnvKeys({ env: workflow["env"] });
  const jobs = isRecord(workflow["jobs"]) ? Object.entries(workflow["jobs"]) : [];
  return [
    ...(own.length > 0 ? [{ line: finding({ keys: own, where: "the workflow `env`" }) }] : []),
    ...jobs.flatMap(([job, entry]): OffloadFinding[] => {
      if (!isRecord(entry)) {
        return [];
      }
      // A job with no readable steps list is refused by `dependencyCacheFindings`; its own `env` is still read.
      const steps = stepsOf({ job: entry });
      const keys = [
        ...unpinnedEnvKeys({ env: entry["env"] }),
        ...(steps === undefined ? [] : steps.flatMap((step) => unpinnedEnvKeys({ env: step["env"] }))),
      ];
      return keys.length > 0 ? [{ line: finding({ keys, where: `\`jobs.${job}\`` }) }] : [];
    }),
  ];
}

/**
 * The one sentence for unpinned keys.
 *
 * @param keys the keys found
 * @param where the block's owner, as it opens the sentence
 * @returns the finding's line
 */
function finding({ keys, where }: { keys: readonly string[]; where: string }): string {
  const named = [...new Set(keys)].map((key) => `\`${key}\``).join(", ");
  return `${where} sets ${named} in an \`env\`, outside ENV_KEYS (ciEnvKeys.ts), which could change what a pinned command does before it runs — \`BASH_ENV\` and \`NODE_OPTIONS\` among them`;
}
