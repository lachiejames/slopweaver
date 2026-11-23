/**
 * Running the plan — every path in `plan.ts`, page by page and parent by parent, through one injected GET.
 *
 * The GET is a seam rather than an import so the whole walk is testable without a network: production passes
 * `knowbe4Get` bound to the resolved token, a test passes a plain function answering canned bodies. Either way
 * every URL is built by `buildKnowbe4Url`, so a read can only ever land on a closed-list path.
 *
 * One path failing never sinks the others. A 403 on one is the subscription tier speaking, and the paths it
 * does allow are still worth publishing beside a cell that names the refusal.
 *
 * ## The bounds, and why they are this tight
 *
 * KnowBe4 meters the Reporting API per ACCOUNT — 50 requests a minute (a five-minute lockout past it) and
 * 2,000 plus the licensed-user count a day — and any other connector reading the same account draws on the
 * same allowance. So a run is bounded in REQUESTS, not just pages: {@link KNOWBE4_MAX_REQUESTS} is an eighth
 * of that allowance's fixed 2,000-request floor before the tenant's licensed-user count is added, and the
 * pacing row in `src/lib/rateLimitsAdminServices.ts` spaces them. A run that hits
 * any bound says so in the coverage cell rather than reporting a complete read.
 */
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";
import { Knowbe4ReadErrors } from "../../../live/knowbe4/errors.js";
import { buildKnowbe4Url, type Knowbe4Get, type Knowbe4PathTemplate } from "../../../live/knowbe4/transport.js";
import type { Knowbe4AtlasKind } from "../model.js";
import { countedOf, expectedOf, shortfallOf } from "./parentCount.js";
import { KNOWBE4_FILL_CALLS, type Knowbe4FillCall } from "./plan.js";
import { type Knowbe4ProjectedItem, publishableWords } from "./projectShapes.js";

/** Rows asked for per page — KnowBe4's documented maximum. A shorter page is the last one. */
export const KNOWBE4_PER_PAGE = 500;

/** Pages one list (or one parent's list) may follow before it reports itself truncated — 10,000 rows. */
export const KNOWBE4_MAX_PAGES = 20;

/** Parents a per-parent path fans out over before it reports itself truncated, by path. */
const KNOWBE4_MAX_PARENTS: Readonly<Partial<Record<Knowbe4PathTemplate, number>>> = {
  "/v1/groups/{id}/members": 100,
  "/v1/phishing/security_tests/{id}/recipients": 200,
};

/** Requests one whole run may send — see this file's header. */
const KNOWBE4_MAX_REQUESTS = 250;

/** Which path an outcome belongs to. */
interface Knowbe4CallIdentity {
  readonly template: Knowbe4PathTemplate;
  readonly kind: Knowbe4AtlasKind;
}

/** A path that answered. */
export interface Knowbe4CallAnswered extends Knowbe4CallIdentity {
  readonly items: readonly Knowbe4ProjectedItem[];
  /** Why the read stopped short of the end of the list, or `null` when it did not. */
  readonly truncatedBy: string | null;
}

/** A path that did not. `status` is KnowBe4's HTTP status, or `null` when the failure was never an answer. */
export interface Knowbe4CallFailed extends Knowbe4CallIdentity {
  readonly status: number | null;
  readonly message: string;
}

/** Everything one run brought back — what `sync.ts` publishes from. */
export interface Knowbe4FillObservation {
  readonly filledAtIso: string;
  readonly answered: readonly Knowbe4CallAnswered[];
  readonly failed: readonly Knowbe4CallFailed[];
}

/** Why one read stopped. */
interface Knowbe4ReadStop {
  readonly status: number | null;
  readonly message: string;
}

/** The run's request budget, spent as each GET goes out. */
interface RequestBudget {
  remaining: number;
}

/** What one list read, before it is attributed to its call. */
interface ListRead {
  readonly items: readonly Knowbe4ProjectedItem[];
  readonly truncatedBy: string | null;
}

/**
 * A body's text as JSON. This is the one place a KnowBe4 answer is parsed, and the endpoint's strict
 * `defineBoundary` (`boundaries.ts`) reads it next, in `readPage`; the transport only fetches.
 *
 * @param path the request path, for the refusal
 * @param text the body KnowBe4 answered
 * @returns the parsed body, untyped until the boundary reads it, or why it is not JSON
 */
