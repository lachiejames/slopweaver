/**
 * The production seams behind `github run-log` — the two JSON reads, and the streamed log body.
 *
 * Split out of `./runLogRun.ts` so the shell stays a shell: everything here is transport, and every line of
 * it is on the same provider door (`safeProviderCall`, `provider: "github"`) that `githubReadRest` uses.
 * There is no second client and no raw `fetch` outside the door — `scheduler-bypass` and AGENTS.md rule 3
 * are what that keeps true.
 *
 * ## Why the log is fetched in two calls rather than one
 *
 * `GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs` answers 302 with a signed `location` on GitHub's
 * log blob host. Octokit follows it by default and hands back the WHOLE body as one JS string — MEASURED
 * 3,213,680 bytes for one `unit` job — which is precisely the data-sized payload
 * `.claude/rules/typescript-patterns.md` forbids. So the first call asks for the redirect and NOT the body
 * (`redirect: "manual"`, measured to return a zero-length body), and the second streams the location.
 *
 * A byte range would have been simpler and is not available: MEASURED, the blob host answers
 * `Range: bytes=-65536` with `200` and the entire body, no `content-range`. Reproduce by taking the
 * `location` from the manual-redirect call and re-requesting it with that header.
 */

import { githubScopeId, makeGithubClient } from "../../../corpus/github/githubClient.js";
import { errorStatus } from "../../../lib/ingestError.js";
import { isRecord } from "../../../lib/parsers.js";
import { safeProviderCall } from "../../../lib/providerCall.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type GithubJobLogError, GithubJobLogErrors } from "../../../live/github/jobLogErrors.js";
import type { FetchWorkflowRun, FetchWorkflowRunJobs, StreamJobLog } from "../../../live/github/jobLogRead.js";

/** The statuses that mean GitHub no longer holds this log, rather than that the request went wrong. */
export const EXPIRED_STATUSES: readonly number[] = [404, 410];

/**
 * The `location` header of a manual-redirect response, when it carried one.
 *
 * Reads the response as an unknown shape rather than an Octokit type because `client.request` is called by
 * ROUTE STRING here, so its return is `unknown` by construction and a cast would assert what was not checked.
 *
 * @param response whatever the manual-redirect call answered
 * @returns the signed blob URL, or undefined when the response named none
 */
export function redirectLocation({ response }: { response: unknown }): string | undefined {
  if (!isRecord(response) || !isRecord(response["headers"])) {
    return undefined;
  }
  const location = response["headers"]["location"];
  return typeof location === "string" && location.length > 0 ? location : undefined;
}

/**
 * The HTTP status a manual-redirect response reported.
 *
 * Zero is the "carried none" answer rather than `undefined`, because its only consumer is the
 * `REDIRECT_MISSING` message, where a number a reader can compare against 302 is what helps.
 *
 * @param response whatever the manual-redirect call answered
 * @returns the reported status, or 0
 */
export function responseStatus({ response }: { response: unknown }): number {
  if (!isRecord(response) || typeof response["status"] !== "number") {
    return 0;
  }
  return response["status"];
}

/**
 * Decode a fetch response body as a stream of text chunks.
 *
 * `TextDecoder` is driven with `{ stream: true }` so a multi-byte character split across two network chunks
 * decodes correctly rather than becoming a replacement character — the ordinary case on a body this size,
 * not an edge.
 *
 * @param body the response body stream
 * @returns an async iterable of decoded text chunks
 */
