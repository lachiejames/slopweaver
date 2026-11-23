/**
 * Execute one admitted JumpCloud operation, and turn every provider outcome into a typed fact.
 *
 * ## The client cannot be asked for an arbitrary request
 *
 * {@link requestJumpcloud} takes a SURFACE NAME, not a method and a path. The origin, method and path all
 * come from the generated registry, so there is no argument a caller could pass that reaches an endpoint
 * the registry does not admit — and an `excluded` row has no callable variant at all. That is the property
 * the read-only claim rests on in code, which is why this module exports no generic `get`/`post`.
 *
 * A path parameter is BOUND, never interpolated by the caller: a caller supplies `{ system_id: "…" }` and
 * the value is percent-encoded into the registry's own path. Handing the client a finished path would have
 * made the registry advisory.
 *
 * ## Redirects are refused rather than followed
 *
 * The allowlist checked the request that was SENT. A redirect is a request to somewhere else, which nothing
 * has checked — so `redirect: "manual"` and a 3xx is a typed failure. This also makes an admin-login wall
 * visible as a refusal rather than as a page of HTML that happened to parse.
 *
 * ## Pacing and retry are the shared door's, not this module's
 *
 * Every call goes through `safeProviderCall`, so a 429 records on the shared block that every other caller
 * waits on, and a transient 5xx is retried with backoff. That matters here more than on a small atlas: a
 * full sync makes one request per root call and per fan-out over every parent id, and JumpCloud documents that it blocks
 * what it takes for abuse rather than publishing a numeric allowance. The two operation labels are static
 * literals because `operation-labels` cannot check a template against the registry map.
 *
 * ## The production transport re-checks the registry, because exporting it is exporting a network primitive
 *
 * {@link requestJumpcloud} looks the row up and builds the URL, so no caller of IT can reach an unlisted
 * endpoint. That was not enough: the transport {@link productionJumpcloudFetch} returns takes a `url` and a
 * `method`, and exporting it handed any module in this repository a way to send an arbitrary request to
 * JumpCloud with the same credential. The registry was the boundary and the primitive walked around it.
 *
 * So the transport checks the request it is HANDED — `https://console.jumpcloud.com/not-in-the-registry`
 * is refused by the transport itself, not merely never constructed. {@link admittedRegistryRow} is what
 * decides, matching a URL back to a row by origin, method and path shape, and the URL that goes to the
 * network is then rebuilt from the matched row's own origin.
 *
 * **What that does and does not close, stated rather than implied.** The ORIGIN, the METHOD and the path
 * SHAPE are the registry's. The value bound into a `{brace}` parameter is the caller's, and must be — a
 * fan-out over every device id is the whole point of a parameterised row, so an id is data rather than a
 * decision. What the check prevents is a path the registry describes no operation for.
 *
 * ## What never leaves this module
 *
 * A response BODY is returned to the caller as the provider's own text and is never logged; a failure names
 * the surface and the status and never the body, because a body is exactly where a provider echoes a
 * credential back. This module never parses one: the paging read admits each page through its surface's
 * strict boundary (`responseRegistry.ts`'s `admitJumpcloudPage`), which refuses a body that is not JSON by its
 * byte length alone.
 */
import { safeProviderCall } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";

import { type JumpcloudReadError, JumpcloudReadErrors } from "./errors.js";
import { JUMPCLOUD_FILE_RESPONSES } from "./fileResponses.js";
import { JUMPCLOUD_ORIGINS } from "./generated/specLock.js";
import { JUMPCLOUD_SURFACES } from "./generated/surfaces.js";
import { admittedRegistryRow } from "./registryMatch.js";
import type { JumpcloudSurfaceRow } from "./surfaceRow.js";

/** A raw provider answer, before any projection. */
export interface JumpcloudResponse {
  readonly status: number;
  /** The body exactly as the provider sent it — admitted by the caller's boundary, never parsed here. */
  readonly text: string;
  /** Response headers, lowercased — Directory Insights carries its paging state here rather than in the body. */
  readonly headers: Readonly<Record<string, string>>;
  /** The path actually called, with parameters bound. The reproduction handle a stored record carries. */
  readonly endpoint: string;
}

