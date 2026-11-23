/**
 * The one place a first-party request is actually made, and the only thing that holds the session.
 *
 * ## A caller names a CALL ID and gets rows back
 *
 * The URL is built here from `inventory.ts`'s table, so no argument anywhere reaches an endpoint the table
 * does not list. The session lives in this module's closure: a caller cannot read the cookie or the
 * antiforgery token off the returned client, which is what makes "this atlas holds no credential" a
 * property rather than a promise.
 *
 * ## Paging is driven, and a page that stops answering is a refusal rather than a short list
 *
 * MEASURED: the application inventory spans more than one page and answers `{items, total}` with a
 * server-side truncation flag of its own. A loop that stopped early and reported success would publish a
 * partial inventory as a complete one, so the loop compares what it has against the `total` the provider
 * itself stated and a shortfall is carried out as a fact rather than smoothed over.
 *
 * ## Everything below is a READ
 *
 * `inventory.ts` admits GET rows and list-shaped POST rows, each carrying its own `whyRead`. There is no
 * code path here that sends any other method, and no caller-supplied body: a row's body is the row's.
 */
import { err, ok, type Result } from "#lib/result.js";

import { trelicaBoundaryRefusal, trelicaViewList } from "./admission.js";
import type { TrelicaAiWindow } from "./aiUsage.js";
import { type TrelicaAtlasError, TrelicaAtlasErrors } from "./errors.js";
import type { TrelicaFirstPartyRead } from "./firstPartyBoundaries.js";
import { type TrelicaCall } from "./inventory.js";
import type { TrelicaAiUsageDimension } from "./model.js";
import { TRELICA_XSRF_HEADER, type TrelicaSession } from "./session.js";
import type { TrelicaBoundary } from "./trelicaBoundary.js";
import { type TrelicaAiUsageResult, walkTrelicaUsageTable } from "./usageWalk.js";

/**
 * How many records one page asks for.
 *
 * Two hundred rather than the client's own twenty: twenty would be ten times the round trips for one kind
 * over the inventory's live record count. Reproduce the size with
 * `slopweaver atlas trelica read --kind app --json | jq '.kinds[0].entities | length'`.
 *
 * @internal
 */
export const TRELICA_PAGE_SIZE = 200;

/**
 * The most pages one call may walk before it stops asking.
 *
 * A bound rather than a trust: a provider that answered a non-decreasing cursor would otherwise loop
 * forever. At {@link TRELICA_PAGE_SIZE} this admits a hundred thousand records, comfortably above the
 * measured inventory, and a run that hits it says so rather than reporting a complete surface.
 *
 * @internal
 */
export const TRELICA_MAX_PAGES = 500;

/** What one admitted call returned. */
export interface TrelicaCallResult {
  readonly callId: string;
  /** The verb the row declares, carried so a projection names the operation the way it was made. */
  readonly httpMethod: string;
  /**
   * Every record the call returned, across every page walked, as its boundary's census view: each key the boundary
   * reads as answered, each declared-unread key `null`.
   */
  readonly items: readonly unknown[];
  /** The count the provider itself stated, or `null` for an unpaged row. */
  readonly total: number | null;
  /** The last HTTP status the call answered with. */
  readonly statusCode: number;
  /** The path the call was made against — no query string, so no cursor noise in a stored row. */
  readonly path: string;
}

/** The HTTP surface this client needs. Injected so every test runs without a network. */
export type TrelicaHttp = (input: {
  url: string;
  method: string;
  headers: Readonly<Record<string, string>>;
  body: string | undefined;
}) => Promise<Result<{ statusCode: number; text: string }, TrelicaAtlasError>>;

/** The page shape every `FilterItems`/`GetMany` boundary admits. */
export type TrelicaPage<T> = {
  readonly items: readonly T[];
  readonly total: number;
  readonly resultsTruncated: boolean;
};

