/**
 * One Actions workflow run — read it, list a commit's runs, and re-run its failed jobs. The transport behind
 * `slopweaver github rerun`, in the write lane's own client rather than `./write.ts`, which sits at its
 * file-size ceiling.
 *
 * Re-running is the act a seat reached for raw `gh run rerun --failed` to do, because no verb
 * did it. GitHub answers `POST /actions/runs/{id}/rerun-failed-jobs` with a bare 201 and nothing else, so what
 * proves the write landed is a separate read of the run: its `run_attempt` advances synchronously.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import type { RepoRef, WriteCtx } from "./write.js";

/** The page size a commit's runs are listed at — one page, since one commit rarely starts more than a handful. */
const RUNS_PAGE_SIZE = 100;

/** One workflow run, narrowed to what deciding and confirming a re-run needs. */
export interface WorkflowRunState {
  readonly id: number;
  readonly name: string;
  readonly htmlUrl: string;
  readonly headSha: string;
  /** The workflow file this is a run of — with `event`, what a newer run on the same commit supersedes. */
  readonly workflowId: number;
  /** What triggered it: `pull_request`, `push`, `merge_group`, … */
  readonly event: string;
  /** `queued`, `in_progress`, `completed`, … — null when GitHub has not assigned one yet. */
  readonly status: string | null;
  /** `success`, `failure`, `cancelled`, `timed_out`, … — null until the run completes. */
  readonly conclusion: string | null;
  /** Which attempt this is, counting from 1; undefined when GitHub's payload omitted it. */
  readonly runAttempt: number | undefined;
}

/** The fields of GitHub's run payload this module reads. */
interface RawRun {
  readonly id: number;
  readonly name?: string | null;
  readonly html_url: string;
  readonly head_sha: string;
  readonly workflow_id: number;
  readonly event: string;
  readonly status: string | null;
  readonly conclusion: string | null;
  readonly run_attempt?: number;
}

/** Narrow one run payload. A run with no name is named by its id, which is what GitHub's own UI falls back to. */
function toRunState({ run }: { run: RawRun }): WorkflowRunState {
  let name = `run ${String(run.id)}`;
  if (typeof run.name === "string" && run.name.length > 0) {
    name = run.name;
  }
  return {
    conclusion: run.conclusion,
    event: run.event,
    headSha: run.head_sha,
    htmlUrl: run.html_url,
    id: run.id,
    name,
    runAttempt: run.run_attempt,
    status: run.status,
    workflowId: run.workflow_id,
  };
}

/**
 * Read one workflow run. Repeatable, so transient retries are allowed.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the repository and the run's numeric id
 * @returns the run's state, or the provider failure
 */
export function workflowRunVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { runId: number };
}): ResultAsync<WorkflowRunState, IngestError> {
  const { owner, repo, runId } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.actions.getWorkflowRun({ owner, repo, run_id: runId });
      return toRunState({ run: res.data });
    },
    operation: "github.actions.getWorkflowRun",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Every workflow run GitHub started for one commit, across every event, with whether the one page read
 * reached the end — a caller claiming "nothing failed" must refuse a truncated read.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the repository and the commit's full SHA
 * @returns the runs and whether the list was truncated, or the provider failure
 */
export function runsForHeadVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { headSha: string };
}): ResultAsync<{ readonly runs: readonly WorkflowRunState[]; readonly truncated: boolean }, IngestError> {
  const { owner, repo, headSha } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.actions.listWorkflowRunsForRepo({
        head_sha: headSha,
        owner,
        per_page: RUNS_PAGE_SIZE,
        repo,
      });
      const runs = res.data.workflow_runs.map((run) => toRunState({ run }));
      return { runs, truncated: res.data.total_count > runs.length };
    },
    operation: "github.actions.listWorkflowRunsForRepo",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Re-run every failed job of one completed workflow run, and the jobs that depend on them. Sent once; the
 * caller confirms with a separate read, because GitHub's 201 carries no body.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the repository and the run's numeric id
 * @returns nothing on GitHub's acceptance, or the provider failure
 */
export function rerunFailedJobsVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: RepoRef & { runId: number };
}): ResultAsync<void, IngestError> {
  const { owner, repo, runId } = input;
  return safeProviderCall({
    execute: async () => {
      await ctx.client.rest.actions.reRunWorkflowFailedJobs({ owner, repo, run_id: runId });
    },
    operation: "github.actions.reRunWorkflowFailedJobs",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}