/**
 * The HTTP seam, injected so every test runs without a network.
 *
 * Returns the raw text rather than a parsed body: what a provider sent and what `JSON.parse` makes of it
 * are different things, and the failure where they differ is one this module has to be able to report.
 */
export type JumpcloudFetch = (args: {
  url: string;
  method: "GET" | "POST";
  headers: Readonly<Record<string, string>>;
  body: string | null;
}) => Promise<{ status: number; text: string; headers: Readonly<Record<string, string>> }>;

/** Everything {@link requestJumpcloud} needs to reach the provider. */
export interface JumpcloudClientDeps {
  readonly apiKey: string;
  /** Sent as `x-org-id` when present; the header is omitted entirely when `null` — see `credentials.ts`. */
  readonly orgId: string | null;
  readonly fetch: JumpcloudFetch;
}

/**

 * What one invocation supplies beyond its registry row.
 * @internal
 */
export interface JumpcloudRequestInput {
  /** One value per `{brace}` parameter the row's path declares. */
  readonly bindings?: Readonly<Record<string, string>>;
  /**
   * Query parameters, appended in insertion order.
   *
   * A value may be an ARRAY, sent as the parameter REPEATED, because JumpCloud rejects the comma-joined
   * spelling by name: `GET /api/v2/systems/{id}/associations?targets=command,policy` answers
   * `Parameter (targets) is value at index 0 not an allowable value (…)`. The graph endpoints in particular
   * take exactly ONE `targets` value per request, so `requestContracts.ts`'s `jumpcloudQueryVariants` splits
   * those into one call each before they reach here. A string value stays one parameter.
   */
  readonly query?: Readonly<Record<string, string | readonly string[]>>;
  /** The body of an admitted POST. */
  readonly body?: Readonly<Record<string, unknown>>;
}

/**
 * HTTP 501. Named because two different decisions turn on it and a bare number in each would drift apart.
 */
const NOT_IMPLEMENTED = 501;

/**
 * The statuses worth another attempt. A 429 also records on the shared block, through the thrown status.
 *
 * 408 and 425 are on the list and the rest of the 4xx range is not, which is the distinction an adversarial
 * review found missing. Everything else in that range is the provider saying the REQUEST is wrong, which no
 * later run clears on its own — but a request timeout and a too-early are the provider saying to ask again,
 * and treating one as settled would let a transient failure publish a short generation.
 *
 * **501 is the one member of the 5xx range that is NOT worth another attempt**, and it is the only status
 * whose classification was ever decided by a measurement rather than by the range it sits in. RFC 9110
 * §15.6.2 makes 501 a property of the SERVER rather than of one moment — it is the response for
 * functionality the origin does not support at all, and it is the only 5xx the spec makes heuristically
 * cacheable. Retrying it can only ever produce it again.
 *
 * MEASURED on the live tenancy, which is what separated it from the 500s beside it. Two separate
 * full syncs each refused to publish on the same three operations —
 * `v2-access-workflow-api-get-all-access-work-flows` and
 * `v2-workflow-access-request-api-get-all-workflow-access-requests` at HTTP 500, and
 * `v2-systems-org-settings-get-ssao-devices-settings` at HTTP 501. Called one at a time through
 * {@link requestJumpcloud} immediately afterwards, both 500s answered **200** while
 * the 501 answered 501 again. So the 500s are exactly what this list says they are, transient under a
 * concurrent walk and cleared by a later run, and the 501 is not: left retryable and therefore blocking, it
 * made a whole generation permanently unpublishable on the strength of one operation this tenancy's
 * JumpCloud does not implement. Reproduce by calling those three surfaces through `requestJumpcloud`.
 */
function isRetryableStatus({ status }: { status: number }): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status !== NOT_IMPLEMENTED);
}

/**
 * Every `{brace}` parameter a registry path declares, in declaration order.
 *
 * @param path the registry row's own path
 * @returns the parameter names, without braces
 */
export function pathParameters({ path }: { path: string }): readonly string[] {
  // `match[1]` is the one capture group in the pattern, so a match always has it.
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!);
}