function parsedBody({ path, text }: { path: string; text: string }): Result<unknown, Knowbe4ReadStop> {
  try {
    return ok(safeJsonParse({ label: `knowbe4 ${path}`, text }));
  } catch {
    return err({ message: Knowbe4ReadErrors.bodyNotJson({ path }).message, status: null });
  }
}

/**
 * Read and project one page.
 *
 * @param call the planned path
 * @param parentId the parent the path is read under, or `null`
 * @param page the 1-based page number, sent only on a paged path
 * @param get the injected GET
 * @returns the projected page, or why it stopped
 */
async function readPage({
  call,
  parentId,
  page,
  get,
}: {
  call: Knowbe4FillCall;
  parentId: string | null;
  page: number;
  get: Knowbe4Get;
}): Promise<Result<{ items: readonly Knowbe4ProjectedItem[]; rowCount: number }, Knowbe4ReadStop>> {
  const query: Record<string, string> = { ...call.query };
  if (call.paged) {
    query["page"] = String(page);
    query["per_page"] = String(KNOWBE4_PER_PAGE);
  }
  const url = buildKnowbe4Url({ query, template: call.template, ...(parentId === null ? {} : { id: parentId }) });
  if (url.isErr()) {
    return err({ message: url.error.message, status: null });
  }
  const text = await get({ url: url.value });
  if (text.isErr()) {
    return err({
      message: text.error.message,
      status: text.error.code === "TRANSPORT_FAILED" ? text.error.status : null,
    });
  }
  const body = parsedBody({ path: url.value.pathname, text: text.value });
  if (body.isErr()) {
    return err(body.error);
  }
  return call
    .page({ body: body.value, parentId })
    .mapErr((error) => ({ message: publishableWords({ error }), status: null }));
}

/**
 * The request ceiling, met before a page. Before a list's first page nothing was read, which is a failure, never
 * an empty answer, so the kind keeps what it held rather than emptying; after it, the list is bounded.
 *
 * @param items what the list read before the ceiling
 * @param page the page the ceiling stopped
 * @returns the bound, or the failure
 */
function ceilingStop({
  items,
  page,
}: {
  items: readonly Knowbe4ProjectedItem[];
  page: number;
}): Result<ListRead, Knowbe4ReadStop> {
  if (page === 1) {
    return err({
      message: `the run's ${String(KNOWBE4_MAX_REQUESTS)}-request ceiling was spent before it`,
      status: null,
    });
  }
  return ok({ items, truncatedBy: `the run's ${String(KNOWBE4_MAX_REQUESTS)}-request ceiling` });
}

/**
 * KnowBe4 is retiring `page` for `cursor`. A list that stops honouring `page` answers page 1 again, so a repeated
 * id is that change arriving, and it fails the list rather than publishing one page as the whole of it. An id twice
 * on ONE page fails too, since two rows under one id would be two entities with one identity.
 *
 * @param items what the list read before this page
 * @param page the page's number, for the refusal
 * @param pageItems what this page read
 * @returns the refusal naming the first repeated id, or `null` when none repeats
 */
function repeatedId({
  items,
  page,
  pageItems,
}: {
  items: readonly Knowbe4ProjectedItem[];
  page: number;
  pageItems: readonly Knowbe4ProjectedItem[];
}): string | null {
  const seen = new Set(items.map((item) => item.providerId));
  for (const item of pageItems) {
    if (seen.has(item.providerId)) {
      return `page ${String(page)} repeated ${item.providerId}, already read in this list — KnowBe4 may have stopped honouring \`page\``;
    }
    seen.add(item.providerId);
  }
  return null;
}

/**
 * Whether a page ends its list. A list ends only on an EMPTY page: a short page proves nothing once KnowBe4 may cap
 * or ignore `per_page`. A list held to its parent's own count ends on its first short page instead, since one more
 * request per parent is what spends the ceiling and `readParents` catches a capped page as a count mismatch.
 *
 * @param call the planned path; an unpaged one ends on its one answer
 * @param counted whether KnowBe4 published a count this list is held to
 * @param rowCount the rows the page answered
 * @returns `true` when no further page is read
 */
