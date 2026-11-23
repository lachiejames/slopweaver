/**
 * What a Microsoft Graph SDK throw becomes before `safeProviderCall` classifies it.
 *
 * The SDK's `GraphError` is close to what `src/lib/ingestError.ts` reads, and wrong in two ways that each
 * change a retry decision:
 *
 * - **A request that got no response carries `statusCode: -1`.** The SDK builds its error from the fetch
 *   failure with the base error discarded (`GraphErrorHandler.constructError` in
 *   `@microsoft/microsoft-graph-client` 3.0.7), so a dropped socket arrives as an HTTP failure with status
 *   `-1` — which the classifier would call a permanent HTTP error. It is rethrown here with NO status, so the
 *   `fetch failed` message classifies it as the network failure it is.
 * - **`Retry-After` sits on a fetch `Headers` object at `error.headers`**, where the classifier, which reads a
 *   plain `retryAfter` or `response.headers['retry-after']`, cannot see it. It is lifted to `retryAfter`
 *   (seconds), so a 429's own wait is honoured by the shared block.
 *
 * Anything that is not a `GraphError` passes through unchanged.
 */
import { GraphError } from "./client.js";

/** A Graph failure in the shape the shared classifier reads. */
export class GraphCallError extends Error {
  /** The HTTP status Graph answered. */
  readonly status: number;
  /** Graph's own error code, e.g. `InefficientFilter`, `ErrorItemNotFound`. */
  readonly code: string | undefined;
  /** The `Retry-After` Graph sent, in seconds. */
  readonly retryAfter: number | undefined;

  constructor({
    message,
    status,
    code,
    retryAfter,
  }: {
    message: string;
    status: number;
    code: string | undefined;
    retryAfter: number | undefined;
  }) {
    super(message);
    this.name = "GraphCallError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/**
 * The longest `Retry-After` a verb honours, in seconds. The shared block waits on an ABSOLUTE deadline, so an
 * unbounded hint — `1e308` overflows to an infinite deadline once scaled to ms — would hold a verb forever
 * before any request, where no fetch deadline reaches. A longer ask is waited at this ceiling, and the retry
 * meets Graph's answer again.
 */
const MAX_HONOURED_RETRY_AFTER_SECONDS = 120;

/** The `Retry-After` seconds on a Graph error's headers, when it carried a numeric one, at most the ceiling. */
function retryAfterSeconds({ headers }: { headers: unknown }): number | undefined {
  if (!(headers instanceof Headers)) {
    return undefined;
  }
  const raw = headers.get("retry-after");
  if (raw === null) {
    return undefined;
  }
  const seconds = Number(raw);
  if (Number.isNaN(seconds)) {
    return undefined;
  }
  return Math.min(seconds, MAX_HONOURED_RETRY_AFTER_SECONDS);
}

/**
 * Normalise one thrown value from a Graph SDK call — see this file's header for both corrections.
 *
 * @param error whatever the SDK call rejected with
 * @returns the value to rethrow: a status-free `Error` for a request that got no response, a
 *   {@link GraphCallError} for one Graph answered, or the input unchanged when it is not a `GraphError`
 */
export function normaliseGraphThrow({ error }: { error: unknown }): unknown {
  if (!(error instanceof GraphError)) {
    return error;
  }
  const message = error.message.length > 0 ? error.message : `Graph answered HTTP ${String(error.statusCode)}`;
  if (error.statusCode < 0) {
    return new Error(`fetch failed: ${message}`);
  }
  return new GraphCallError({
    code: typeof error.code === "string" ? error.code : undefined,
    message,
    retryAfter: retryAfterSeconds({ headers: error.headers }),
    status: error.statusCode,
  });
}

/**
 * Rethrow a Graph SDK rejection normalised — the `.catch` every Graph call inside `safeProviderCall` ends in.
 *
 * @param error whatever the SDK call rejected with
 * @returns never; it always throws
 */
export function rethrowGraph({ error }: { error: unknown }): never {
  throw normaliseGraphThrow({ error });
}

/**
 * Whether a failure Graph answered carries one of Graph's own error codes.
 *
 * @param cause the `cause` an `IngestError` preserved
 * @param code the Graph error code to look for
 * @returns true when the cause is a {@link GraphCallError} with that code
 */
export function graphCodeIs({ cause, code }: { cause: unknown; code: string }): boolean {
  return cause instanceof GraphCallError && cause.code === code;
}
