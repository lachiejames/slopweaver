/**
 * A pinned-host, timeout-bounded, retrying HTTP transport for the Vanta Manage API.
 *
 * ## Why the host is pinned rather than accepted per call
 *
 * Every caller passes a PATH, never a full URL. `oauth.ts`, `client.ts` and `writeClient.ts` all build
 * requests from data that ultimately traces back to Vanta's own responses (a `pageCursor`, a documented
 * endpoint path), so pinning the host here is what makes "this can only ever talk to Vanta" a property of
 * the transport rather than a discipline every caller has to remember.
 *
 * ## Why `redirect: 'manual'`
 *
 * A follow would silently re-issue the request — including the bearer token — at whatever host the
 * redirect names. Vanta's Manage API has no documented redirect behaviour, so a 3xx is treated as a
 * transport fault rather than something to chase.
 *
 * ## Pacing
 *
 * Manage requests are capped at 50/minute. `pagination.ts` and `client.ts` call this transport
 * sequentially, never concurrently, so evenly spacing at {@link MIN_REQUEST_INTERVAL_MS} keeps THIS transport
 * at most 46/minute, with margin. The cap belongs to the OAuth application, though, not to one process: a
 * second Vanta verb running beside a sync spends the same budget, and the pacing here cannot see it. That
 * contention arrives as a 429, and the 429's own backoff is what absorbs it — sized to outlast the minute
 * the budget refills over (`retryBackoff.ts` carries the ladders and the measurement behind them).
 */
import type { Logger } from "../../lib/logger.js";
import { err, ok, type Result } from "../../lib/result.js";
import { vantaDeadHostRefusal } from "./deadHostRefusal.js";
import { type VantaHttpError, VantaHttpErrors, type VantaTransportFailure } from "./httpErrors.js";
import { retryWaitSeconds } from "./retryBackoff.js";
import { diagnosticBodyText, publishableCause, requestRedaction } from "./transportRedaction.js";

/** The only host this transport will ever address. */
export const VANTA_API_HOST = "api.vanta.com";

const REQUEST_TIMEOUT_MS = 30_000;

/** Retries, not attempts — three retries means four tries at most. */
const MAX_RETRIES = 3;

/** Evenly spacing requests at this interval keeps a sequential caller under the 50/minute budget with margin. */
const MIN_REQUEST_INTERVAL_MS = 1_300;

/** The request shape this transport issues. Positional-free by construction — no caller builds a `Request`. */
export interface VantaRequestInit {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  /** A JSON string for most writes, or a `FormData` for a multipart upload. Absent for a GET/no-body write. */
  readonly body?: string | FormData;
  /**
   * Every secret value this request's BODY carries, named by the caller that put it there. Declaring any
   * WITHHOLDS a failing response's body from the log entirely — a reflection could come back in an encoding an
   * exact-text redactor misses — and the values are still redacted from the path. The token mint passes its
   * client id and secret; the bearer token needs no entry, because the transport reads it off `authorization`.
   * Declared rather than recovered by re-parsing the body: the transport sends a body, it never reads one.
   */
  readonly sensitiveValues?: readonly string[];
  /**
   * Whether this request may be re-sent after a retryable fault. `"standard"` — the default, and what every
   * read and every write before this flag existed gets — retries up to {@link MAX_RETRIES} times.
   *
   * `"never"` is for a write whose REPORT a replay would corrupt. Vanta's group membership endpoints answer
   * per person, so a first call that lands and then times out is followed by a retry whose per-person
   * results say "already in that group" for work that actually succeeded — the run reports a failure that
   * did not happen. Nothing here is forwarded to `fetch`; it is read by this module's own retry loop.
   */
  readonly retryPolicy?: "standard" | "never";
}

/** A response, exactly as read off the wire. */
export interface VantaRawResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** The HTTP seam. Injected so every branch below is reachable without a network call. */
// named-object-params-exempt: must match the real global fetch's positional shape to be substitutable for it
export type VantaFetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    redirect: "manual";
    signal: AbortSignal;
    body?: string | FormData;
  },
) => Promise<{ status: number; headers: Readonly<Record<string, string>>; text: () => Promise<string> }>;

/** What one call through the seam resolves to. */
type VantaFetchResponse = Awaited<ReturnType<VantaFetchLike>>;

/** The wait seam. Injected for the same reason — a test must not sleep for real seconds. */
export type VantaSleepLike = ({ seconds }: { seconds: number }) => Promise<void>;

/** A transport bound to the pinned host, with retry/backoff/pacing already wired in. */
export interface VantaTransport {
  request: (init: VantaRequestInit) => Promise<Result<VantaRawResponse, VantaTransportFailure>>;
}

