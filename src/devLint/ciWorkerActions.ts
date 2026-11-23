/**
 * Which actions each `ci.yml` worker may use, and the one ordering the unit lane's split depends on — lifted
 * out of `./ciOffloadContract.ts` when sharding the unit lane gave three jobs a reason to differ.
 *
 * Every worker runs `actions/checkout`, `actions/setup-node` and the dependency cache and nothing else, which is the closing rule of
 * a family the Codex review walked one spelling at a time: a SECOND checkout of `main` inserted after the
 * first, named `Actions/checkout@v4`, then `actions/checkout/@v4`. Each was a hole in the matcher rather than
 * in the contract, and refusing an unlisted action closes all of them at once, including the spellings nobody
 * has thought of.
 *
 * The unit lane's shards and merge are the ONE widening, and it is by job rather than by file: a shard may
 * upload its blob report and the merge job may download them, because reports cannot cross runners any other
 * way. Neither action can make a failed command succeed — the upload runs after the shard's command, whose
 * failure already failed the job, and a report that never arrived is refused by the merge itself
 * (`blobSetFindings` in `src/testLanes/unitShards.ts`) — so the property `build` carries is untouched. The
 * merge job must NEED every shard, or it could read the directory before a shard had written to it.
 *
 * Their INPUTS are pinned too, exactly, because a name check alone is not the property: an upload whose `path:` names a committed `package.json` and a download whose `path:` is `.`,
 * which together overwrite the scripts the merge and the floor run with no-ops — every required line
 * unchanged, every job green. With each `with:` fixed below, an artifact can only ever be a shard's own
 * report directory landing in the merge's report directory.
 */
import { isDeepStrictEqual } from "node:util";

import { UNIT_BLOB_DIRECTORY, unitShardJobs } from "../testLanes/unitShards.js";
import { DEPENDENCY_CACHE_ACTIONS, dependencyCacheFindings } from "./ciDependencyCache.js";
import { actionOf, jobOf, type OffloadFinding, stepsOf } from "./ciWorkflowRead.js";

/**
 * The only actions every worker may use, as `owner/repo` with no version: the two every worker needs, and the
 * dependency cache whose one permitted shape `./ciDependencyCache.ts` pins.
 */
const WORKER_ACTIONS: readonly string[] = ["actions/checkout", "actions/setup-node", ...DEPENDENCY_CACHE_ACTIONS];

/** The job that merges the shards' reports, and so the one that downloads them. */
export const UNIT_MERGE_JOB = "unit";

/**
 * The console's browser lane, the one other worker that uploads: its Playwright report and failure evidence (trace,
 * video, screenshots), only on a failure, which is when someone reads them. The upload runs after `yarn test:e2e`
 * has already failed the job, so it cannot make a failure pass, and nothing downloads it.
 */
export const DESKTOP_E2E_JOB = "desktop-e2e";

/**
 * The actions one worker may use: the two every worker needs, plus the report transport a unit-lane job needs, and the
 * failure-evidence upload of the console's browser lane.
 *
 * @param job the worker job id
 * @returns the allowed actions, as `owner/repo`
 */
export function allowedActions({ job }: { job: string }): readonly string[] {
  if (unitShardJobs().includes(job) || job === DESKTOP_E2E_JOB) {
    return [...WORKER_ACTIONS, "actions/upload-artifact"];
  }
  if (job === UNIT_MERGE_JOB) {
    return [...WORKER_ACTIONS, "actions/download-artifact"];
  }
  return WORKER_ACTIONS;
}

/**
 * Judge every worker's `uses:` steps against {@link allowedActions}, and the merge job's needs.
 *
 * @param workflow the parsed workflow document
 * @param workers the worker job ids
 * @returns one finding per disallowed action, per worker whose dependency cache is out of shape, per shard the
 *   merge job does not need, and per worker whose `needs` is not exactly its pinned set
 */
export function workerActionFindings({
  workflow,
  workers,
}: {
  workflow: unknown;
  workers: readonly string[];
}): readonly OffloadFinding[] {
  const actions = workers.flatMap((job): OffloadFinding[] => {
    const entry = jobOf({ job, workflow });
    const steps = entry === undefined ? undefined : stepsOf({ job: entry });
    if (steps === undefined) {
      return [];
    }
    const allowed = allowedActions({ job });
    return steps
      .filter((step) => "uses" in step)
      .filter((step) => {
        const action = actionOf({ step });
        return action === undefined || !allowed.includes(action);
      })
      .map((step) => ({
        line: `\`jobs.${job}\` uses \`${String(step["uses"])}\`, which is not one of ${allowed.join(" or ")}`,
      }));
  });
  return [
    ...actions,
    ...dependencyCacheFindings({ workflow }),
    ...mergeNeedsFindings({ workflow }),
    ...workerNeedsFindings({ workflow, workers }),
    ...artifactInputFindings({ workflow }),
  ];
}

