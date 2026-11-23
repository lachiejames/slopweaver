/**
 * Walk one admitted operation to the end of its own result set, and say honestly whether it got there.
 *
 * One function, because every completeness judgement this atlas makes rests on what it returns. A walk that
 * reported only its records would leave the caller to infer completeness from a count, which is exactly the
 * inference `coverage.ts` refuses to accept.
 *
 * ## A page ceiling is a FAILURE condition, not a stopping condition
 *
 * {@link MAX_PAGES} exists because a provider that keeps answering full pages would otherwise loop forever
 * against an admin credential. Hitting it does not end the walk successfully — it ends it INCOMPLETE, with
 * `pagesExhausted: false`, so nothing downstream may stale an entity or call the family synced. A crawl
 * that exceeds its budget is a failed crawl, never a completed one.
 *
 * ## The provider can force a walk the registry did not declare
 *
 * `GET /api/systems` is generated as unpaged and answers a default page of 100 against a larger declared total. The registry stays the
 * authority on what may be CALLED; the provider is the authority on how much there is to read. So a first
 * page that comes back short of a declared total switches the walk to offset paging and REPORTS the
 * disagreement — `paginationDisagreed` is a corroboration finding, not an internal detail.
 *
 * ## The paging parameters are attempted too, and a provider may refuse them outright
 *
 * The registry-versus-provider disagreement above runs both ways, and the other direction is what kept this
 * whole atlas unpublishable. MEASURED live:
 * `GET /api/v2/approvalflows` and `GET /api/v2/approvalflowrequest` are generated as `limit-skip` and
 * answer **HTTP 500 to any query parameter at all** — `limit` alone, `skip`, or the pinned `sort` — while a
 * bare request answers 200 with an ordinary `{"results":[…],"totalCount":…}` envelope. A 500 is retryable by
 * design, so both arrived as a blocking `TRANSPORT_FAILED` and refused the publication on consecutive full
 * syncs.
 * Reproduce by calling either surface through `requestJumpcloud` with and without a `query`.
 *
 * So the FIRST page's query is attempted and, when the provider refuses it, dropped once — the walk reads
 * the collection bare and says so. It is deliberately first-page-only, because dropping the offset halfway
 * through a walk would re-read from the start and double every record already held. A bare read that comes
 * back short of a declared total is not trusted either: {@link forcedPagination} switches it straight back,
 * so the escape hatch cannot turn a truncated read into a complete one.
 *
 * ## The pinned sort is attempted, not assumed
 *
 * `paging.ts` pins `sort=_id` on every offset walker, because an offset walk over an unordered sequence can
 * omit a record while the count stays right. MEASURED live: several endpoints answer HTTP 400
 * to that parameter — `GET /api/v2/systeminsights/users` among them, which returns normally the moment the
 * sort is dropped. So the sort is ATTEMPTED and, on a 400, dropped for the rest of that walk, with the walk
 * marked unsorted. An unsorted walk is not failed and it is not fully trusted either: completeness then
 * rests on the provider's declared total alone, and a shortfall is reported rather than smoothed over.
 *
 * ## Reachable-and-empty is its own answer
 *
 * An endpoint for a product the tenancy has not provisioned (`/api/radiusservers`, `/api/v2/duo/accounts`,
 * `/api/v2/activedirectories`, `/api/v2/workdays`) returns zero records, and a System Insights table with
 * nothing collected (`systeminsights/shadow`) is reachable and empty. Those are not failures and they are not full coverage either — an attribute
 * census over zero observations has a vocabulary derived from nothing while claiming to describe the
 * family. So the walk reports `empty` distinctly and the caller raises `reachable-but-empty`.
 */
import { appendAll } from "../../lib/arrays.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type JumpcloudClientDeps, type JumpcloudResponse, requestJumpcloud } from "./client.js";
import type { JumpcloudReadError } from "./errors.js";
import {
  effectivePageSize,
  forcedPagination,
  JUMPCLOUD_PAGE_SIZE,
  type JumpcloudPage,
  offsetWalkComplete,
  pageQuery,
  steppedDownLimit,
} from "./paging.js";
import type { JumpcloudOperation } from "./plan.js";
import { mergeOperationReads } from "./readMerge.js";
import { jumpcloudQueryVariants } from "./requestContracts.js";
import type { JumpcloudAdmit } from "./responseRegistry.js";
import type { JumpcloudPagination } from "./surfaceNaming.js";

