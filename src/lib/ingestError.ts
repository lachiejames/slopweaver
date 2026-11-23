/**
 * The one typed error the ingest/retrieval boundaries speak. Every external throw — an SDK 429, a
 * network ECONNRESET, a `JSON.parse` SyntaxError, a filesystem ENOENT, a `codex` timeout — is mapped by
 * {@link toIngestError} into this small discriminated union, PRESERVING the status/code/retry-after/cause
 * that the old boolean `isTransientError` flattened away. `cause` is the original thrown value verbatim
 * (identity kept), so nothing is lost on the way to a typed `Result`.
 *
 * Pure module — no I/O, no throwing. The `safe*` wrappers ({@link ../lib/safeBoundary}) call it at each
 * boundary; {@link ../lib/resilience} classifies the typed error for retry; the connectors format it back
 * into their warning/error strings via {@link formatIngestError}, so the fatal-vs-warning policy is
 * unchanged.
 *
 * ## The status/code extraction reads the whole `cause` CHAIN, and a transport code outranks a status
 *
 * An SDK re-throws rather than passing the original up: `@octokit/request` turns every `fetch` rejection
 * into `RequestError(message, 500, …)`, and `fetch` itself already wrapped undici's real failure. So the
 * only link that knows a socket died is two `cause` hops down, and the only status present is one the SDK
 * invented. Reading the top level alone reported `HTTP 500: other side closed` for a request GitHub never
 * answered — which is why {@link codeOf} walks the chain and {@link toIngestError} suppresses a status
 * whenever a transport code is found.
 */
import { isRecord } from "./parsers.js";

/**
 * Which boundary a failure arose at. `rate-limit`/`network` are HTTP refinements a retry can clear;
 * `http` is any other HTTP status; `parse` is a malformed-response/JSON failure; `io` is a filesystem
 * failure; `llm` is a model call — Codex, the on-device embedder, or the reranker (all are inference
 * calls with no network status to key on).
 */
export type IngestErrorKind = "http" | "rate-limit" | "network" | "parse" | "io" | "llm";

/** A typed boundary failure. Optional fields are present only when the source error carried them. */
export interface IngestError {
  readonly kind: IngestErrorKind;
  /** The boundary operation, e.g. `slack.conversations.history` or `writeJsonFile`. */
  readonly operation: string;
  readonly message: string;
  /** The external system, e.g. `slack`/`linear`/`notion`/`codex`/`embed` (absent for pure fs/parse). */
  readonly provider?: string;
  /** The filesystem path, for an `io` failure. */
  readonly path?: string;
  /** The HTTP status, when the error carried one. */
  readonly status?: number;
  /** A Node errno (`ENOENT`) or SDK string code (`ratelimited`), when present. */
  readonly code?: string;
  /** A parsed `Retry-After` hint in ms, when the error/response exposed one. */
  readonly retryAfterMs?: number;
  /** The original thrown value, verbatim (identity preserved). */
  readonly cause?: unknown;
}

/** Node network error codes a retry can plausibly clear. */
const NETWORK_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
]);
/**
 * The CRITERION for undici's transport failures, deliberately a prefix rather than a list of the codes that
 * exist today: every one of undici's own errors carries a `UND_ERR_*` code and every one of them is raised
 * INSTEAD of an HTTP response — `UND_ERR_SOCKET`, `UND_ERR_CONNECT_TIMEOUT`, `UND_ERR_HEADERS_TIMEOUT`,
 * `UND_ERR_BODY_TIMEOUT`. Enumerating them would leave the next one classified as an HTTP failure, which is
 * the exact wrong answer for a request that never got a reply. Reproduce the class:
 * `node -e 'fetch("http://127.0.0.1:1/").catch(e=>console.log(e.cause.code))'`.
 */