function listEnds({ call, counted, rowCount }: { call: Knowbe4FillCall; counted: boolean; rowCount: number }): boolean {
  if (!call.paged) {
    return true;
  }
  return counted ? rowCount < KNOWBE4_PER_PAGE : rowCount === 0;
}

/**
 * Follow one list — under one parent, or none — to its end, the page bound or the request budget.
 *
 * @param call the planned path
 * @param parentId the parent the path is read under, or `null`
 * @param get the injected GET
 * @param budget the run's remaining requests, spent here
 * @param counted whether KnowBe4 published a count this list is then held to, which alone lets a short page end it
 * @returns every projected item and why it stopped short if it did, or why it failed
 */
async function readList({
  call,
  parentId,
  get,
  budget,
  counted,
}: {
  call: Knowbe4FillCall;
  parentId: string | null;
  get: Knowbe4Get;
  budget: RequestBudget;
  counted: boolean;
}): Promise<Result<ListRead, Knowbe4ReadStop>> {
  const items: Knowbe4ProjectedItem[] = [];
  const pageLimit = call.paged ? KNOWBE4_MAX_PAGES : 1;
  for (let page = 1; page <= pageLimit; page += 1) {
    if (budget.remaining <= 0) {
      return ceilingStop({ items, page });
    }
    budget.remaining -= 1;
    const read = await readPage({ call, get, page, parentId });
    if (read.isErr()) {
      return err(read.error);
    }
    const repeated = repeatedId({ items, page, pageItems: read.value.items });
    if (repeated !== null) {
      return err({ message: repeated, status: null });
    }
    items.push(...read.value.items);
    if (listEnds({ call, counted, rowCount: read.value.rowCount })) {
      return ok({ items, truncatedBy: null });
    }
  }
  return ok({ items, truncatedBy: `the ${String(KNOWBE4_MAX_PAGES)}-page bound` });
}

/** What a per-parent fan-out read, with each parent whose rows did not match its own count. */
interface FanOutRead extends ListRead {
  readonly shortfalls: readonly string[];
}

/**
 * Why a per-parent path cannot run when its parent list did not answer. A parent refused on the subscription tier
 * refuses its children on the same ground, so the child carries the 403 and is stamped with the same block rather
 * than reading as a fault.
 *
 * @param failed what has failed so far
 * @param template the parent list's path
 * @returns the child's stop
 */
function parentStop({
  failed,
  template,
}: {
  failed: readonly Knowbe4CallFailed[];
  template: Knowbe4PathTemplate;
}): Knowbe4ReadStop {
  const why = failed.find((entry) => entry.template === template);
  if (why === undefined) {
    return { message: `its parent list ${template} did not answer`, status: null };
  }
  return {
    message: `its parent list ${template} did not answer (${why.message})`,
    status: why.status === 403 ? 403 : null,
  };
}

/**
 * Read a per-parent path under each parent in turn, to the end or the first bound.
 *
 * @param call the planned path
 * @param parents the parents to read under, already held to the parent bound
 * @param get the injected GET
 * @param budget the run's remaining requests
 * @returns what every parent's list read, why the fan-out stopped short if it did, and each count mismatch
 */
async function readParents({
  call,
  parents,
  get,
  budget,
}: {
  call: Knowbe4FillCall;
  parents: readonly Knowbe4ProjectedItem[];
  get: Knowbe4Get;
  budget: RequestBudget;
}): Promise<Result<FanOutRead, Knowbe4ReadStop>> {
  const items: Knowbe4ProjectedItem[] = [];
  const shortfalls: string[] = [];
  for (const [index, each] of parents.entries()) {
    // The ceiling falling exactly between two parents is a bound hit with real reads behind it, never a
    // failure that would discard them. Before the first parent, nothing was read, so `readList` fails.
    if (budget.remaining <= 0 && index > 0) {
      const truncatedBy = `the run's ${String(KNOWBE4_MAX_REQUESTS)}-request ceiling, before ${each.providerId}`;
      return ok({ items, shortfalls, truncatedBy });
    }
    const expected = expectedOf({ call, parent: each });
    const read = await readList({ budget, call, counted: expected !== null, get, parentId: each.providerId });
    if (read.isErr()) {
      return err({ message: `under ${each.providerId}: ${read.error.message}`, status: read.error.status });
    }
    items.push(...read.value.items);
    if (read.value.truncatedBy !== null) {
      return ok({ items, shortfalls, truncatedBy: `${read.value.truncatedBy}, under ${each.providerId}` });
    }
    const shortfall = shortfallOf({
      expected,
      got: countedOf({ call, items: read.value.items }),
      providerId: each.providerId,
    });
    if (shortfall !== null) {
      shortfalls.push(shortfall);
    }
  }
  return ok({ items, shortfalls, truncatedBy: null });
}