/**
 * The merge job needs every shard, so it cannot read the report directory before a shard has written it.
 *
 * @param workflow the parsed workflow document
 * @returns one finding per shard the merge job does not need
 */
function mergeNeedsFindings({ workflow }: { workflow: unknown }): readonly OffloadFinding[] {
  const entry = jobOf({ job: UNIT_MERGE_JOB, workflow });
  if (entry === undefined) {
    return [];
  }
  const needs = Array.isArray(entry["needs"]) ? entry["needs"].map(String) : [];
  return unitShardJobs()
    .filter((shard) => !needs.includes(shard))
    .map((shard) => ({
      line: `\`jobs.${UNIT_MERGE_JOB}\` does not need \`${shard}\`, so it could merge before that shard's report exists`,
    }));
}

/**
 * Every worker's `needs` is pinned whole: the merge job needs its shards and nothing else, and every other worker
 * needs nothing. A dependency that is skipped skips the worker with it, so `needs: integration` on `typecheck`
 * would skip the cache writer and its runner-facts refusal on every `push`.
 *
 * @param workflow the parsed workflow document
 * @param workers the worker job ids
 * @returns one finding per worker with a `needs` it may not carry
 */
function workerNeedsFindings({
  workflow,
  workers,
}: {
  workflow: unknown;
  workers: readonly string[];
}): readonly OffloadFinding[] {
  const shards = unitShardJobs();
  return workers.flatMap((job): OffloadFinding[] => {
    const entry = jobOf({ job, workflow });
    if (entry === undefined || !("needs" in entry)) {
      return [];
    }
    if (job !== UNIT_MERGE_JOB) {
      return [
        {
          line: `\`jobs.${job}\` sets \`needs\`, so a skipped dependency would skip it, its runner-facts refusal and any cache save with it`,
        },
      ];
    }
    const needs = Array.isArray(entry["needs"]) ? entry["needs"] : [entry["needs"]];
    return needs
      .filter((need) => typeof need !== "string" || !shards.includes(need))
      .map((need) => ({
        line: `\`jobs.${UNIT_MERGE_JOB}\` needs \`${typeof need === "string" ? need : JSON.stringify(need)}\`, beyond its shards, so a skipped dependency would skip the merge`,
      }));
  });
}

/**
 * The exact `with:` an artifact step in one unit-lane job, or the browser lane, must carry; undefined for any other job.
 *
 * @param job the worker job id
 * @returns the pinned inputs for that job's artifact action
 */
export function artifactInputs({ job }: { job: string }): Readonly<Record<string, unknown>> | undefined {
  if (unitShardJobs().includes(job)) {
    return {
      "if-no-files-found": "error",
      "include-hidden-files": true,
      name: `unit-blob-${job.slice("unit-".length)}`,
      path: `${UNIT_BLOB_DIRECTORY}/`,
      "retention-days": 1,
    };
  }
  if (job === UNIT_MERGE_JOB) {
    return { "merge-multiple": true, path: UNIT_BLOB_DIRECTORY, pattern: "unit-blob-*" };
  }
  if (job === DESKTOP_E2E_JOB) {
    return {
      "if-no-files-found": "ignore",
      name: "desktop-e2e-evidence",
      path: "playwright-report/\ntest-results/playwright/\n",
      "retention-days": 7,
    };
  }
  return undefined;
}

/**
 * Every artifact step in the unit lane and the browser lane carries exactly its pinned inputs, so no artifact can
 * land anywhere but the merge's report directory, and the browser lane uploads only its own evidence.
 *
 * @param workflow the parsed workflow document
 * @returns one finding per artifact step whose `with:` differs from {@link artifactInputs}
 */
function artifactInputFindings({ workflow }: { workflow: unknown }): readonly OffloadFinding[] {
  return [...unitShardJobs(), UNIT_MERGE_JOB, DESKTOP_E2E_JOB].flatMap((job): OffloadFinding[] => {
    const entry = jobOf({ job, workflow });
    const steps = entry === undefined ? undefined : stepsOf({ job: entry });
    const pinned = artifactInputs({ job });
    if (steps === undefined || pinned === undefined) {
      return [];
    }
    return steps
      .filter((step) => actionOf({ step })?.endsWith("-artifact") === true)
      .filter((step) => !isDeepStrictEqual(step["with"], pinned))
      .map(() => ({
        line: `\`jobs.${job}\` passes its artifact action inputs other than ${JSON.stringify(pinned)}, so an artifact could land outside the report directory`,
      }));
  });
}