const UNDICI_CODE_PREFIX = "UND_ERR_";
/**
 * A provider SDK's OWN request timeout: the SDK stopped waiting for a reply, so no response came back, the
 * same transport failure as `ETIMEDOUT` under an SDK-chosen code and with no errno anywhere in its message.
 * `@notionhq/client`'s `RequestTimeoutError` fires at the SDK's 60s default, ahead of the 90s deadline
 * `corpus/notion/callDeadline.ts` races every Notion call against. Left out of this set, it fell through to an
 * `http` failure with no status, which `retryDecision` calls permanent, so a single slow Notion reply was
 * never retried. A `resync-corpus-notion` firing failed that way; its sync-run record is under
 * `$SLOPWEAVER_HOME/live/sync-runs/notion/`.
 *
 * Keyed to the ONE provider whose SDK mints each code, because `network` is also what licenses a
 * witness-gated resend of an irreversible write (`cli/commands/github/enqueueFailure.ts`): an SDK's private
 * code is evidence about that SDK's calls only, so it must not reclassify another provider's failure.
 */
const SDK_TIMEOUT_CODES: ReadonlyMap<string, string> = new Map([["notionhq_client_request_timeout", "notion"]]);
/**
 * SDK string codes that mean "rate limited" (Slack's `ratelimited`, common `rate_limited`).
 *
 * `slack_webapi_rate_limited_error` is the one that is easy to miss and expensive to miss. When a
 * `WebClient` is built with `rejectRateLimitedCalls: true` — which PR5.2.1b does for the READ clients, so a
 * 429 reaches the shared block instead of being slept off inside the SDK — the thrown
 * `WebAPIRateLimitedError` carries ONLY that code and a `retryAfter`. It has no `status`, so without this
 * entry {@link resolveKind} lands on `http`, `hasTransientStatus` is false, and {@link retryDecision}
 * classifies a plain 429 as PERMANENT: the call would fail outright, unretried, and never record the block.
 */
const RATE_LIMIT_CODES: ReadonlySet<string> = new Set([
  "ratelimited",
  "rate_limited",
  "slack_webapi_rate_limited_error",
]);
/** Retryable HTTP statuses (429 rate-limit + the transient 5xx family). */
const TRANSIENT_STATUS: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);

/** Read a property off an unknown error object without asserting its shape. */
function readProp({ value, key }: { value: unknown; key: string }): unknown {
  return isRecord(value) && key in value ? value[key] : undefined;
}

/** The error's own `.status`, else its `.statusCode` when `.status` is absent or null — not yet checked to be a number. */
function directStatus({ error }: { error: unknown }): unknown {
  const status = readProp({ key: "status", value: error });
  if (status == null) {
    return readProp({ key: "statusCode", value: error });
  }
  return status;
}

/** The HTTP status carried by an error (`.status` / `.statusCode` / `.response.status`), if any. */
function statusOf({ error }: { error: unknown }): number | undefined {
  const direct = directStatus({ error });
  if (typeof direct === "number") {
    return direct;
  }
  const response = readProp({ key: "response", value: error });
  const nested = readProp({ key: "status", value: response });
  return typeof nested === "number" ? nested : undefined;
}

/**
 * Every value in a thrown error's `cause` chain, outermost first, bounded so a self-referential `cause`
 * cannot spin.
 *
 * The chain exists because an SDK re-throws: `@octokit/request` catches whatever `fetch` raised and throws
 * `new RequestError(message, 500, { request })` with the original hung on `.cause`
 * (`node_modules/@octokit/request/dist-bundle/index.js`), and `fetch` itself already wrapped undici's real
 * failure the same way. So the only error that knows a socket died sits TWO links down.
 */
function causeChain({ error }: { error: unknown }): readonly unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let link: unknown = error;
  while (link !== undefined && link !== null && !seen.has(link)) {
    seen.add(link);
    chain.push(link);
    link = readProp({ key: "cause", value: link });
  }
  return chain;
}

/**
 * The string code carried by an error or by anything in its `cause` chain, outermost first.
 *
 * Reading only the top level is what threw `UND_ERR_SOCKET` away for every Octokit call in this program:
 * `RequestError` declares no `code` at all, so a socket that died reported no code and, with Octokit's
 * synthetic `status: 500` present, classified as an ordinary HTTP failure.
 */
function codeOf({ error }: { error: unknown }): string | undefined {
  for (const link of causeChain({ error })) {
    const code = readProp({ key: "code", value: link });
    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }
  return undefined;
}

/**
 * Whether a code means the request never got an HTTP response at all — a Node network errno, any of
 * undici's own transport failures (see {@link UNDICI_CODE_PREFIX}), or a provider SDK's own request timeout
 * raised by the provider whose SDK owns that code (see {@link SDK_TIMEOUT_CODES}).
 */