/**
 * Every bound a whole fan-out met: more parents than the bound, a count mismatch, or a parent list that stopped.
 *
 * @param limit the parent bound
 * @param parent what the parent list answered
 * @param shortfalls each parent whose rows did not match its count
 * @returns the bounds' words joined, or `null` when the fan-out is whole
 */
function fanOutStops({
  limit,
  parent,
  shortfalls,
}: {
  limit: number;
  parent: Knowbe4CallAnswered;
  shortfalls: readonly string[];
}): string | null {
  const stops = [
    parent.items.length > limit ? `the ${String(limit)}-parent bound (${String(parent.items.length)} parents)` : null,
    shortfalls.length > 0 ? `a row count other than the parent's own under ${shortfalls.join(", ")}` : null,
    parent.truncatedBy === null ? null : `its parent list stopped at ${parent.truncatedBy}`,
  ].filter((stop) => stop !== null);
  return stops.length === 0 ? null : stops.join("; ");
}

/**
 * Read one planned path in full: once, or once per parent the parent path answered.
 *
 * @param call the planned path
 * @param answered what the run has read so far, where a per-parent path finds its parents
 * @param failed what has failed so far, where a per-parent path learns its parent list did not answer
 * @param get the injected GET
 * @param budget the run's remaining requests
 * @returns what the path read, or why it failed
 */
async function readCall({
  call,
  answered,
  failed,
  get,
  budget,
}: {
  call: Knowbe4FillCall;
  answered: readonly Knowbe4CallAnswered[];
  failed: readonly Knowbe4CallFailed[];
  get: Knowbe4Get;
  budget: RequestBudget;
}): Promise<Result<ListRead, Knowbe4ReadStop>> {
  if (call.parent === null) {
    return readList({ budget, call, counted: false, get, parentId: null });
  }
  const parent = answered.find((entry) => entry.template === call.parent);
  if (parent === undefined) {
    return err(parentStop({ failed, template: call.parent }));
  }
  const limit = KNOWBE4_MAX_PARENTS[call.template]!;
  const read = await readParents({ budget, call, get, parents: parent.items.slice(0, limit) });
  if (read.isErr()) {
    return err(read.error);
  }
  const { items, shortfalls, truncatedBy } = read.value;
  if (truncatedBy !== null) {
    return ok({ items, truncatedBy });
  }
  return ok({ items, truncatedBy: fanOutStops({ limit, parent, shortfalls }) });
}

/**
 * Call every planned path and report what each one did.
 *
 * @param get the injected GET — `knowbe4Get` bound to the token in production
 * @param at this run's ISO timestamp
 * @returns the observation, one outcome per planned path
 */
export async function runKnowbe4Fill({ get, at }: { get: Knowbe4Get; at: string }): Promise<Knowbe4FillObservation> {
  const answered: Knowbe4CallAnswered[] = [];
  const failed: Knowbe4CallFailed[] = [];
  const budget: RequestBudget = { remaining: KNOWBE4_MAX_REQUESTS };
  for (const call of KNOWBE4_FILL_CALLS) {
    const identity = { kind: call.kind, template: call.template };
    const read = await readCall({ answered, budget, call, failed, get });
    if (read.isErr()) {
      failed.push({ ...identity, message: read.error.message, status: read.error.status });
      continue;
    }
    answered.push({ ...identity, items: read.value.items, truncatedBy: read.value.truncatedBy });
  }
  return { answered, failed, filledAtIso: at };
}