/**
 * Substitute bound values into a registry path.
 *
 * Values are percent-encoded, so a provider id carrying a slash cannot invent a path segment — which is the
 * one way a bound parameter could otherwise reach an endpoint the registry does not admit.
 *
 * @param path the registry row's own path, `{brace}` parameters intact
 * @param bindings one value per parameter
 * @returns the bound path, or the parameters that had no value
 */
export function bindPath({
  path,
  bindings,
}: {
  path: string;
  bindings: Readonly<Record<string, string>>;
}): Result<string> {
  const unbound = pathParameters({ path }).filter((name) => bindings[name] === undefined);
  if (unbound.length > 0) {
    return err(unbound);
  }
  // Every parameter was just proven bound by the `unbound` check above, so the assertion is honest.
  return ok(path.replaceAll(/\{([^}]+)\}/g, (_match, name: string) => encodeURIComponent(bindings[name]!)));
}

/**
 * The registry row for one surface name, or the refusal a name the registry does not hold earns.
 *
 * The registry is generated, so its names are data rather than a compile-time union; a name arriving as a
 * string is therefore narrowed HERE, against the registry itself, and refused with the same typed error
 * {@link requestJumpcloud} returns — before any lookup result is used.
 *
 * @param surface the name a caller asked for
 * @returns the row, or `SURFACE_REFUSED` when the closed registry does not hold that name at all
 */
export function findJumpcloudSurface({
  surface,
}: {
  surface: string;
}): Result<JumpcloudSurfaceRow, JumpcloudReadError> {
  const row = JUMPCLOUD_SURFACES.find((candidate) => candidate.name === surface);
  if (row === undefined) {
    return err(JumpcloudReadErrors.surfaceRefused({ surface }));
  }
  return ok(row);
}

/**
 * Build the absolute URL for an admitted operation.
 *
 * @param row the admitted registry row
 * @param boundPath the row's path with every parameter substituted
 * @param query the query parameters to append — an array value is appended once per member, never joined
 * @returns the absolute URL
 */
function buildUrl({
  row,
  boundPath,
  query,
}: {
  row: JumpcloudSurfaceRow;
  boundPath: string;
  query: Readonly<Record<string, string | readonly string[]>>;
}): string {
  const url = new URL(`${JUMPCLOUD_ORIGINS[row.origin]}${boundPath}`);
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") {
      url.searchParams.set(key, value);
      continue;
    }
    for (const member of value) {
      url.searchParams.append(key, member);
    }
  }
  return url.toString();
}

/** Turn a status into the typed fact coverage branches on. `null` means the answer is usable. */
function refusalFor({ surface, status }: { surface: string; status: number }): JumpcloudReadError | null {
  if (status >= 200 && status < 300) {
    return null;
  }
  if (status >= 300 && status < 400) {
    return JumpcloudReadErrors.redirectRefused({ status, surface });
  }
  if (status === 401) {
    return JumpcloudReadErrors.credentialRejected({ status, surface });
  }
  if (status === 403) {
    return JumpcloudReadErrors.permissionRefused({ status, surface });
  }
  if (status === 404) {
    return JumpcloudReadErrors.routeAbsent({ surface });
  }
  if (status >= 400 && status < 500) {
    // Every 4xx that reaches here is settled by construction: `isRetryableStatus` has already taken the
    // transient members of the range out, and a retried one that never succeeds arrives as a transport
    // failure instead.
    return JumpcloudReadErrors.operationUnusable({ detail: `HTTP ${String(status)}`, surface });
  }
  if (status === NOT_IMPLEMENTED) {
    // Settled, for the reason {@link isRetryableStatus} measures: the origin does not implement this
    // operation, so a later run cannot clear it and a generation must not be held hostage to one.
    return JumpcloudReadErrors.notImplemented({ surface });
  }
  return JumpcloudReadErrors.unexpectedShape({ detail: `HTTP ${String(status)}`, surface });
}

/**
 * Perform one admitted operation.
 *
 * @param surface the name of a row in the closed registry — never a path
 * @param input the bindings, query and body for this invocation
 * @param deps the credential and the HTTP seam
 * @returns the provider's answer, or a typed failure a coverage grader can branch on
 */