/** The client a caller drives. Holds the session; exposes only the calls the inventory admits. */
export interface TrelicaClient {
  /**
   * Make one admitted call, walking every page it declares and admitting each through the call's strict boundary.
   * A boundary bound to another call is refused before anything is requested.
   *
   * @param call the inventory row to call
   * @param boundary the strict boundary bound to that row, which every page is admitted by
   * @returns everything it returned, or why it did not answer — a page that drifted refuses the whole call
   */
  call(input: TrelicaFirstPartyRead): Promise<Result<TrelicaCallResult, TrelicaAtlasError>>;
  /**
   * Make one cost-explorer read over a window, walking its table to the end — or, with `stopBelowSpend`,
   * until a page reaches a row spending less than that. The dimension alone picks both the endpoint and the boundary
   * that admits its pages, so no caller can pair one dimension's path with another's boundary.
   *
   * @param dimension the `aiUsage.ts` row to read, by the dimension that keys it
   * @param window the run's window
   * @param stopBelowSpend stop paging once a row falls below this spend; `null` walks the whole table
   * @returns the table rows, the series and the granularity, or why the read did not answer
   */
  usage(input: {
    dimension: TrelicaAiUsageDimension;
    window: TrelicaAiWindow;
    stopBelowSpend: number | null;
  }): Promise<Result<TrelicaAiUsageResult, TrelicaAtlasError>>;
  /**
   * Make one admitted list call, admitting every page through the row's strict boundary BEFORE its `items` or
   * `total` is read, so the walk pages on what the boundary admitted and never on a guess at the raw body.
   * Paging follows the same `{items, total}` walk {@link TrelicaClient.call} does.
   *
   * @param call the `entityInventory.ts` row to call
   * @param boundary the row's strict page boundary
   * @returns every admitted page, or why the call did not answer or which page drifted
   */
  list<T>(input: {
    call: TrelicaCall;
    boundary: TrelicaBoundary<TrelicaPage<T>>;
  }): Promise<Result<TrelicaPagesResult<TrelicaPage<T>>, TrelicaAtlasError>>;
  /**
   * Make one admitted unpaged call that answers a single document, and admit it through the row's strict boundary.
   *
   * @param call the `entityInventory.ts` row to call
   * @param boundary the row's strict boundary
   * @returns the admitted document as the call's one page, or why the call did not answer or what drifted
   */
  one<T>(input: {
    call: TrelicaCall;
    boundary: TrelicaBoundary<T>;
  }): Promise<Result<TrelicaPagesResult<T>, TrelicaAtlasError>>;
}

/** What one {@link TrelicaClient.list} or {@link TrelicaClient.one} call returned. */
export interface TrelicaPagesResult<T> {
  readonly callId: string;
  readonly httpMethod: string;
  readonly path: string;
  readonly statusCode: number;
  /** Every page as its boundary admitted it, in the order it was fetched. */
  readonly pages: readonly T[];
}

/**
 * Build the client.
 *
 * @param session the assembled session, held in this closure and never handed back
 * @param tenantOrigin this installation's tenant origin
 * @param http the HTTP surface to make requests through
 * @returns a client that can make exactly the calls `inventory.ts` admits
 */
export function createTrelicaClient({
  session,
  tenantOrigin,
  http,
}: {
  session: TrelicaSession;
  tenantOrigin: string;
  http: TrelicaHttp;
}): TrelicaClient {
  const headers: Readonly<Record<string, string>> = {
    accept: "application/json",
    "content-type": "application/json",
    cookie: session.cookie,
    [TRELICA_XSRF_HEADER]: session.antiforgery,
  };
  return {
    call: async ({ call, boundary }) => walkFirstPartyCall({ boundary, call, headers, http, tenantOrigin }),
    list: async ({ call, boundary }) => walkPages({ boundary, call, headers, http, tenantOrigin }),
    one: async ({ call, boundary }) => {
      const answered = await fetchAdmitted({ boundary, call, headers, http, skip: 0, tenantOrigin });
      if (answered.isErr()) {
        return err(answered.error);
      }
      const { page, statusCode } = answered.value;
      return ok({ callId: call.id, httpMethod: call.httpMethod, pages: [page], path: call.path, statusCode });
    },
    usage: async ({ dimension, window, stopBelowSpend }) =>
      walkTrelicaUsageTable({
        dimension,
        headers,
        http,
        maxPages: TRELICA_MAX_PAGES,
        stopBelowSpend,
        tenantOrigin,
        window,
      }),
  };
}

