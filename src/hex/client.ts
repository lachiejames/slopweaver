/**
 * The Hex READ client — authenticated, rate-limit-aware, GET-only transport over the documented `/api/v1`
 * surface, with every typed response crossing its endpoint's strict boundary (`schemas.ts`), and `hex raw`'s
 * read handed back as text that nothing here parses.
 *
 * ## Why there is transport here at all (`docs/provider-sdks.md`)
 *
 * Hex publishes no official TypeScript SDK. Checked on the npm registry: `hex-api`,
 * `@hex-tech/api`, `@hex/api`, `@hex.tech/sdk` and `hex-toolkit` do not exist, and `hex-sdk` is an unrelated
 * 2018 package by an individual. What Hex does publish is one OpenAPI document — the same one the atlas pins
 * by digest — so this module is typed transport over THAT surface and nothing else: the origin comes from
 * the pin (`config.ts`), the paths are the document's own, and the response shapes in `schemas.ts` are read
 * off it. An endpoint the document does not declare is not reachable from here.
 *
 * ## Read-only is a property of the TYPE, not a convention
 *
 * {@link HexMethod} admits `GET` and nothing else. There is no allow-listed POST as `datadog/rawTransport.ts`
 * has, and the omission is deliberate rather than pending: the two POSTs an investigation might want —
 * starting a project run and opening an agent thread — are a compute run whose rows the API does not hand
 * back, and a spend of AI credits, respectively. The owner wants a
 * first-class integration for READING Hex. Adding a method here is a one-line change that a reviewer sees.
 *
 * ## The rate limit is bounded, not looped
 *
 * The document states the groups: `hex-api` at 30 requests a minute (1,800 an hour) and `hex-api-30rpm`.
 * A 429 is retried ONCE after `Retry-After` (capped at {@link MAX_RETRY_AFTER_SECONDS}), then reported as
 * {@link HexReadErrors.rateLimited} with the number Hex asked for. One retry rather than a loop, because a
 * verb an agent runs in a ladder must return, and a second 429 inside a minute is information the agent
 * should act on rather than have hidden by a sleep.
 *
 * ## What never happens here
 *
 * Nothing is written under `$SLOPWEAVER_HOME`, no store is opened, and no row reaches a file — the owner's
 * line is that Hex is never ingested. A caller that wants to KEEP something it read is the atlas's entity
 * fill (`src/atlas/hex/entitySync.ts`), which stores what exists and never a cell's output.
 */
import type { Boundary } from "../lib/boundary.js";
import { errorMessage } from "../lib/errorMessage.js";
import { err, ok, type Result } from "../lib/result.js";
import type { HexConfig } from "./config.js";
import { type HexReadError, HexReadErrors } from "./errors.js";

/**
 * The only method this client can issue. The omission is the feature — see the file header.
 *
 * @internal
 */
export type HexMethod = "GET";

/**
 * The path prefix every documented operation lives under. A path outside it is refused before any call.
 *
 * @internal
 */
export const HEX_API_PATH_PREFIX = "/v1/";

/**
 * The longest `Retry-After` this client will honour before reporting the limit instead.
 *
 * @internal
 */
export const MAX_RETRY_AFTER_SECONDS = 60;

/**
 * How long to wait on a 429 that carries no `Retry-After`, in seconds.
 *
 * @internal
 */
export const DEFAULT_RETRY_AFTER_SECONDS = 2;

/** The seam that performs the HTTP call. Injected so every branch below is reachable without a network. */
// named-object-params-exempt: must match the real global fetch's positional shape to be substitutable for it
export type HexFetchLike = (
  url: string,
  init: { method: HexMethod; headers: Record<string, string> },
) => Promise<{ status: number; headers: Readonly<Record<string, string>>; text: () => Promise<string> }>;

/** The seam that waits. Injected for the same reason — a test must not sleep. */
export type HexSleepLike = ({ seconds }: { seconds: number }) => Promise<void>;

/** One raw response, before any status classification or schema parse. */
interface HexRawResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly raw: string;
}

/** One query parameter set, rendered in insertion order; `undefined` values are omitted. */
export type HexQuery = Readonly<Record<string, string | number | boolean | undefined>>;

