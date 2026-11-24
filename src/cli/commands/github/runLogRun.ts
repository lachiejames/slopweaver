/** The effectful shell for `slopweaver github run-log`. */

import { githubToken, type Repository } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { GithubJobLogError } from "../../../live/github/jobLogErrors.js";
import { type JobLogDocument, readJobLogs } from "../../../live/github/jobLogRead.js";
import { renderJobLogJson, renderJobLogText } from "../../../live/github/jobLogReport.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveRepoEdge } from "./repoEdge.js";
import { githubRunLogUsage, parseGithubRunLogArgs } from "./runLogCore.js";
import { productionRunLogSeams } from "./runLogSeams.js";

const VERB_ARG_OFFSET = 4;

/** Injectable command edges. A plain fake exercises the shell without Octokit or credentials. */
export interface GithubRunLogDeps {
  readonly resolveRepo: (args: { explicit: string | undefined; home: string | undefined }) => Result<Repository>;
  readonly read: (args: {
    repo: Repository;
    runId: number;
    job: string | undefined;
    lines: number;
    from: string | undefined;
    home: string | undefined;
  }) => Promise<Result<JobLogDocument, GithubJobLogError>>;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run one `github run-log` invocation against injected edges.
 *
 * A run whose jobs all succeeded exits `EXIT_ERROR` rather than an empty success, and the same reasoning
 * applies here as in `./ciRunsRun.ts`: "no failed job" is never the answer somebody wanted from a verb they
 * reached for because a leg went red — it means the run id, or the repository, named something other than
 * what they were looking at, and a clean empty would send them back to the lane in their own seat.
 *
 * @param rest argv after `github run-log`
 * @param deps the repo-resolution, read and output seams
 * @returns the process exit code
 */
export async function runGithubRunLog({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubRunLogDeps;
}): Promise<number> {
  const parsed = parseGithubRunLogArgs({ rest });
  if (parsed.isErr()) {
    for (const issue of parsed.error) {
      deps.writeDiagnostic(issue.message);
    }
    deps.writeDiagnostic(githubRunLogUsage());
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
    from: parsed.value.from,
    home: parsed.value.home,
    job: parsed.value.job,
    lines: parsed.value.lines,
    repo: repo.value,
    runId: parsed.value.runId,
  });
  if (read.isErr()) {
    deps.writeDiagnostic(read.error.message);
    return EXIT_ERROR;
  }
  deps.writeOut(
    parsed.value.json ? renderJobLogJson({ document: read.value }) : renderJobLogText({ document: read.value }),
  );
  return EXIT_OK;
}

/**
 * Production edges: a resilient Octokit client governed by the same provider door as every other GitHub read.
 *
 * @returns credential-aware read + repo resolution, and the output sinks
 */
export function productionGithubRunLogDeps(): GithubRunLogDeps {
  return {
    read: async ({ repo, runId, job, lines, from, home }) => {
      const token = githubToken(home === undefined ? {} : { home });
      const seams = productionRunLogSeams({ token });
      return readJobLogs({
        ...(from === undefined ? {} : { from }),
        fetchJobs: seams.fetchJobs,
        fetchRun: seams.fetchRun,
        job,
        jobIds: undefined,
        nowIso: () => new Date().toISOString(),
        owner: repo.owner,
        repo: repo.repo,
        runId,
        streamLog: seams.streamLog,
        tailLines: lines,
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

/** `slopweaver github run-log`. */
export const githubRunLogCommand = defineCommand({
  run: (argv) => runGithubRunLog({ deps: productionGithubRunLogDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