/** One request's query, where a repeated parameter is an array — see `client.ts`'s `JumpcloudRequestInput`. */
type JumpcloudQuery = Readonly<Record<string, string | readonly string[]>>;

/**
 * How many pages one operation may ask for before the walk is abandoned as failed.
 *
 * 500 pages at {@link JUMPCLOUD_PAGE_SIZE} is 500,000 records from ONE operation. The earlier value of that
 * page size made this bound 50,000, and MEASURED that was not enough: System Insights tables whose
 * declared `totalCount` exceeded it, `certificates` among them, were abandoned mid-walk. The bound is a
 * safety rail against a provider that never stops answering, not an estimate of how much data exists, so it
 * is set past every family a walk has declared rather than at one.
 * @internal
 */
export const MAX_PAGES = 500;

/**

 * What one operation's walk produced, and whether it reached the end.
 * @internal
 */
export interface JumpcloudOperationRead {
  /** Every record the walk produced, in page order. */
  readonly records: readonly unknown[];
  /** The provider's own declared total, or `null` when it declared none. */
  readonly declaredTotal: number | null;
  /** Whether paging ended because the provider ran out, rather than because the ceiling was hit. */
  readonly pagesExhausted: boolean;
  /** Whether the walk may be treated as covering the whole collection. */
  readonly complete: boolean;
  /** The sentence a coverage reason quotes about this walk. */
  readonly reason: string;
  /** The bound path the last page was read from — the reproduction handle a stored record carries. */
  readonly endpoint: string;
  /** True when the operation answered successfully and carried no records at all. */
  readonly empty: boolean;
  /** True when the provider paged an operation the pinned specification describes as unpaged. */
  readonly paginationDisagreed: boolean;
  /** True when the provider refused this operation's paging parameters, so the walk read it bare. */
  readonly pagingRefused: boolean;
  /** True when the provider refused the pinned sort, so this walk's page order is the provider's own. */
  readonly unsorted: boolean;
  /**
   * True when this walk is incomplete for a reason a LATER RUN COULD CLEAR — it came up short of the
   * provider's own declared total, or it hit the page budget. Both are transient in the way that matters,
   * so a generation carrying one is not published.
   *
   * False for an operation that declares a limit and no cursor: one page of it is a cap by construction,
   * and no number of runs turns a cap into a census. Blocking on that would make the family permanently
   * unpublishable, which is the opposite of honest.
   */
  readonly incompleteIsClearable: boolean;
}

/** The mutable state of one walk, so the loop and its verdict read the same numbers. */
interface WalkState {
  readonly records: unknown[];
  declaredTotal: number | null;
  endpoint: string;
  lastPageRecords: number;
  /** What a page of THIS walk actually holds, measured from the largest page it has seen. */
  pageSize: number;
  /** The limit this walk asks for, halved each time the provider refuses the one before it. */
  askLimit: number;
  largestPageRecords: number;
  pagination: JumpcloudPagination;
  paginationDisagreed: boolean;
  /** True once the provider refused the paging query, so this walk asks for the collection bare. */
  pagingRefused: boolean;
  /** True once the provider refused the pinned sort, so this walk pages over an order it did not choose. */
  unsorted: boolean;
  pages: number;
  singleObject: boolean;
  ended: boolean;
}

/**
 * The first total any page of this walk declared, kept once seen; until then, whatever this page declares —
 * itself `null` when the provider declared none, which is an answer rather than a missing value.
 */
function firstDeclaredTotal({ state, page }: { state: WalkState; page: JumpcloudPage }): number | null {
  if (state.declaredTotal !== null) {
    return state.declaredTotal;
  }
  return page.totalCount;
}

/**
 * Fold one page into the walk, and say whether the walk continues.
 *
 * @param state the walk's own state, updated in place
 * @param page the page just read
 * @returns whether there is another page to ask for
 */