/**
 * One accepted 2xx answer, its body exactly as Hex sent it.
 *
 * @internal
 */
export interface HexTextResponse {
  readonly bodyText: string;
  readonly status: number;
}

/** A read path bound to one configuration, so no caller assembles a host or a credential header itself. */
export interface HexClient {
  /**
   * Issue one GET and validate its body against the endpoint's strict boundary.
   *
   * @param path the documented path under `/v1/`, `{brace}` parameters already substituted
   * @param query the query parameters, or omitted for none
   * @param boundary the endpoint's boundary from `schemas.ts`, which refuses a new, missing or renamed field by name
   * @returns the validated body, or the typed reason it cannot be believed
   */
  get: <T>(input: { path: string; query?: HexQuery; boundary: Boundary<T> }) => Promise<Result<T, HexReadError>>;
  /**
   * Issue one GET and hand back the 2xx body as text, unparsed — `hex raw`'s read, which declares no shape.
   *
   * @param path the documented path under `/v1/`
   * @param query the query parameters, or omitted for none
   * @returns the status and body text, or the typed failure
   */
  getText: (input: { path: string; query?: HexQuery }) => Promise<Result<HexTextResponse, HexReadError>>;
}

/**
 * Render a query record onto a path.
 *
 * @param path the bare path
 * @param query the parameters, `undefined` values dropped
 * @returns the path with its query string, or the path alone when nothing survives
 */