function isTransportCode({ code, provider }: { code: string | undefined; provider: string | undefined }): boolean {
  if (code === undefined) {
    return false;
  }
  const sdkTimeout = provider !== undefined && SDK_TIMEOUT_CODES.get(code) === provider;
  return NETWORK_CODES.has(code) || code.startsWith(UNDICI_CODE_PREFIX) || sdkTimeout;
}

/** A `Retry-After`/`retryAfter` hint (seconds → ms), from the error or its response headers, if present. */
function retryAfterMsOf({ error }: { error: unknown }): number | undefined {
  const direct = readProp({ key: "retryAfter", value: error });
  if (typeof direct === "number" && Number.isFinite(direct)) {
    return Math.round(direct * 1000);
  }
  const headers = readProp({ key: "headers", value: readProp({ key: "response", value: error }) });
  const header = readProp({ key: "retry-after", value: headers });
  let seconds: number;
  if (typeof header === "string") {
    seconds = Number(header);
  } else if (typeof header === "number") {
    seconds = header;
  } else {
    seconds = NaN;
  }
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
}

/** The best human message for an error (`.message` when present, else a stringified fallback). */
function messageOf({ error }: { error: unknown }): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  const message = readProp({ key: "message", value: error });
  if (typeof message === "string" && message.length > 0) {
    return message;
  }
  return typeof error === "string" && error.length > 0 ? error : "unknown error";
}

/** Refine the boundary's default kind using any HTTP/code/message signal the error carried. */
function resolveKind({
  status,
  code,
  message,
  defaultKind,
  provider,
}: {
  status: number | undefined;
  code: string | undefined;
  message: string;
  defaultKind: IngestErrorKind;
  provider: string | undefined;
}): IngestErrorKind {
  if (status === 429 || (code !== undefined && RATE_LIMIT_CODES.has(code))) {
    return "rate-limit";
  }
  // A transport code outranks a status, and the ordering is the whole point: an SDK that turns "the socket
  // died" into a SYNTHETIC 500 would otherwise have its invention believed over the wire's own answer.
  if (isTransportCode({ code, provider })) {
    return "network";
  }
  if (status !== undefined) {
    return "http";
  }
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed/i.test(message)) {
    return "network";
  }
  return defaultKind;
}

/**
 * Map ANY thrown value into a typed {@link IngestError}, preserving status/code/retry-after and the
 * original `cause` (identity kept). The boundary supplies `defaultKind` (what the failure IS absent an
 * HTTP/network signal — `io` for a filesystem call, `llm` for a model call, `http` for an API call), and
 * this refines it to `rate-limit`/`http`/`network` when the error carries the signal.
 *
 * @param error the thrown value (any shape)
 * @param operation the boundary operation label (e.g. `slack.conversations.history`)
 * @param provider the external system, when applicable
 * @param path the filesystem path, for an `io` boundary
 * @param defaultKind the boundary's kind absent an HTTP/network signal (defaults to `http`)
 * @returns the typed error
 */