/** A 3xx, refused rather than followed. Extracted so `attemptOnce` stays inside the line budget. */
function refusedRedirect({ safePath, status }: { safePath: string; status: number }): AttemptOutcome {
  return {
    diagnosticBody: null,
    responseStatus: status,
    result: err(VantaHttpErrors.redirectRefused({ safePath, status })),
    retryHeaders: {},
    retryable: false,
  };
}

/**
 * Read a response body, turning a rejection into a `Result` rather than letting it escape.
 *
 * Headers can arrive and the body then stall until the abort fires, and `response.text()` rejects when it
 * does. Left outside a catch, that rejection propagates all the way out of the sync run, which publishes
 * nothing — so every kind's coverage keeps saying `synced` while nothing was read. Retryable, because a
 * stalled body is exactly the transient fault the retry loop exists for.
 *
 * @param response the response whose body to read
 * @param safePath the request path, already stripped of anything secret, for the message
 * @returns the body, or why it could not be read
 */
async function readBody({
  response,
  safePath,
  withholdBody,
}: {
  response: { text: () => Promise<string> };
  safePath: string;
  withholdBody: boolean;
}): Promise<Result<string, VantaHttpError>> {
  try {
    return ok(await response.text());
  } catch (error: unknown) {
    return err(VantaHttpErrors.bodyUnread({ cause: publishableCause({ error, withholdBody }), safePath }));
  }
}