function absorbPage({ state, page }: { state: WalkState; page: JumpcloudPage }): boolean {
  state.declaredTotal = firstDeclaredTotal({ page, state });
  state.largestPageRecords = Math.max(state.largestPageRecords, page.records.length);
  state.pageSize = effectivePageSize({ asked: state.askLimit, largestPageRecords: state.largestPageRecords });
  state.lastPageRecords = page.records.length;
  appendAll({ from: page.records, into: state.records });
  if (page.shape === "single-object" || page.shape === "empty" || page.records.length === 0) {
    state.singleObject = page.shape === "single-object";
    return false;
  }
  const forced = forcedPagination({
    declared: state.pagination,
    observed: page.records.length,
    totalCount: state.declaredTotal,
  });
  if (forced !== null) {
    state.pagination = forced;
    state.paginationDisagreed = true;
    return true;
  }
  if (state.pagination === "none" || state.pagination === "limit-only") {
    return false;
  }
  if (state.declaredTotal !== null && state.records.length >= state.declaredTotal) {
    return false;
  }
  return page.records.length >= state.pageSize;
}

/**
 * The half of a verdict that an unpaged answer decides — one response, and it is the whole collection.
 *
 * @param state the walk's final state
 * @param operation the operation it walked
 * @returns the completeness fields and the sentence coverage quotes, which names a refused paging query
 */
function unpagedVerdict({
  state,
  operation,
}: {
  state: WalkState;
  operation: JumpcloudOperation;
}): Pick<JumpcloudOperationRead, "complete" | "incompleteIsClearable" | "pagesExhausted" | "reason"> {
  const refused = state.pagingRefused
    ? " — the provider refused this operation's paging parameters, so the collection was read bare"
    : "";
  return {
    complete: true,
    incompleteIsClearable: false,
    pagesExhausted: true,
    reason: `${operation.row.name} answered ${String(state.records.length)} record(s) in one unpaged response${refused}`,
  };
}

/**
 * The verdict on a finished walk.
 *
 * @param state the walk's final state
 * @param operation the operation it walked
 * @returns what the walk produced and whether it may be treated as complete
 */
function verdict({ state, operation }: { state: WalkState; operation: JumpcloudOperation }): JumpcloudOperationRead {
  const shared = {
    declaredTotal: state.declaredTotal,
    empty: state.records.length === 0,
    endpoint: state.endpoint,
    paginationDisagreed: state.paginationDisagreed,
    pagingRefused: state.pagingRefused,
    records: state.records,
    unsorted: state.unsorted,
  };
  if (!state.ended) {
    return {
      ...shared,
      complete: false,
      incompleteIsClearable: true,
      pagesExhausted: false,
      reason: `${operation.row.name} was abandoned after ${String(MAX_PAGES)} pages and ${String(state.records.length)} record(s) — a walk that exceeds its page budget is a failed walk, never a completed one`,
    };
  }
  const unpaged = state.singleObject || (state.pagination === "none" && !state.paginationDisagreed);
  if (unpaged) {
    return { ...shared, ...unpagedVerdict({ operation, state }) };
  }
  if (state.pagination === "limit-only") {
    return {
      ...shared,
      complete: false,
      incompleteIsClearable: false,
      pagesExhausted: true,
      reason: `${operation.row.name} declares a limit and no cursor, so one page of ${String(state.records.length)} record(s) is a cap rather than a census`,
    };
  }
  const walked = offsetWalkComplete({
    observed: state.records.length,
    pageRecords: state.lastPageRecords,
    pageSize: state.pageSize,
    totalCount: state.declaredTotal,
  });
  const forced = state.paginationDisagreed
    ? " (the pinned specification describes this operation as unpaged; the provider paged it)"
    : "";
  const sorted = state.unsorted
    ? " — the provider refused the pinned sort, so this walk pages over an order it did not choose"
    : "";
  return {
    ...shared,
    complete: walked.complete,
    incompleteIsClearable: !walked.complete,
    pagesExhausted: walked.ended,
    reason: `${operation.row.name}: ${walked.reason}${forced}${sorted}`,
  };
}

/**
 * The same query with the pinned sort removed, for a provider that refuses it.
 *
 * @param query the query that was refused
 * @returns the query without `sort`
 */
function withoutSort({ query }: { query: JumpcloudQuery }): JumpcloudQuery {
  const { sort: _sort, ...rest } = query;
  return rest;
}

