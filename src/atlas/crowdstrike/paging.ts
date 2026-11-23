/**
 * Falcon's three paging shapes, and the evidence each one leaves behind about whether it FINISHED.
 *
 * Every function here returns not just the records but whether the pages ran out on their own, because
 * `merge.ts` refuses to stale anything without that proof — a read that stopped at a ceiling and a read
 * that reached the end are indistinguishable from their results alone, and getting that wrong marks real
 * machines as gone.
 *
 * ## Three shapes, measured live
 *
 * - **offset** — `/devices/queries/devices/v1` and the policy queries. `meta.pagination.total` is
 *   authoritative and a page shorter than the limit means the end. One `limit=5000` page carries up to
 *   5,000 host ids, so the ceiling below is generous rather than tight.
 * - **after-cursor** — `/spotlight/combined/vulnerabilities/v1`, the open findings. The provider hands
 *   back an opaque `meta.pagination.after`; its ABSENCE is the end. An `after` that repeats is a provider
 *   bug rather than a loop to ride out, so it terminates the read as incomplete instead.
 * - **id-batch** — every `entities` endpoint. Not paging at all: the caller already holds the ids, so
 *   completeness is decided by whether every batch succeeded, and one failed batch makes the family read
 *   incomplete rather than shortening it.
 *
 * ## The page ceiling is a safety net, not a policy
 *
 * {@link MAX_PAGES} exists so a provider looping its own cursor cannot spin forever. Hitting it is reported
 * as an incomplete read, never as a finished one — which is the whole reason `pagesExhausted` is returned
 * rather than assumed.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type CrowdstrikeClientDeps, requestCrowdstrike } from "./client.js";
import { type CrowdstrikeError, CrowdstrikeErrors } from "./errors.js";

/**
 * The largest number of pages any one family read will fetch.
 *
 * Sized against the biggest family, the Spotlight findings: 200 pages at 400 per page is 80,000 findings,
 * and it still bounds a looping cursor; exhausting it is reported as an incomplete read. Compare an
 * installation's own family totals with `slopweaver crowdstrike sync --dry-run`, which prints each
 * family's reported total.
 *
 * @internal
 */
export const MAX_PAGES = 200;

/**
 * What one paged read produced, and whether it reached the end on its own.
 *
 * @internal
 */
export interface PagedRead {
  readonly resources: readonly unknown[];
  /** The provider's own `meta.pagination.total`, when it reported one. */
  readonly reportedTotal: number | null;
  /** `true` only when the provider itself offered no further page. */
  readonly pagesExhausted: boolean;
  /** The endpoint every page came from, for the provenance each record carries. */
  readonly endpoint: string;
}

/**
 * Read every `resources` entry from one response body, without trusting its shape.
 *
 * @param body the parsed response body
 * @returns the resources, or an empty list when the body carries none
 *
 * @internal
 */
export function resourcesOf({ body }: { body: unknown }): readonly unknown[] {
  if (!isRecord(body)) {
    return [];
  }
  const resources = body["resources"];
  return Array.isArray(resources) ? resources : [];
}

/**
 * Read one offset-paged collection to the end.
 *
 * @param callId the admitted call to page
 * @param query fixed query parameters every page carries, e.g. a filter
 * @param pageSize how many records to ask for per page
 * @param deps the client dependencies
 * @returns every record and whether the pages ran out, or the typed failure that stopped the read
 */
export async function readOffsetPaged({
  callId,
  query,
  pageSize,
  deps,
}: {
  callId: string;
  query: Readonly<Record<string, string>>;
  pageSize: number;
  deps: CrowdstrikeClientDeps;
}): Promise<Result<PagedRead, CrowdstrikeError>> {
  const collected: unknown[] = [];
  let reportedTotal: number | null = null;
  let endpoint = callId;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await requestCrowdstrike({
      callId,
      deps,
      input: { query: { ...query, limit: String(pageSize), offset: String(collected.length) } },
    });
    if (response.isErr()) {
      return err(response.error);
    }
    endpoint = response.value.endpoint;
    reportedTotal = response.value.total ?? reportedTotal;
    const pageItems = resourcesOf({ body: response.value.body });
    collected.push(...pageItems);
    const done = pageItems.length < pageSize || (reportedTotal !== null && collected.length >= reportedTotal);
    if (done) {
      return ok({ endpoint, pagesExhausted: true, reportedTotal, resources: collected });
    }
  }
  return ok({ endpoint, pagesExhausted: false, reportedTotal, resources: collected });
}