export function withQuery({ path, query }: { path: string; query: HexQuery | undefined }): string {
  if (query === undefined) {
    return path;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const rendered = params.toString();
  return rendered.length === 0 ? path : `${path}?${rendered}`;
}

/**
 * Parse `Retry-After` as the seconds form only — Hex's API sends seconds, and an HTTP-date here would be
 * a different provider's habit this client should not guess at.
 *
 * @param headers the response headers, keys already lower-cased by the fetch seam or not — both are read
 * @returns the seconds, or `null` when absent or not a non-negative integer
 */
export function retryAfterSeconds({ headers }: { headers: Readonly<Record<string, string>> }): number | null {
  const lowered = headers["retry-after"];
  if (lowered !== undefined) {
    return parseSeconds({ raw: lowered });
  }
  const capitalised = headers["Retry-After"];
  if (capitalised === undefined) {
    return null;
  }
  return parseSeconds({ raw: capitalised });
}

/**
 * One `Retry-After` value as a wait in seconds.
 *
 * @param raw the header value
 * @returns the seconds, or `null` when it is not a non-negative integer
 */
function parseSeconds({ raw }: { raw: string }): number | null {
  const seconds = Number(raw.trim());
  if (!Number.isInteger(seconds) || seconds < 0) {
    return null;
  }
  return seconds;
}

/**
 * Validate a 2xx body against the endpoint's boundary, reporting a miss as a fault rather than an absence.
 *
 * @param path the route, so a refusal names it
 * @param raw the response text
 * @param boundary the endpoint's strict boundary
 * @returns the validated body, or the malformed-response failure carrying the boundary's own refusal
 */
export function parseHexBody<T>({
  path,
  raw,
  boundary,
}: {
  path: string;
  raw: string;
  boundary: Boundary<T>;
}): Result<T, HexReadError> {
  // A const annotated `Boundary` is what lets the `boundary-schema` gate see this parse is the boundary's own.
  const strict: Boundary<T> = boundary;
  return strict
    .parseJson({ text: raw })
    .mapErr((boundaryError): HexReadError => HexReadErrors.malformedResponse({ boundaryError, path }));
}

/**
 * Classify a non-2xx, non-429 status into the union — the three the reader branches on by name, and one
 * for everything else that keeps its status.
 *
 * @param status the HTTP status
 * @param path the route
 * @param raw the response text, bounded into the message
 * @returns the typed failure
 */
export function classifyHexStatus({ status, path, raw }: { status: number; path: string; raw: string }): HexReadError {
  const detail = raw.trim().slice(0, 300);
  if (status === 401) {
    return HexReadErrors.unauthorized({ detail, path });
  }
  if (status === 403) {
    return HexReadErrors.forbidden({ detail, path });
  }
  if (status === 404) {
    return HexReadErrors.notFound({ detail, path });
  }
  return HexReadErrors.requestFailed({ detail, path, status });
}

/**
 * One request, plus the ONE retry a 429 earns. See the file header on why it is one rather than a loop.
 *
 * A free function taking the caller's own single-request seam rather than a closure inside the client, so
 * the retry policy is one readable thing rather than a paragraph in the middle of a constructor.
 *
 * @param once how to issue one request — bound to the configuration by {@link createHexClient}
 * @param sleep the wait seam
 * @param path the full path, query string included
 * @returns the response to classify, or the typed failure
 */
async function withRetry({
  once,
  sleep,
  path,
}: {
  once: ({ path }: { path: string }) => Promise<Result<HexRawResponse, HexReadError>>;
  sleep: HexSleepLike;
  path: string;
}): Promise<Result<HexRawResponse, HexReadError>> {
  const first = await once({ path });
  if (first.isErr() || first.value.status !== 429) {
    return first;
  }
  const asked = retryAfterSeconds({ headers: first.value.headers });
  await sleep({ seconds: asked === null ? DEFAULT_RETRY_AFTER_SECONDS : Math.min(asked, MAX_RETRY_AFTER_SECONDS) });
  const second = await once({ path });
  if (second.isErr()) {
    return second;
  }
  if (second.value.status === 429) {
    return err(
      HexReadErrors.rateLimited({ path, retryAfterSeconds: retryAfterSeconds({ headers: second.value.headers }) }),
    );
  }
  return second;
}

/** A 2xx answer's body as text, or the typed failure its status names. */
function acceptedText({
  path,
  response,
}: {
  path: string;
  response: HexRawResponse;
}): Result<HexTextResponse, HexReadError> {
  if (response.status < 200 || response.status >= 300) {
    return err(classifyHexStatus({ path, raw: response.raw, status: response.status }));
  }
  return ok({ bodyText: response.raw, status: response.status });
}

/**
 * Build the client.
 *
 * @param config the resolved configuration
 * @param fetch the HTTP seam; production passes the global `fetch`, a test a fake
 * @param sleep the wait seam; production passes a timer, a test a no-op that records the request
 * @returns the bound client
 */
export function createHexClient({
  config,
  fetch,
  sleep,
}: {
  config: HexConfig;
  fetch: HexFetchLike;
  sleep: HexSleepLike;
}): HexClient {
  const headers = { Accept: "application/json", Authorization: `Bearer ${config.token}` };

  /** One request, with a transport throw turned into the typed failure rather than propagating. */
  async function once({ path }: { path: string }): Promise<Result<HexRawResponse, HexReadError>> {
    try {
      const response = await fetch(`${config.apiOrigin}${path}`, { headers, method: "GET" });
      const raw = await response.text();
      return ok({ headers: response.headers, raw, status: response.status });
    } catch (error: unknown) {
      return err(HexReadErrors.requestFailed({ detail: errorMessage({ error }), path, status: null }));
    }
  }

  async function getText({
    path,
    query,
  }: {
    path: string;
    query?: HexQuery;
  }): Promise<Result<HexTextResponse, HexReadError>> {
    if (!path.startsWith(HEX_API_PATH_PREFIX)) {
      return err(
        HexReadErrors.requestFailed({
          detail: `refused before any call — every documented Hex operation lives under ${HEX_API_PATH_PREFIX}`,
          path,
          status: null,
        }),
      );
    }
    const full = withQuery({ path, query });
    const answered = await withRetry({ once, path: full, sleep });
    return answered.andThen((response) => acceptedText({ path: full, response }));
  }

  async function get<T>(input: {
    path: string;
    query?: HexQuery;
    boundary: Boundary<T>;
  }): Promise<Result<T, HexReadError>> {
    const answered = await getText(input);
    const path = withQuery({ path: input.path, query: input.query });
    return answered.andThen(({ bodyText }) => parseHexBody({ boundary: input.boundary, path, raw: bodyText }));
  }

  return { get, getText };
}
