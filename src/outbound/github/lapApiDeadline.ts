/**
 * A wall deadline on every GitHub call `slopweaver github lap` awaits, so a request that never settles ends in a
 * typed failure rather than a lap that sits forever.
 *
 * A batch `--dry-run` was seen sitting 15m37s, and again past 13 minutes, with its one socket a CLOSED TCP
 * connection to GitHub and no child process. The batch preflight's last step is three awaited Octokit reads
 * (`protectionFacts`), none carrying a signal or a timeout: the write lane's client (`../../corpus/github/writeCtx.ts`)
 * and the resilient read client (`../../corpus/github/githubClient.ts`) take none, and `safeProviderCall` has no
 * cancellation contract. The only bound below them was undici's own, which the read client's retry plugin
 * multiplies.
 *
 * It RACES rather than aborts: threading a signal through both clients and their retry layers is a larger change,
 * and the CLI ends through `process.exit` (`../../cli/main.ts`), so an abandoned request cannot hold the process
 * once the lap returns. Two consequences are stated rather than discovered. A timed-out WRITE is not known absent —
 * a status POST may still land — so the caller reads the head before it re-sends one, and re-sends only a status it
 * does not find there, at most twice (`../../cli/commands/github/lapStatusPost.ts`). And the deadline covers the whole logical
 * method, its own retries and throttling waits included, so a legitimately long rate-limit wait is cut off too.
 *
 * The production timer is a REF'd `setTimeout`, cleared when the call settles: an unref'd one is exactly the timer the
 * runtime may skip when a dead request holds no live handle (`../../corpus/slack/channelDeadline.ts` says the same).
 */

import { ResultAsync } from "neverthrow";
import { type IngestError, toIngestError } from "../../lib/ingestError.js";
import { err, type Result } from "../../lib/result.js";
import type { GithubLapApi } from "./lapApi.js";

/**
 * How long one lap-owned GitHub call may take, its own retries included. A policy ceiling, not a measured latency:
 * every call it bounds is a small metadata or status read or write that answers in seconds when GitHub is healthy.
 */
export const LAP_GITHUB_CALL_TIMEOUT_MS = 60_000;

/** One armed deadline: a promise that resolves when it elapses, and the way to stand it down early. */
export interface LapDeadline {
  readonly elapsed: Promise<void>;
  readonly cancel: () => void;
}

/** Arm a deadline `ms` from now; a test passes one that elapses at once, or never. */
export type LapDeadlineTimer = (args: { ms: number }) => LapDeadline;

/**
 * The production deadline: a ref'd `setTimeout`, never `unref`'d, cleared by `cancel`.
 *
 * @param ms how long until it elapses
 * @returns the armed deadline
 */
export function realLapDeadlineTimer({ ms }: { ms: number }): LapDeadline {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const elapsed = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return {
    cancel: () => {
      clearTimeout(timer);
    },
    elapsed,
  };
}

/**
 * The typed failure a call that outlived its deadline ends in.
 *
 * @param operation the stable lap operation id, e.g. `github.lap.protection`
 * @param ms the deadline it outlived
 * @returns a network-kind `IngestError` coded `LAP_GITHUB_TIMEOUT`
 */
function lapGithubTimeout({ operation, ms }: { operation: string; ms: number }): IngestError {
  return {
    code: "LAP_GITHUB_TIMEOUT",
    kind: "network",
    message: `GitHub did not answer ${operation} within ${String(ms / 1_000)}s, so the lap treats the connection as dead`,
    operation,
    provider: "github",
  };
}

/**
 * Run one GitHub call against a deadline armed BEFORE it starts, cancelled whichever side wins.
 *
 * @param call the call to bound
 * @param operation the stable id the timeout failure names
 * @param ms how long it may take
 * @param timer the deadline seam
 * @returns the call's own result, or `LAP_GITHUB_TIMEOUT` when the deadline elapsed first
 */
export function withLapDeadline<T, E = IngestError>({
  call,
  operation,
  ms,
  timer,
}: {
  call: () => ResultAsync<T, E>;
  operation: string;
  ms: number;
  timer: LapDeadlineTimer;
}): ResultAsync<T, E | IngestError> {
  const deadline = timer({ ms });
  const timedOut = deadline.elapsed.then(() => err<T, E | IngestError>(lapGithubTimeout({ ms, operation })));
  // The call starts INSIDE the chain, so one that throws — synchronously or by rejecting — still reaches the
  // `finally` below as a typed failure, and the ref'd timer is never left armed behind an escaped exception.
  const answered = Promise.resolve()
    .then(async (): Promise<Result<T, E | IngestError>> => call())
    .catch((error: unknown) => err<T, E | IngestError>(toIngestError({ error, operation, provider: "github" })));
  const raced = Promise.race([answered, timedOut]).finally(() => {
    deadline.cancel();
  });
  return new ResultAsync(raced);
}

/**
 * Every method of the lap's GitHub surface behind its own deadline. Spelled out per method, never a loop over the
 * keys, so the operation each one names is reviewable and a method added to `GithubLapApi` fails to compile here.
 *
 * @param api the unbounded surface
 * @param ms how long each call may take
 * @param timer the deadline seam
 * @returns the same surface, each call ending in `LAP_GITHUB_TIMEOUT` at the latest by its deadline
 */
export function boundedLapApi({
  api,
  ms,
  timer,
}: {
  api: GithubLapApi;
  ms: number;
  timer: LapDeadlineTimer;
}): GithubLapApi {
  const bound = <T, E>({ operation, call }: { operation: string; call: () => ResultAsync<T, E> }) =>
    withLapDeadline({ call, ms, operation: `github.lap.${operation}`, timer });
  return {
    isAdmin: (args) => bound({ call: () => api.isAdmin(args), operation: "isAdmin" }),
    mergeRecord: (args) => bound({ call: () => api.mergeRecord(args), operation: "mergeRecord" }),
    postStatus: (args) => bound({ call: () => api.postStatus(args), operation: "postStatus" }),
    protection: (args) => bound({ call: () => api.protection(args), operation: "protection" }),
    read: (args) => bound({ call: () => api.read(args), operation: "read" }),
    requiredSources: (args) => bound({ call: () => api.requiredSources(args), operation: "requiredSources" }),
    statuses: (args) => bound({ call: () => api.statuses(args), operation: "statuses" }),
  };
}
