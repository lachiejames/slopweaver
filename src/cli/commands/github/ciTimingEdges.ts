/**
 * Where `slopweaver github ci-timing` touches the world: the repository it resolves and the run it reads.
 *
 * {@link GithubCiTimingDeps} is the contract between this module and `ciTimingRun.ts`. It lives HERE so the
 * dependency runs one way: a test injecting plain fakes imports the contract without importing a REST client.
 */

import { githubToken, type Repository } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type CiTimingError, CiTimingErrors } from "../../../live/github/ciTimingErrors.js";
import { githubReadRest } from "../../../live/github/read.js";
import type { JobTiming } from "../../../live/github/runHistoryParse.js";
import { allAttemptJobsParams, readAllAttemptJobRows } from "../../../live/github/runJobAttempts.js";
import { jobTimingsOfRun } from "./ciTimingCore.js";
import { resolveRepoEdge } from "./repoEdge.js";

/** Injectable command edges. A plain fake exercises the shell without Octokit, credentials or a network. */
export interface GithubCiTimingDeps {
  readonly resolveRepo: (args: { explicit: string | undefined; home: string | undefined }) => Result<Repository>;
  readonly readJobs: (args: {
    repo: Repository;
    runId: number;
    home: string | undefined;
  }) => Promise<Result<readonly JobTiming[], CiTimingError>>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Build the production edges: the shared REST door for the run, and the logger's two channels.
 *
 * The jobs read goes through `githubReadRest`, the same door `ci-runs` uses — there is no second client
 * here, which is what `scheduler-bypass` exists to keep true.
 *
 * @returns credential-aware repository and run reads, and the output sinks
 */
export function productionGithubCiTimingDeps(): GithubCiTimingDeps {
  return {
    readJobs: readRunJobs,
    resolveRepo: resolveRepoEdge,
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * Read one run's jobs across EVERY attempt through the shared REST door, and time them.
 *
 * A "re-run failed jobs" attempt holds only what it re-ran, so a latest-attempt read would report every job
 * left alone as never run; `readAllAttemptJobRows` carries the measurement and the fold.
 */
async function readRunJobs({
  repo,
  runId,
  home,
}: {
  repo: Repository;
  runId: number;
  home: string | undefined;
}): Promise<Result<readonly JobTiming[], CiTimingError>> {
  const token = githubToken(home === undefined ? {} : { home });
  const rest = githubReadRest({ token });
  const folded = await readAllAttemptJobRows({
    fetchPage: async ({ page }) => {
      const called = await rest({
        params: allAttemptJobsParams({ owner: repo.owner, page, repo: repo.repo, runId }),
        route: "GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs",
      });
      if (called.isErr()) {
        return err(CiTimingErrors.runReadFailed({ message: called.error.message }));
      }
      return ok(called.value);
    },
    runId,
  });
  if (folded.isErr()) {
    return err(folded.error);
  }
  return jobTimingsOfRun({ payload: folded.value, runId });
}