export function toIngestError({
  error,
  operation,
  provider,
  path,
  defaultKind = "http",
}: {
  error: unknown;
  operation: string;
  provider?: string;
  path?: string;
  defaultKind?: IngestErrorKind;
}): IngestError {
  const code = codeOf({ error });
  // A transport failure has NO status, whatever the SDK put on the error object. Octokit stamps 500 on every
  // `fetch` rejection, and carrying that forward made the verb print `HTTP 500` for a request GitHub never
  // answered — a false statement about the wire, and one that sent readers hunting a server fault.
  // `retryDecision` tests `kind === "network"` BEFORE `hasTransientStatus`, so dropping it costs no retry.
  const status = isTransportCode({ code, provider }) ? undefined : statusOf({ error });
  const retryAfterMs = retryAfterMsOf({ error });
  const message = messageOf({ error });
  const kind = resolveKind({ code, defaultKind, message, provider, status });
  // Enforce invariants (kind/operation/message/cause) LAST so the extracted optionals can never clobber
  // them — the archive's spread-then-enforce ordering, re-skinned.
  return {
    ...(provider !== undefined ? { provider } : {}),
    ...(path !== undefined ? { path } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(code !== undefined ? { code } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    cause: error,
    kind,
    message,
    operation,
  };
}

/**
 * The HTTP status of a typed error (or undefined). A named accessor so call-sites don't reach into fields.
 *
 * @param error the typed error
 * @returns the status, or undefined for an error that never had one — a rate-limit error from some SDKs
 *   carries no status at all, which is why this must not be assumed present
 */
export function errorStatus({ error }: { error: IngestError }): number | undefined {
  return error.status;
}

/**
 * The string code of a typed error (or undefined).
 *
 * @param error the typed error
 * @returns the provider's code, or undefined when it carried none
 */
export function errorCode({ error }: { error: IngestError }): string | undefined {
  return error.code;
}

/**
 * Whether a typed error's HTTP status is one a retry can clear (429 + transient 5xx).
 *
 * @param error the typed error
 * @returns true only for a status a retry could plausibly clear; anything else is permanent and retrying it
 *   just burns the budget
 */
export function hasTransientStatus({ error }: { error: IngestError }): boolean {
  return error.status !== undefined && TRANSIENT_STATUS.has(error.status);
}

/**
 * Whether the request died at the TRANSPORT — no HTTP response of any kind came back.
 *
 * The distinction a caller of an irreversible write needs, and the one an SDK's synthetic status destroys. A
 * provider that ANSWERED, even with a 500, has already decided what to do with the request; a socket that
 * closed has told us nothing, so whether the write landed is a question only a separate read can settle.
 *
 * @param error the typed error
 * @returns true when the failure is a network/transport one rather than anything the provider replied
 */
export function hadNoProviderResponse({ error }: { error: IngestError }): boolean {
  return error.kind === "network";
}

/**
 * Format a typed error into a single human line:
 * `<provider/kind> <operation>[ HTTP <status>][ <code>]: <message>`.
 * Deterministic — used to render a typed boundary failure back into the connectors' warning/error strings.
 *
 * The CODE earns its place because a transport failure's message alone is unactionable: `other side closed`
 * names no operation, no layer and no next step, and `UND_ERR_SOCKET` beside it is what tells a reader the
 * request never reached the provider at all. Measured — six `slopweaver github enqueue`
 * attempts on a pull request whose entire output was that one phrase.
 *
 * @param error the typed error
 * @returns the formatted line
 */
export function formatIngestError({ error }: { error: IngestError }): string {
  const label = boundaryLabel({ error });
  const status = error.status !== undefined ? ` HTTP ${String(error.status)}` : "";
  const code = error.code !== undefined ? ` ${error.code}` : "";
  return `${label} ${error.operation}${status}${code}: ${error.message}`;
}

/**
 * The label a formatted failure opens with — the `<provider/kind>` of {@link formatIngestError}'s shape.
 *
 * A pure filesystem or parse failure crossed no external system, so it carries no `provider`, and the line is
 * labelled by the boundary kind it failed at (`io`, `parse`) instead.
 */
function boundaryLabel({ error }: { error: IngestError }): string {
  const { provider } = error;
  if (provider === undefined) {
    return error.kind;
  }
  return provider;
}

/**
 * Render a typed error back into a throwable `Error` — the adapter a THROWING seam uses to re-surface a
 * `safe*` failure so the orchestration's existing catch-to-warning policy still runs unchanged. The
 * original `cause` is returned verbatim when it's already an `Error` (so a caller's message assertions,
 * e.g. `not_in_channel`, are byte-identical); otherwise a formatted `Error` carrying the cause.
 *
 * @param error the typed error
 * @returns an `Error` safe to throw (satisfies `only-throw-error`)
 */
export function ingestErrorToThrowable({ error }: { error: IngestError }): Error {
  if (error.cause instanceof Error) {
    return error.cause;
  }
  // A non-Error cause (e.g. a plain `{ status: 429 }` throw): synthesise an Error that CARRIES the typed
  // status/code, so a downstream retry classifier (which re-maps the throwable) still sees a retryable
  // signal instead of a bare generic error.
  const thrown = new Error(formatIngestError({ error }), { cause: error.cause });
  if (error.status !== undefined) {
    Object.assign(thrown, { status: error.status });
  }
  if (error.code !== undefined) {
    Object.assign(thrown, { code: error.code });
  }
  return thrown;
}