/**
 * The query this walk asks its next page for, given everything the provider has already refused.
 *
 * The operation's PINNED CONTRACT is merged in first and is never subtracted by a refusal: `targets` on a
 * graph endpoint is not a paging parameter this atlas may drop to get an answer — dropping it is what
 * produced the 400 the contract exists to fix. Only the paging half is negotiable, which is why the two are
 * spread in that order rather than combined.
 *
 * @param state the walk so far, whose two refusals each subtract from the PAGING half of what is sent
 * @param contract the pinned contract query this walk sends on every page
 * @returns the query, down to the contract alone once the provider has refused the paging parameters
 */
function pageQueryFor({ state, contract }: { state: WalkState; contract: JumpcloudQuery }): {
  readonly paging: JumpcloudQuery;
  readonly sent: JumpcloudQuery;
} {
  const asked = pageQuery({
    alreadyRead: state.records.length,
    askLimit: state.askLimit,
    cursor: null,
    pagination: state.pagination,
  });
  const paging = state.unsorted ? withoutSort({ query: asked }) : asked;
  return { paging, sent: { ...contract, ...paging } };
}

/**
 * Apply the retry {@link actionForFailedPage} chose, so the loop dispatches rather than branching twice.
 *
 * @param action the retry to apply; `give-up` never reaches here
 * @param state the walk's own state, updated in place
 */
function applyFailedPageAction({ action, state }: { action: FailedPageAction; state: WalkState }): void {
  if (action === "drop-sort") {
    state.unsorted = true;
    return;
  }
  if (action === "halve-limit") {
    // Non-null by construction: `actionForFailedPage` only chooses this when a step down exists.
    state.askLimit = steppedDownLimit({ limit: state.askLimit })!;
    state.pageSize = state.askLimit;
    return;
  }
  state.pagingRefused = true;
  state.pagination = "none";
}

/** What a refused page means for the walk. */
type FailedPageAction = "drop-sort" | "halve-limit" | "drop-paging" | "give-up";

/**
 * What to do about a page the provider refused — pure, so the walk loop states the choice rather than
 * computing it, and so every branch of it is reachable from a test without a network.
 *
 * The three retries are ordered, and the order matters. The pinned sort is the narrowest suspicion, so it
 * goes first and costs nothing when it is wrong. Stepping the limit down is next, and it is available on
 * ANY page: an offset walk's `skip` is the count of records already read, so a smaller limit part-way
 * through is exact rather than approximate. Dropping the paging query is the widest and is FIRST-PAGE ONLY,
 * because dropping the offset halfway through a walk would re-read from the start and double every record
 * already held.
 *
 * Both failure codes count, for a reason that is measured rather than defensive: THIS PROVIDER SIGNALS THE
 * SAME REFUSAL WITH BOTH. MEASURED, `/api/systems?limit=1000` answers 400 (`OPERATION_UNUSABLE`)
 * with `request parameter "limit" exceeds maximum value of 100`, while
 * `/api/v2/object-storage/items?limit=1000` answers **500** for the same cap and therefore arrives as
 * `TRANSPORT_FAILED` once its retries are spent. Both answer 200 at `limit=100`. Reading the code rather
 * than the condition is what let one object-storage call refuse a whole generation's worth of calls. Admitting
 * `TRANSPORT_FAILED` costs a few extra calls on a genuinely transient failure, and they end at the floor in
 * the same refusal.
 *
 * @param error the failure the request produced
 * @param query the query that was sent, whose emptiness is what makes a refusal an answer instead
 * @param state the walk so far, which decides whether either retry is still available
 * @returns the retry to attempt, or `give-up` to return the failure as the operation's answer
 * @internal — exported for its own unit test, because a 5xx path costs real provider backoff end to end.
 */
export function actionForFailedPage({
  error,
  query,
  state,
}: {
  error: JumpcloudReadError;
  query: JumpcloudQuery;
  state: WalkState;
}): FailedPageAction {
  if (!state.unsorted && query["sort"] !== undefined && error.code === "OPERATION_UNUSABLE") {
    return "drop-sort";
  }
  const refusable = error.code === "OPERATION_UNUSABLE" || error.code === "TRANSPORT_FAILED";
  const overLimit = refusable && query["limit"] !== undefined && steppedDownLimit({ limit: state.askLimit }) !== null;
  if (overLimit) {
    return "halve-limit";
  }
  if (!state.pagingRefused && state.pages === 0 && Object.keys(query).length > 0 && refusable) {
    return "drop-paging";
  }
  return "give-up";
}