export async function* decodeBody({ body }: { body: ReadableStream<Uint8Array> }): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  try {
    for (;;) {
      const read = await reader.read();
      if (read.done) {
        break;
      }
      yield decoder.decode(read.value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail.length > 0) {
      yield tail;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * One doored REST call, with the three fields a caller here branches on lifted out of the typed error.
 *
 * A local shape rather than a domain union: it is consumed inside this file only, by three seams that each
 * map it into `GithubJobLogError` at their own boundary.
 */
type DoorRequest = (args: {
  route: string;
  params: Readonly<Record<string, unknown>>;
  operation: string;
}) => Promise<Result<unknown, { status: number | undefined; message: string; cause: unknown }>>;

/** Bind one Octokit client and scope to the shared provider door. */
function doorRequest({
  client,
  scopeId,
}: {
  client: ReturnType<typeof makeGithubClient>;
  scopeId: string;
}): DoorRequest {
  return async ({ route, params, operation }) => {
    const called = await safeProviderCall({
      execute: () => client.request(route, params),
      operation,
      provider: "github",
      retryMode: "never",
      scopeId,
    });
    if (called.isErr()) {
      return err({ cause: called.error, message: called.error.message, status: errorStatus({ error: called.error }) });
    }
    return ok(called.value);
  };
}

/** The run-header seam: one GET, with 404 meaning the run rather than the request. */
function runHeaderSeam({ request }: { request: DoorRequest }): FetchWorkflowRun {
  return async ({ owner, repo, runId }) => {
    const called = await request({
      operation: "github.rest.actionsRunRead",
      params: { owner, repo, run_id: runId },
      route: "GET /repos/{owner}/{repo}/actions/runs/{run_id}",
    });
    if (called.isErr()) {
      if (called.error.status === 404) {
        return err(GithubJobLogErrors.runNotFound({ runId }));
      }
      return err(GithubJobLogErrors.logFetchFailed({ cause: called.error.cause, message: called.error.message }));
    }
    return ok(called.value);
  };
}

/** The jobs-page seam. One page of 100 is every job a run of this repository has ever had. */
function runJobsSeam({ request }: { request: DoorRequest }): FetchWorkflowRunJobs {
  return async ({ owner, repo, runId }) => {
    const called = await request({
      operation: "github.rest.actionsRunJobsRead",
      params: { owner, per_page: 100, repo, run_id: runId },
      route: "GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs",
    });
    if (called.isErr()) {
      if (called.error.status === 404) {
        return err(GithubJobLogErrors.runNotFound({ runId }));
      }
      return err(GithubJobLogErrors.logFetchFailed({ cause: called.error.cause, message: called.error.message }));
    }
    return ok(called.value);
  };
}

/** Ask for the signed location without following it — the half of the log read that stays on the REST door. */
async function logLocation({
  request,
  owner,
  repo,
  jobId,
}: {
  request: DoorRequest;
  owner: string;
  repo: string;
  jobId: number;
}): Promise<Result<string, GithubJobLogError>> {
  const redirect = await request({
    operation: "github.rest.actionsJobLogRedirect",
    // The body is deliberately NOT followed here — see this module's header. `redirect: "manual"` is what
    // keeps a multi-megabyte log out of one JS string.
    params: { job_id: jobId, owner, repo, request: { redirect: "manual" } },
    route: "GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs",
  });
  if (redirect.isErr()) {
    const status = redirect.error.status;
    if (status !== undefined && EXPIRED_STATUSES.includes(status)) {
      return err(GithubJobLogErrors.logUnavailable({ jobId }));
    }
    return err(GithubJobLogErrors.logFetchFailed({ cause: redirect.error.cause, message: redirect.error.message }));
  }
  const location = redirectLocation({ response: redirect.value });
  if (location === undefined) {
    return err(GithubJobLogErrors.redirectMissing({ jobId, status: responseStatus({ response: redirect.value }) }));
  }
  return ok(location);
}

/** The log-body seam: resolve the signed location, then stream it as decoded text chunks. */
function jobLogSeam({ request, scopeId }: { request: DoorRequest; scopeId: string }): StreamJobLog {
  return async ({ owner, repo, jobId }) => {
    const location = await logLocation({ jobId, owner, repo, request });
    if (location.isErr()) {
      return err(location.error);
    }
    const streamed = await safeProviderCall({
      execute: async () => fetch(location.value, { headers: { "accept-encoding": "identity" } }),
      operation: "github.blob.actionsJobLogStream",
      provider: "github",
      retryMode: "never",
      scopeId,
    });
    if (streamed.isErr()) {
      return err(GithubJobLogErrors.logFetchFailed({ cause: streamed.error, message: streamed.error.message }));
    }
    const response = streamed.value;
    if (!response.ok) {
      if (EXPIRED_STATUSES.includes(response.status)) {
        return err(GithubJobLogErrors.logUnavailable({ jobId }));
      }
      return err(
        GithubJobLogErrors.logFetchFailed({
          cause: response.status,
          message: `the log host answered ${String(response.status)}`,
        }),
      );
    }
    const body = response.body;
    if (body === null) {
      return err(GithubJobLogErrors.logFetchFailed({ cause: undefined, message: "the log host sent no body" }));
    }
    return ok(decodeBody({ body }));
  };
}

/**
 * Build the three production seams over one resilient Octokit client and the shared provider door.
 *
 * @param token the GitHub token, or undefined for an unauthenticated public read
 * @returns the run-header, jobs-page and streamed-log seams
 */
export function productionRunLogSeams({ token }: { token: string | undefined }): {
  fetchRun: FetchWorkflowRun;
  fetchJobs: FetchWorkflowRunJobs;
  streamLog: StreamJobLog;
} {
  const scopeId = githubScopeId({ token });
  const request = doorRequest({ client: makeGithubClient({ token }), scopeId });
  return {
    fetchJobs: runJobsSeam({ request }),
    fetchRun: runHeaderSeam({ request }),
    streamLog: jobLogSeam({ request, scopeId }),
  };
}