/** The total this page reported, else the last total an earlier page of the same read reported. */
function latestTotal({ page, prior }: { page: number | null; prior: number | null }): number | null {
  if (page == null) {
    return prior;
  }
  return page;
}

/**
 * Read one cursor-paged collection to the end.
 *
 * A cursor the provider repeats terminates the read as INCOMPLETE rather than looping: riding it out would
 * either spin to the page ceiling or, worse, return a plausible short result that then stales everything it
 * did not reach.
 *
 * @param callId the admitted call to page
 * @param query fixed query parameters every page carries, e.g. a filter and a facet
 * @param pageSize how many records to ask for per page
 * @param deps the client dependencies
 * @returns every record and whether the cursor ran out, or the typed failure that stopped the read
 */
export async function readCursorPaged({
  callId,
  query,
  pageSize,
  deps,
}: {
  callId: string;
  query: Readonly<Record<string, string>>;
  pageSize: number;
  deps: CrowdstrikeClientDeps;
}): Promise<Result<PagedRead, CrowdstrikeError>> {
  const collected: unknown[] = [];
  const seenCursors = new Set<string>();
  let reportedTotal: number | null = null;
  let endpoint = callId;
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const cursor: Readonly<Record<string, string>> = after === null ? {} : { after };
    const response = await requestCrowdstrike({
      callId,
      deps,
      input: { query: { ...query, ...cursor, limit: String(pageSize) } },
    });
    if (response.isErr()) {
      return err(response.error);
    }
    endpoint = response.value.endpoint;
    reportedTotal = latestTotal({ page: response.value.total, prior: reportedTotal });
    collected.push(...resourcesOf({ body: response.value.body }));
    after = response.value.afterCursor;
    if (after === null) {
      return ok({ endpoint, pagesExhausted: true, reportedTotal, resources: collected });
    }
    if (seenCursors.has(after)) {
      return err(
        CrowdstrikeErrors.incompleteRead({
          callId,
          observedSoFar: collected.length,
          reason: "the provider returned a paging cursor it had already returned, so the read cannot advance",
        }),
      );
    }
    seenCursors.add(after);
  }
  return ok({ endpoint, pagesExhausted: false, reportedTotal, resources: collected });
}

/**
 * Split a list of ids into batches no larger than the endpoint accepts.
 *
 * @param ids the ids to batch
 * @param size the endpoint's own batch limit
 * @returns the batches, in order, preserving the input order within each
 */
export function idBatches({ ids, size }: { ids: readonly string[]; size: number }): readonly (readonly string[])[] {
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    batches.push(ids.slice(index, index + size));
  }
  return batches;
}

/**
 * Fetch entity detail for a list of ids, in the batches the endpoint accepts.
 *
 * One failed batch fails the whole read. That is deliberate: a partial entity set looks exactly like a
 * shrunken fleet to a merge, and the failure a caller needs to see is "this family is incomplete", not a
 * shorter list of machines.
 *
 * @param callId the admitted entity call
 * @param ids every id to fetch detail for
 * @param batchLimit how many ids the endpoint takes at once
 * @param byBody whether the ids travel in a POST body rather than a repeated query parameter
 * @param idParam the parameter or body field the ids are carried in
 * @param deps the client dependencies
 * @returns every entity resource returned, or the typed failure that stopped the read
 */
export async function readIdBatches({
  callId,
  ids,
  batchLimit,
  byBody,
  idParam,
  deps,
}: {
  callId: string;
  ids: readonly string[];
  batchLimit: number;
  byBody: boolean;
  idParam: string;
  deps: CrowdstrikeClientDeps;
}): Promise<Result<{ resources: readonly unknown[]; endpoint: string }, CrowdstrikeError>> {
  const collected: unknown[] = [];
  let endpoint = callId;
  for (const batch of idBatches({ ids, size: batchLimit })) {
    const input = byBody ? { body: { [idParam]: batch } } : { query: { [idParam]: batch } };
    const response = await requestCrowdstrike({ callId, deps, input });
    if (response.isErr()) {
      return err(response.error);
    }
    endpoint = response.value.endpoint;
    collected.push(...resourcesOf({ body: response.value.body }));
  }
  return ok({ endpoint, resources: collected });
}