/**
 * Walk one admitted operation, paging as its registry row declares — or as the provider forces.
 *
 * An operation whose contract takes one value per call (`requestContracts.ts`'s `onePerCall`) is walked
 * once per value and the walks merged, in the contract's own order; the first failure stops the whole read,
 * because an association list missing one target is not that operation's answer.
 *
 * @param operation the planned operation
 * @param bindings one value per path parameter, empty for a root collection
 * @param deps the credential and the HTTP seam
 * @param admit how each answered page is admitted — `admitJumpcloudPage` in production
 * @returns what the walk produced and whether it finished, or the first typed failure that stopped it
 */
export async function readJumpcloudOperation({
  operation,
  bindings,
  deps,
  admit,
  now,
}: {
  operation: JumpcloudOperation;
  bindings: Readonly<Record<string, string>>;
  deps: JumpcloudClientDeps;
  admit: JumpcloudAdmit;
  now: string;
}): Promise<Result<JumpcloudOperationRead, JumpcloudReadError>> {
  const reads: JumpcloudOperationRead[] = [];
  for (const contract of jumpcloudQueryVariants({ now, operation: operation.row.name })) {
    // Sequential, like the pages inside each walk: the shared rate door paces them either way.
    const read = await walkOneContract({ admit, bindings, contract, deps, operation });
    if (read.isErr()) {
      return err(read.error);
    }
    reads.push(read.value);
  }
  return ok(mergeOperationReads({ reads }));
}

/** A walk's state before its first page: the row's own path and pagination, nothing read yet. */
function initialWalkState({ operation }: { operation: JumpcloudOperation }): WalkState {
  return {
    declaredTotal: null,
    unsorted: false,
    ended: false,
    endpoint: operation.row.path,
    largestPageRecords: 0,
    lastPageRecords: 0,
    askLimit: JUMPCLOUD_PAGE_SIZE,
    pageSize: JUMPCLOUD_PAGE_SIZE,
    pages: 0,
    pagination: operation.row.pagination,
    paginationDisagreed: false,
    pagingRefused: false,
    records: [],
    singleObject: false,
  };
}

/**
 * Walk one admitted operation with one fixed contract query.
 *
 * @param operation the planned operation
 * @param bindings one value per path parameter, empty for a root collection
 * @param contract the pinned contract query sent on every page of this walk
 * @param deps the credential and the HTTP seam
 * @param admit how each answered page is admitted
 * @returns what the walk produced and whether it finished, or the first typed failure that stopped it
 */
async function walkOneContract({
  operation,
  bindings,
  contract,
  deps,
  admit,
}: {
  operation: JumpcloudOperation;
  bindings: Readonly<Record<string, string>>;
  contract: JumpcloudQuery;
  deps: JumpcloudClientDeps;
  admit: JumpcloudAdmit;
}): Promise<Result<JumpcloudOperationRead, JumpcloudReadError>> {
  const state = initialWalkState({ operation });
  while (state.pages < MAX_PAGES) {
    const { paging, sent } = pageQueryFor({ contract, state });
    // Sequential by construction: the next offset is only meaningful once this page came back, and the
    // shared rate door paces the sequence anyway.
    const answered: Result<JumpcloudResponse, JumpcloudReadError> = await requestJumpcloud({
      deps,
      input: { bindings, query: sent },
      surface: operation.row.name,
    });
    if (answered.isErr()) {
      // The PAGING half, never the merged query: every retry this chooses subtracts from paging, so a
      // contract-only query must read as nothing left to drop rather than as one more thing to try.
      const action = actionForFailedPage({ error: answered.error, query: paging, state });
      if (action === "give-up") {
        return err(answered.error);
      }
      applyFailedPageAction({ action, state });
      continue;
    }
    // A page its surface's boundary refuses ends the walk with that refusal: nothing it carried is absorbed, and
    // no retry is chosen, because drift is the answer rather than a request this walk could ask differently.
    const page = admit({
      headers: answered.value.headers,
      surface: operation.row.name,
      text: answered.value.text,
    });
    if (page.isErr()) {
      return err(page.error);
    }
    state.endpoint = answered.value.endpoint;
    state.pages += 1;
    if (!absorbPage({ page: page.value, state })) {
      state.ended = true;
      break;
    }
  }
  return ok(verdict({ operation, state }));
}