/** Whether a status is worth retrying at all. 401/403 and other 4xx are refusals, not transient faults. */
function isRetryableStatus({ status }: { status: number }): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** One attempt, bounded by the request timeout regardless of how `attemptOnce` itself resolves. */
async function attemptWithTimeout({
  fetchImpl,
  url,
  requestInit,
  safePath,
  secrets,
  withholdBody,
}: {
  fetchImpl: VantaFetchLike;
  url: string;
  requestInit: VantaRequestInit;
  safePath: string;
  secrets: readonly string[];
  withholdBody: boolean;
}): Promise<AttemptOutcome> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    return await attemptOnce({
      fetchImpl,
      init: {
        headers: { ...requestInit.headers },
        method: requestInit.method,
        redirect: "manual",
        signal: controller.signal,
        ...(requestInit.body === undefined ? {} : { body: requestInit.body }),
      },
      safePath,
      secrets,
      withholdBody,
      url,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** One attempt's outcome: the result if this attempt is final, or whether it is worth retrying. */
interface AttemptOutcome {
  readonly result: Result<VantaRawResponse, VantaTransportFailure>;
  readonly retryable: boolean;
  readonly retryHeaders: Readonly<Record<string, string>>;
  /** The status the response carried, or `null` when none arrived — what picks a 429's longer backoff. */
  readonly responseStatus: number | null;
  /**
   * A failing response's own body, for the operator to READ and for nothing to STORE.
   *
   * It is carried here rather than folded into the failure reason because a reason is published: it reaches
   * a coverage cell, a gap and the manifest's `lastAttempt.reasons`, all of which are committed to the
   * generation on disk. A provider's error body is arbitrary text this code did not author and cannot
   * bound, so persisting it means persisting whatever Vanta chose to say — a resource name, a person, a
   * token echoed back. Logging it keeps the diagnosis and drops the artifact.
   */
  readonly diagnosticBody: string | null;
}

async function attemptOnce({
  fetchImpl,
  url,
  init,
  safePath,
  secrets,
  withholdBody,
}: {
  fetchImpl: VantaFetchLike;
  url: string;
  init: {
    method: string;
    headers: Record<string, string>;
    redirect: "manual";
    signal: AbortSignal;
    body?: string | FormData;
  };
  /** The request path, already redacted by the one caller that computes it — see `request()` below. */
  safePath: string;
  secrets: readonly string[];
  withholdBody: boolean;
}): Promise<AttemptOutcome> {
  let response: VantaFetchResponse;
  try {
    response = await fetchImpl(url, init);
  } catch (error: unknown) {
    return {
      diagnosticBody: null,
      responseStatus: null,
      result: err(
        VantaHttpErrors.unreachable({
          cause: publishableCause({ error, withholdBody }),
          host: VANTA_API_HOST,
          safePath,
        }),
      ),
      retryHeaders: {},
      retryable: true,
    };
  }
  return classifyResponse({ response, safePath, secrets, withholdBody });
}

/** The response half of one attempt: a redirect refused, the body read, then success or a typed failure. */
async function classifyResponse({
  response,
  safePath,
  secrets,
  withholdBody,
}: {
  response: VantaFetchResponse;
  safePath: string;
  secrets: readonly string[];
  /** Whether the request declared credentials in its body, so a failing body is never logged. */
  withholdBody: boolean;
}): Promise<AttemptOutcome> {
  if (response.status >= 300 && response.status < 400) {
    return refusedRedirect({ safePath, status: response.status });
  }
  const read = await readBody({ response, safePath, withholdBody });
  if (read.isErr()) {
    return {
      diagnosticBody: null,
      responseStatus: response.status,
      result: err(read.error),
      // The headers DID arrive, so a 429 whose body stalls still has its own Retry-After honoured.
      retryHeaders: response.headers,
      retryable: true,
    };
  }
  const body = read.value;
  if (response.status >= 200 && response.status < 300) {
    return {
      diagnosticBody: null,
      responseStatus: response.status,
      result: ok({ body, headers: response.headers, status: response.status }),
      retryHeaders: {},
      retryable: false,
    };
  }
  // The response BODY is deliberately absent from the failure: its lines are published — a coverage cell, a
  // gap and the manifest's `lastAttempt.reasons`, all committed to the generation on disk — and the body is
  // text the provider chose. `redactSecrets` cannot close that: it replaces only what this process SENT.
  // The body is not discarded: `diagnosticBody` carries it to the caller, which logs it.
  return {
    diagnosticBody: diagnosticBodyText({ body, secrets, withholdBody }),
    responseStatus: response.status,
    result: err(VantaHttpErrors.httpStatus({ safePath, status: response.status })),
    retryHeaders: response.headers,
    retryable: isRetryableStatus({ status: response.status }),
  };
}

/**
 * Build the transport.
 *
 * @param logger where a retry wait is announced, so a multi-second pause is not silent
 * @param fetchImpl the HTTP seam, defaulting to the global `fetch`
 * @param sleep the wait seam, defaulting to a real timer
 * @returns a transport bound to the pinned Vanta host
 */
export function createVantaTransport({
  logger,
  fetchImpl = globalVantaFetch,
  sleep = realSleep,
}: {
  logger: Logger;
  fetchImpl?: VantaFetchLike;
  sleep?: VantaSleepLike;
}): VantaTransport {
  let lastRequestAtMs: number | null = null;

  /** Wait out what remains of the interval since the last request, then mark this one as sent. */
  const pace = async (): Promise<void> => {
    const elapsed = lastRequestAtMs === null ? MIN_REQUEST_INTERVAL_MS : Date.now() - lastRequestAtMs;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await sleep({ seconds: (MIN_REQUEST_INTERVAL_MS - elapsed) / 1000 });
    }
    lastRequestAtMs = Date.now();
  };

  const request = async (requestInit: VantaRequestInit): Promise<Result<VantaRawResponse, VantaTransportFailure>> => {
    const url = `https://${VANTA_API_HOST}${requestInit.path}`;
    const { safePath, secrets, withholdBody } = requestRedaction({ requestInit });
    // A write carrying a dead Datadog host is refused before it is paced, sent or retried.
    const refusal = await vantaDeadHostRefusal({ requestInit, safePath });
    if (refusal !== undefined) {
      return err(refusal);
    }
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      await pace();
      const outcome = await attemptWithTimeout({ fetchImpl, requestInit, safePath, secrets, url, withholdBody });
      // The failing body is READ here and stored nowhere. `VantaHttpErrors.httpStatus` deliberately keeps it out
      // of the lines, because a line is published into the generation; a log line is not.
      if (outcome.diagnosticBody !== null && outcome.diagnosticBody.length > 0) {
        logger.warn({ msg: `${safePath} responded: ${outcome.diagnosticBody}` });
      }
      const mayRetry = requestInit.retryPolicy !== "never";
      if (outcome.retryable && mayRetry && attempt < MAX_RETRIES) {
        const wait = retryWaitSeconds({ attempt, headers: outcome.retryHeaders, status: outcome.responseStatus });
        logger.warn({
          msg: `${safePath} failed with a retryable fault; waiting ${String(wait)}s before retry ${String(attempt + 1)}/${String(MAX_RETRIES)}`,
        });
        await sleep({ seconds: wait });
        continue;
      }
      return outcome.result;
    }
    // Unreachable: the loop above always returns on its last iteration.
    return err(VantaHttpErrors.retriesExhausted({ safePath }));
  };

  return { request };
}

const globalVantaFetch: VantaFetchLike = async (url, init) => {
  const response = await globalThis.fetch(url, init);
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return { headers, status: response.status, text: () => response.text() };
};

const realSleep: VantaSleepLike = ({ seconds }) =>
  new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