export async function requestJumpcloud({
  surface,
  input,
  deps,
}: {
  surface: string;
  input: JumpcloudRequestInput;
  deps: JumpcloudClientDeps;
}): Promise<Result<JumpcloudResponse, JumpcloudReadError>> {
  const admitted = admitCall({ input, surface });
  if (admitted.isErr()) {
    return err(admitted.error);
  }
  const { row, boundPath, url, payload } = admitted.value;
  const called = await pacedCall({ deps, payload, row, url });
  if (called.isErr()) {
    return err(JumpcloudReadErrors.transportFailed({ cause: called.error, surface }));
  }
  const raw = called.value;
  const refusal = refusalFor({ status: raw.status, surface });
  if (refusal !== null) {
    return err(refusal);
  }
  return ok({ endpoint: boundPath, headers: raw.headers, status: raw.status, text: raw.text });
}

/** One admitted call, resolved from a surface name and this invocation's own inputs. */
interface AdmittedCall {
  readonly row: JumpcloudSurfaceRow;
  readonly boundPath: string;
  readonly url: string;
  readonly payload: string | null;
}

/**
 * Resolve a surface name into a concrete request, or refuse it.
 *
 * Every refusal this function can produce happens BEFORE any network call, which is the property the
 * read-only claim rests on: an unadmitted surface, an inventoried-and-excluded row and an unbound path each
 * end here rather than at the provider.
 *
 * @param surface the name of a row in the closed registry
 * @param input the bindings, query and body for this invocation
 * @returns the resolved call, or why no request will be made
 */
function admitCall({
  surface,
  input,
}: {
  surface: string;
  input: JumpcloudRequestInput;
}): Result<AdmittedCall, JumpcloudReadError> {
  const found = findJumpcloudSurface({ surface });
  if (found.isErr()) {
    return err(found.error);
  }
  const row = found.value;
  if (row.coverage === "excluded") {
    return err(
      JumpcloudReadErrors.surfaceRefused({
        // Typed `string` on an excluded row: `surfaceRow.ts` makes the reason part of what `excluded` means.
        excludedBecause: row.excludedBecause,
        surface,
      }),
    );
  }
  const { bindings = {}, query = {} } = input;
  const bound = bindPath({ bindings, path: row.path });
  if (bound.isErr()) {
    return err(JumpcloudReadErrors.pathUnbound({ parameters: bound.error, surface }));
  }
  return ok({
    boundPath: bound.value,
    payload: postPayload({ input, row }),
    row,
    url: buildUrl({ boundPath: bound.value, query, row }),
  });
}

/**
 * The serialised body one admitted call sends.
 *
 * A GET sends none. A POST sends the caller's body, and a POST the caller passed no body for sends an empty
 * JSON object — `body` is optional on {@link JumpcloudRequestInput}, so its absence is a caller asking with
 * nothing to filter on rather than a value that went missing.
 *
 * @param row the admitted registry row, whose method decides whether there is a body at all
 * @param input this invocation's inputs
 * @returns the JSON text to send, or `null` for a GET
 */
function postPayload({ row, input }: { row: JumpcloudSurfaceRow; input: JumpcloudRequestInput }): string | null {
  if (row.method !== "POST") {
    return null;
  }
  if (input.body === undefined) {
    return JSON.stringify({});
  }
  return JSON.stringify(input.body);
}

/**
 * Send one admitted call through the shared rate door.
 *
 * The two branches differ only in the operation LABEL, and they are written out rather than templated
 * because `operation-labels` cannot check a template literal against the rate registry — so a label that
 * stopped being mapped would become a silent 75-second stall rather than a failing gate.
 *
 * @param row the admitted registry row
 * @param url the absolute URL
 * @param payload the serialised body, or `null` for a GET
 * @param deps the credential and the HTTP seam
 * @returns the raw answer, or the typed boundary error the door produced
 */
