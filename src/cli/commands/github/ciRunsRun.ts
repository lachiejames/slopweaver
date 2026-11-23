/** The effectful shell for `slopweaver github ci-runs`. */

import { githubToken, type Repository } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { githubReadRest } from "../../../live/github/read.js";
import {
  ANY_BRANCH,
  type FetchRunJobs,
  type FetchWorkflowRuns,
  type RunHistoryDocument,
  readRunHistory,
} from "../../../live/github/runHistory.js";
import { type GithubRunHistoryError, GithubRunHistoryErrors } from "../../../live/github/runHistoryErrors.js";
import { renderRunHistoryJson, renderRunHistoryText } from "../../../live/github/runHistoryReport.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseGithubCiRunsArgs } from "./ciRunsCore.js";
import { githubCiRunsUsage } from "./ciUsage.js";
import { resolveRepoEdge } from "./repoEdge.js";

const VERB_ARG_OFFSET = 4;

/** Injectable command edges. A plain fake exercises the shell without Octokit or credentials. */
export interface GithubCiRunsDeps {
  readonly resolveRepo: (args: { explicit: string | undefined; home: string | undefined }) => Result<Repository>;
  readonly read: (args: {
    repo: Repository;
    branch: string;
    event: string;
    runs: number;
    steps: boolean;
    workflow: string;
    home: string | undefined;
  }) => Promise<Result<RunHistoryDocument, GithubRunHistoryError>>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run one `github ci-runs` invocation against injected edges.
 *
 * A selection matching no run exits `EXIT_ERROR` rather than an empty-success code: unlike a search, "no
 * runs" is never the answer somebody wanted from a timing read — it means the branch, event or workflow
 * named something that is not there, and reporting it as a clean empty would let a watcher conclude CI is
 * fast when in fact nothing was measured.
 *
 * @param rest argv after `github ci-runs`
 * @param deps the repo-resolution, read and output seams
 * @returns the process exit code
 */
export async function runGithubCiRuns({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubCiRunsDeps;
}): Promise<number> {
  const parsed = parseGithubCiRunsArgs({ rest });
  if (parsed.isErr()) {
    for (const issue of parsed.error) {
      deps.writeDiagnostic(issue.message);
    }
    deps.writeDiagnostic(githubCiRunsUsage());
    return EXIT_USAGE;
  }
  const repo = deps.resolveRepo({ explicit: parsed.value.repo, home: parsed.value.home });
  if (repo.isErr()) {
    for (const problem of repo.error) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_ERROR;
  }
  const read = await deps.read({
    branch: parsed.value.branch,
    event: parsed.value.event,
    home: parsed.value.home,
    repo: repo.value,
    runs: parsed.value.runs,
    steps: parsed.value.steps,
    workflow: parsed.value.workflow,
  });
  if (read.isErr()) {
    deps.writeDiagnostic(read.error.message);
    return EXIT_ERROR;
  }
  deps.writeOut(
    parsed.value.json ? renderRunHistoryJson({ document: read.value }) : renderRunHistoryText({ document: read.value }),
  );
  return EXIT_OK;
}

/**
 * Build the two production seams over the shared REST transport.
 *
 * Both go through `githubReadRest`, the same door `pr retarget`'s ruleset read and `landing`'s protection
 * read use — there is no second client here, which is what `scheduler-bypass` exists to keep true.
 *
 * @param token the GitHub token, or undefined for an unauthenticated public read
 * @returns the runs-page and jobs-page seams
 */
function productionSeams({ token }: { token: string | undefined }): {
  fetchRuns: FetchWorkflowRuns;
  fetchJobs: FetchRunJobs;
} {
  const rest = githubReadRest({ token });
  const fetchRuns: FetchWorkflowRuns = async ({ owner, repo, workflow, branch, event, perPage }) => {
    // `ANY_BRANCH` OMITS the parameter rather than sending a wildcard: GitHub has no wildcard here, and a
    // literal "any" would filter for a branch of that name and answer an honest, misleading zero.
    const branchFilter = branch === ANY_BRANCH ? {} : { branch };
    const called = await rest({
      params: { ...branchFilter, event, owner, per_page: perPage, repo, status: "completed", workflow_id: workflow },
      route: "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs",
    });
    return called.isErr()
      ? err(GithubRunHistoryErrors.fetchFailed({ cause: called.error, message: called.error.message }))
      : ok(called.value);
  };
  const fetchJobs: FetchRunJobs = async ({ owner, repo, runId }) => {
    const called = await rest({
      params: { owner, per_page: 100, repo, run_id: runId },
      route: "GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs",
    });
    return called.isErr()
      ? err(GithubRunHistoryErrors.fetchFailed({ cause: called.error, message: called.error.message }))
      : ok(called.value);
  };
  return { fetchJobs, fetchRuns };
}

/**
 * Production edges: a resilient Octokit client governed by the same provider door as every other GitHub read.
 *
 * @returns credential-aware read + repo resolution, and the output sinks
 */
export function productionGithubCiRunsDeps(): GithubCiRunsDeps {
  return {
    read: async ({ repo, branch, event, runs, workflow, steps, home }) => {
      const token = githubToken(home === undefined ? {} : { home });
      const seams = productionSeams({ token });
      return readRunHistory({
        branch,
        event,
        fetchJobs: seams.fetchJobs,
        fetchRuns: seams.fetchRuns,
        nowIso: () => new Date().toISOString(),
        owner: repo.owner,
        repo: repo.repo,
        runs,
        steps,
        workflow,
      });
    },
    resolveRepo: resolveRepoEdge,
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver github ci-runs`. */
export const githubCiRunsCommand = defineCommand({
  run: (argv) => runGithubCiRuns({ deps: productionGithubCiRunsDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