/** Walk one first-party call to the end of its pages, holding each page's items through its boundary's census view. */
async function walkFirstPartyCall({
  boundary,
  call,
  headers,
  http,
  tenantOrigin,
}: TrelicaFirstPartyRead & {
  headers: Readonly<Record<string, string>>;
  http: TrelicaHttp;
  tenantOrigin: string;
}): Promise<Result<TrelicaCallResult, TrelicaAtlasError>> {
  const collected: unknown[] = [];
  let total: number | null = null;
  let statusCode = 0;
  for (let index = 0; index < TRELICA_MAX_PAGES; index += 1) {
    const answered = await fetchAdmitted({ boundary, call, headers, http, skip: collected.length, tenantOrigin });
    if (answered.isErr()) {
      return err(answered.error);
    }
    const { page } = answered.value;
    collected.push(...trelicaViewList({ key: "items", view: boundary.censusView({ value: page }) }));
    ({ total } = page);
    ({ statusCode } = answered.value);
    const exhausted = !call.paged || page.items.length === 0 || collected.length >= total;
    if (exhausted) {
      break;
    }
  }
  return ok({ callId: call.id, httpMethod: call.httpMethod, items: collected, path: call.path, statusCode, total });
}

/** Walk one list call's admitted pages, under the same bound and stop rule as `call`. */
async function walkPages<T>({
  boundary,
  call,
  headers,
  http,
  tenantOrigin,
}: {
  boundary: TrelicaBoundary<TrelicaPage<T>>;
  call: TrelicaCall;
  headers: Readonly<Record<string, string>>;
  http: TrelicaHttp;
  tenantOrigin: string;
}): Promise<Result<TrelicaPagesResult<TrelicaPage<T>>, TrelicaAtlasError>> {
  const pages: TrelicaPage<T>[] = [];
  let held = 0;
  let statusCode = 0;
  for (let index = 0; index < TRELICA_MAX_PAGES; index += 1) {
    const answered = await fetchAdmitted({ boundary, call, headers, http, skip: held, tenantOrigin });
    if (answered.isErr()) {
      return err(answered.error);
    }
    const { page } = answered.value;
    pages.push(page);
    held += page.items.length;
    ({ statusCode } = answered.value);
    if (!call.paged || page.items.length === 0 || held >= page.total) {
      break;
    }
  }
  return ok({ callId: call.id, httpMethod: call.httpMethod, pages, path: call.path, statusCode });
}

/** Fetch one page of one admitted call as text, turning every non-success status into a typed refusal. */
async function fetchText({
  call,
  skip,
  headers,
  http,
  tenantOrigin,
}: {
  call: TrelicaCall;
  skip: number;
  headers: Readonly<Record<string, string>>;
  http: TrelicaHttp;
  tenantOrigin: string;
}): Promise<Result<{ statusCode: number; text: string }, TrelicaAtlasError>> {
  const params = new URLSearchParams(
    call.paged ? { skip: String(skip), take: String(TRELICA_PAGE_SIZE), ...call.query } : { ...call.query },
  ).toString();
  const query = params.length > 0 ? `?${params}` : "";
  const response = await http({
    body: call.httpMethod === "POST" ? JSON.stringify(call.body) : undefined,
    headers,
    method: call.httpMethod,
    url: `${tenantOrigin}${call.path}${query}`,
  });
  if (response.isErr()) {
    return err(response.error);
  }
  if (response.value.statusCode < 200 || response.value.statusCode >= 300) {
    return err(TrelicaAtlasErrors.callRefused({ callId: call.id, statusCode: response.value.statusCode }));
  }
  return ok(response.value);
}

/**
 * Fetch one page of one admitted call and admit its text through the row's boundary before anything reads it. A
 * boundary bound to another call is refused before any request is made, so no page is admitted by the wrong one.
 */
async function fetchAdmitted<T>({
  boundary,
  ...request
}: {
  boundary: TrelicaBoundary<T>;
  call: TrelicaCall;
  skip: number;
  headers: Readonly<Record<string, string>>;
  http: TrelicaHttp;
  tenantOrigin: string;
}): Promise<Result<{ page: T; statusCode: number }, TrelicaAtlasError>> {
  if (boundary.callId !== request.call.id) {
    return err(TrelicaAtlasErrors.boundaryUnbound({ boundaryCallId: boundary.callId, callId: request.call.id }));
  }
  const answered = await fetchText(request);
  if (answered.isErr()) {
    return err(answered.error);
  }
  const admitted = boundary.parseJson({ text: answered.value.text });
  if (admitted.isErr()) {
    return err(trelicaBoundaryRefusal({ callId: request.call.id, error: admitted.error }));
  }
  return ok({ page: admitted.value, statusCode: answered.value.statusCode });
}