async function pacedCall({
  row,
  url,
  payload,
  deps,
}: {
  row: JumpcloudSurfaceRow;
  url: string;
  payload: string | null;
  deps: JumpcloudClientDeps;
}) {
  const headers: Record<string, string> = {
    accept: acceptFor({ surface: row.name }),
    "x-api-key": deps.apiKey,
    ...(deps.orgId === null ? {} : { "x-org-id": deps.orgId }),
    ...(payload === null ? {} : { "content-type": "application/json" }),
  };
  if (row.origin === "insights") {
    return safeProviderCall({
      execute: async () => attempt({ deps, headers, payload, row, url }),
      operation: "jumpcloud.insights.read",
      provider: "jumpcloud",
      retryMode: "transient",
      scopeId: "jumpcloud",
    });
  }
  return safeProviderCall({
    execute: async () => attempt({ deps, headers, payload, row, url }),
    operation: "jumpcloud.directory.read",
    provider: "jumpcloud",
    retryMode: "transient",
    scopeId: "jumpcloud",
  });
}

/**
 * The `Accept` header one operation is asked with — JSON, unless it is a file-answering operation.
 *
 * @param surface the registry row's name
 * @returns the header value
 */
function acceptFor({ surface }: { surface: string }): string {
  const file = JUMPCLOUD_FILE_RESPONSES[surface];
  return file === undefined ? "application/json" : file.accept;
}

/**
 * One HTTP round trip, throwing on a status a retry could clear so the shared door sees it.
 *
 * `safeProviderCall` acts on THROWN failures — it records a 429 on the shared block and consults the retry
 * policy — and a `fetch` resolves happily on both. So a retryable status is raised as an error carrying its
 * own `status`, which `toIngestError` reads, and every other status is returned for grading here.
 *
 * @param row the admitted registry row
 * @param url the absolute URL
 * @param headers the request headers, credential included
 * @param payload the serialised body, or `null` for a GET
 * @param deps the HTTP seam
 * @returns the raw status, text and headers
 */
async function attempt({
  row,
  url,
  headers,
  payload,
  deps,
}: {
  row: JumpcloudSurfaceRow;
  url: string;
  headers: Readonly<Record<string, string>>;
  payload: string | null;
  deps: JumpcloudClientDeps;
}): Promise<{ status: number; text: string; headers: Readonly<Record<string, string>> }> {
  const raw = await deps.fetch({ body: payload, headers, method: row.method, url });
  if (isRetryableStatus({ status: raw.status })) {
    // A plain Error carrying `status` is what `toIngestError` reads to classify a rate limit or a transient
    // 5xx. The surface name is safe to name; the body is not, and is deliberately not carried.
    const error: Error & { status?: number } = new Error(`${row.name} answered HTTP ${String(raw.status)}`);
    error.status = raw.status;
    throw error;
  }
  return raw;
}

/**
 * The production HTTP seam: `fetch`, with redirects refused rather than followed, and with every request
 * checked back against the registry before it is sent.
 *
 * The check is not redundant with {@link requestJumpcloud}'s lookup. That one stops a caller of this
 * MODULE reaching an unlisted endpoint; this one stops a caller of this FUNCTION doing it, which is the
 * counterexample an adversarial review found — the transport was exported, so the registry was a boundary
 * anything could walk around.
 *
 * @returns a fetch seam over the global `fetch` that refuses a request the registry does not admit
 */
export function productionJumpcloudFetch(): JumpcloudFetch {
  return async ({ url, method, headers, body }) => {
    const admitted = admittedRegistryRow({ method, url });
    if (admitted === null) {
      throw new Error(
        `refusing to send ${method} to a JumpCloud URL the closed surface registry does not admit — this transport checks the request it is handed, not only the one this module builds`,
      );
    }
    // Reassembled from the ROW's origin rather than sent as the caller wrote it. A path segment standing in
    // for a `{brace}` parameter is data and stays the caller's, because an id is what a fan-out is for; the
    // host it is sent to is not, and rebuilding is what makes that a property rather than a hope.
    const parsed = new URL(url);
    const sent = `${JUMPCLOUD_ORIGINS[admitted.origin]}${parsed.pathname}${parsed.search}`;
    const response = await fetch(sent, {
      ...(body === null ? {} : { body }),
      headers: { ...headers },
      method,
      redirect: "manual",
    });
    const collected: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      collected[key.toLowerCase()] = value;
    });
    return { headers: collected, status: response.status, text: await response.text() };
  };
}
