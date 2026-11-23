/**
 * `github checks`'s production edge, built once and injected.
 *
 * Split out of `./checksRun.ts` for the same reason `./checksLogRun.ts` was: the watch shells (`./checksRun.ts` and
 * `./checksEventWatch.ts`) hold the DECISIONS a watch makes, and every line here is transport wiring — a credential read, a client, and the closures
 * that carry them. Keeping both in one file is what pushed it past the `file-size-ratchet` floor.
 */
import { githubToken, parseRepositorySlug, resolveRepository } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { makeFetchGithubChecks } from "../../../live/github/checksRead.js";
import { readJobLogs } from "../../../live/github/jobLogRead.js";
import { makeGithubMergeQueueReads } from "../../../live/github/mergeQueue.js";
import { makeFetchGithubPrActivity } from "../../../live/github/prEvents.js";
import { githubReadGraphql, githubReadRest } from "../../../live/github/read.js";
import { productionRegisterRecorders } from "./checksRegister.js";
import type { GithubChecksDeps } from "./checksSeams.js";
import { productionRunLogSeams } from "./runLogSeams.js";

/**
 * Production checks edge: the same live GraphQL seam `github read` uses, governed by `safeProviderCall`'s
 * pacing and retry policy.
 *
 * @returns credential-aware, safe checks-fetch + repo resolution, and output sinks
 */
export function productionGithubChecksDeps(): GithubChecksDeps {
  return {
    fetchActivity: ({ owner, repo, number, home }) => {
      const token = githubToken(home === undefined ? {} : { home });
      return makeFetchGithubPrActivity({ graphql: githubReadGraphql({ token }) })({ number, owner, repo });
    },
    fetchChecks: ({ owner, repo, number, limit, home }) => {
      const token = githubToken(home === undefined ? {} : { home });
      return makeFetchGithubChecks({ graphql: githubReadGraphql({ token }) })({ limit, number, owner, repo });
    },
    fetchRequiredContexts: ({ owner, repo, branch, home }) => {
      const token = githubToken(home === undefined ? {} : { home });
      const reads = makeGithubMergeQueueReads({
        graphql: githubReadGraphql({ token }),
        rest: githubReadRest({ token }),
      });
      return reads.requiredContexts({ branch, owner, repo });
    },
    now: () => new Date(),
    readJobLogs: ({ owner, repo, runId, jobIds, lines, home }) => {
      const token = githubToken(home === undefined ? {} : { home });
      const seams = productionRunLogSeams({ token });
      return readJobLogs({
        fetchJobs: seams.fetchJobs,
        fetchRun: seams.fetchRun,
        job: undefined,
        jobIds,
        nowIso: () => new Date().toISOString(),
        owner,
        repo,
        runId,
        streamLog: seams.streamLog,
        tailLines: lines,
      });
    },
    ...productionRegisterRecorders(),
    resolveRepo: ({ explicit }) =>
      explicit !== undefined ? parseRepositorySlug({ slug: explicit }) : resolveRepository(),
    sleep: ({ ms }) => new Promise((resolve) => setTimeout(resolve, ms)),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}
