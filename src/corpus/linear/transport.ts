/**
 * THE Linear read transport — one client, one rate scheduler, one door, one observer.
 *
 * Before this module there were THREE. `fetch.ts` built a `LinearClient` + a `createRateScheduler` for the
 * activity lane; `fetch.ts`'s `makeLinearApi` was called a SECOND time by the member-hydration step with a
 * fresh token, building another pair; and `structures.ts` built a third for the org/team lane. All three ran
 * inside one `refresh` process against ONE quota, so each paced itself to 0.5 req/s while the process as a
 * whole issued up to 1.5 — the pacing was a per-lane fiction. Consolidating is not tidying: the budget is
 * per-user (see {@link ../../lib/rateLimits}), so a scheduler that does not see every request cannot hold it.
 *
 * ## What is observed, and why a request count is not enough
 *
 * Linear enforces TWO budgets: **2,500 requests/hour** and a separate **3,000,000 complexity points/hour**
 * with a 10,000-point per-query ceiling. Complexity is what a fat query actually spends, and it is measured
 * to track the size of the NESTED connections rather than the outer page size — `history(100)` +
 * `stateHistory(100)` costs the same 474 points whether the page holds 1 issue or 50. So a request count
 * cannot be converted into a complexity spend, and this expansion of the selection makes complexity the
 * budget more likely to bind first. Both are read off the response headers and accumulated here, so the
 * verb can report a real spend instead of an inferred one.
 *
 * The observation sits INSIDE the retried unit, so a 429 that is retried is counted as the two requests it
 * really was rather than the one the caller asked for.
 *
 * ## The seams
 *
 * {@link LinearRawRequest} is the injected transport (production wraps the SDK's `rawRequest`); tests inject
 * a plain fake that returns fixture data plus whatever headers the case is about. {@link LinearTransport}
 * exposes the gated+retried+observed `request` that every Linear lane now shares.
 */
import { LinearClient } from "@linear/sdk";

import { type BudgetHeadroom, type BudgetPacer, createBudgetPacer } from "../../lib/budgetPacer.js";
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall, scopeIdForToken } from "../../lib/providerCall.js";
import { createRateScheduler, type RateScheduler } from "../../lib/resilience.js";
import { orThrow } from "../../lib/safeBoundary.js";

/**
 * The request-rate FLOOR, shared by every read lane and the write seam: they all spend one per-user budget.
 *
 * 0.55/s = 1,980/hr, which is the rate registry's own derating of the MEASURED 2,500/hr quota (`SAFETY = 0.8`)
 * rather than a number picked by feel — so the repo has one convention instead of two. It was 0.5/s, chosen when
 * the quota was believed to be 1,500/hr; the measurement retired that, and this retires the leftover margin.
 *
 * Raising it is only safe BECAUSE the complexity budget is now held separately, by {@link ../../lib/budgetPacer}.
 * A request rate cannot hold a budget whose per-request cost varies 700× across lanes, and the crawl's real
 * constraint turned out to be complexity, not requests: ~940 requests but ~1.5M points.
 */
export const LINEAR_RATE_PER_SEC = 0.55;

/** The raw GraphQL transport seam: one inline query → its `data`. Production uses the SDK's `rawRequest`. */
export type LinearRequest = (args: { query: string; variables: Record<string, unknown> }) => Promise<unknown>;

/**
 * The RAW seam beneath {@link LinearRequest} — the same call, but handing back the response headers so the
 * observer can read the cost Linear reports. Separate from `LinearRequest` because every consumer above the
 * transport wants only `data`; only the transport itself cares what a request cost.
 */
export type LinearRawRequest = (args: {
  query: string;
  variables: Record<string, unknown>;
}) => Promise<{ data: unknown; headers?: unknown }>;

/** The accumulated cost of every Linear request this transport has made. */
export interface LinearTransportStats {
  /** Requests actually issued, counting each retry attempt separately (a retried 429 cost two). */
  readonly requests: number;
  /** Summed `x-complexity` across every response that reported one. */
  readonly complexity: number;
  /** Summed response bytes (the serialised `data`), so a fatter selection's real weight is visible. */
  readonly bytes: number;
  /** Summed wall-clock spent inside the raw call, pacing excluded. */
  readonly latencyMs: number;
  /** The LAST reported request headroom, or undefined when no response carried it. */
  readonly requestsRemaining?: number;
  /** The LAST reported complexity headroom, or undefined when no response carried it. */
  readonly complexityRemaining?: number;
  /** Responses that reported no `x-complexity` at all — so a zero spend can't be mistaken for a free query. */
  readonly unpricedResponses: number;
}

/** The zero point of {@link LinearTransportStats} — no requests, nothing observed. */
export const ZERO_LINEAR_STATS: LinearTransportStats = {
  bytes: 0,
  complexity: 0,
  latencyMs: 0,
  requests: 0,
  unpricedResponses: 0,
};

/** One observed request's measured cost, before it is folded into the running total. */
export interface LinearObservedRequest {
  readonly bytes: number;
  readonly latencyMs: number;
  readonly complexity?: number;
  readonly requestsRemaining?: number;
  readonly complexityRemaining?: number;
  /** Each budget's full state as the response reported it, for the pacer. */
  readonly budgets?: readonly BudgetHeadroom[];
}

/**
 * A `Headers`-like bag (what `graphql-request` hands back): lookup by name, case-insensitive.
 *
 * `get` is positional because it mirrors the DOM's own `Headers.get(name)`. Exported so a test fake can INHERIT
 * this shape rather than restate it — a restated one would be an authored signature, and the compiler would
 * stop checking the fake against the thing it stands in for.
 */
export interface HeaderBag {
  readonly get: (name: string) => string | null;
}

/** Whether a value is a `Headers`-like bag rather than a plain record. Positional: a type predicate. */
function isHeaderBag(value: unknown): value is HeaderBag {
  return isRecord(value) && typeof value["get"] === "function";
}

/**
 * One header's value, from either shape a transport might hand over: a `Headers` object (production) or a
 * plain lower-cased record (a test fake). Pure. A plain record is looked up case-insensitively too, so a
 * fixture written with the canonical `X-Complexity` spelling is not silently invisible.
 *
 * @param headers the header bag (any shape, or absent)
 * @param name the header name to read (lower-case)
 * @returns the value, or `undefined` when absent
 */
export function headerValue({ headers, name }: { headers: unknown; name: string }): string | undefined {
  if (isHeaderBag(headers)) {
    const found = headers.get(name);
    return found === null || found.length === 0 ? undefined : found;
  }
  if (!isRecord(headers)) {
    return undefined;
  }
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  const value = entry?.[1];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** A header parsed as a non-negative finite integer, or undefined when absent/unparseable. Pure. */
function headerNumber({ headers, name }: { headers: unknown; name: string }): number | undefined {
  const raw = headerValue({ headers, name });
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * The cost Linear reported for one response, read off its headers. Pure.
 *
 * The three header names are Linear's own: `x-complexity` (this query's cost) plus the two remaining-quota
 * headers. An absent `x-complexity` is reported as `undefined` rather than 0, because "this response did not
 * price itself" and "this response was free" are different facts and only one of them is ever true.
 *
 * @param headers the response headers (any shape, or absent)
 * @returns the reported complexity + remaining budgets, each absent when the header was not sent
 */
export function parseLinearCost({ headers }: { headers: unknown }): {
  complexity?: number;
  requestsRemaining?: number;
  complexityRemaining?: number;
  budgets?: readonly BudgetHeadroom[];
} {
  const complexity = headerNumber({ headers, name: "x-complexity" });
  const requestsRemaining = headerNumber({ headers, name: "x-ratelimit-requests-remaining" });
  const complexityRemaining = headerNumber({ headers, name: "x-ratelimit-complexity-remaining" });
  const budgets = parseLinearBudgets({ complexity, headers });
  return {
    ...(complexity !== undefined ? { complexity } : {}),
    ...(requestsRemaining !== undefined ? { requestsRemaining } : {}),
    ...(complexityRemaining !== undefined ? { complexityRemaining } : {}),
    ...(budgets.length > 0 ? { budgets } : {}),
  };
}

/**
 * Both rate-limit budgets, as the response reported them. Pure.
 *
 * Linear returns `limit`, `remaining` AND `reset` for requests and for complexity, which is why the pacer
 * models nothing: it is told. A budget missing any of its three headers is DROPPED rather than half-guessed —
 * pacing against a limit with an invented reset time would be worse than not pacing at all.
 *
 * @param headers the response headers
 * @param complexity this response's own complexity cost, when reported
 * @returns the budgets that were fully reported
 */
function parseLinearBudgets({
  headers,
  complexity,
}: {
  headers: unknown;
  complexity: number | undefined;
}): readonly BudgetHeadroom[] {
  const budgets: BudgetHeadroom[] = [];
  for (const { prefix, lastCost } of [
    { lastCost: 1, prefix: "requests" },
    { lastCost: complexity, prefix: "complexity" },
  ] as const) {
    const limit = headerNumber({ headers, name: `x-ratelimit-${prefix}-limit` });
    const remaining = headerNumber({ headers, name: `x-ratelimit-${prefix}-remaining` });
    const resetAtMs = headerNumber({ headers, name: `x-ratelimit-${prefix}-reset` });
    if (limit === undefined || remaining === undefined || resetAtMs === undefined || lastCost === undefined) {
      continue;
    }
    budgets.push({ lastCost, limit, remaining, resetAtMs });
  }
  return budgets;
}

/**
 * The running complexity total after one request. A response Linear did not price adds nothing to the sum: it
 * is counted in `unpricedResponses` instead, which is what keeps a zero total distinguishable from a free crawl.
 */
function complexityTotal({
  stats,
  observed,
}: {
  stats: LinearTransportStats;
  observed: LinearObservedRequest;
}): number {
  const running = stats.complexity;
  const { complexity } = observed;
  if (complexity === undefined) {
    return running;
  }
  return running + complexity;
}

/**
 * Fold one observed request into the running total. Pure, so the accounting is testable without a network:
 * counts and sums accumulate, the two remaining-budget readings are LAST-WINS (a headroom figure is a
 * snapshot, not a quantity to add up), and a response with no reported complexity increments
 * `unpricedResponses` so a zero complexity total can be told apart from a genuinely free crawl.
 *
 * @param stats the running total
 * @param observed the request just completed
 * @returns the new total
 */
export function foldLinearRequest({
  stats,
  observed,
}: {
  stats: LinearTransportStats;
  observed: LinearObservedRequest;
}): LinearTransportStats {
  const requestsRemaining = observed.requestsRemaining ?? stats.requestsRemaining;
  const complexityRemaining = observed.complexityRemaining ?? stats.complexityRemaining;
  return {
    bytes: stats.bytes + observed.bytes,
    complexity: complexityTotal({ observed, stats }),
    latencyMs: stats.latencyMs + observed.latencyMs,
    requests: stats.requests + 1,
    unpricedResponses: stats.unpricedResponses + (observed.complexity === undefined ? 1 : 0),
    ...(requestsRemaining !== undefined ? { requestsRemaining } : {}),
    ...(complexityRemaining !== undefined ? { complexityRemaining } : {}),
  };
}

/** The one shared Linear read transport: the gated+retried+observed request, plus what it has spent. */
export interface LinearTransport {
  /** The single request every Linear read lane goes through. */
  readonly request: LinearRequest;
  /** The cost accumulated so far. A snapshot — call it again for a later reading. */
  readonly stats: () => LinearTransportStats;
}

/**
 * Serialised size of a response payload, in bytes — the honest weight of what came back over the wire.
 *
 * The three unserialisable cases are excluded explicitly rather than coalesced: `JSON.stringify` returns
 * `undefined` (not `""`) for each, and `Buffer.byteLength(undefined)` throws, so a transport measuring an odd
 * payload would take down the crawl it was only supposed to be observing.
 */
function responseBytes({ data }: { data: unknown }): number {
  if (data === undefined || typeof data === "function" || typeof data === "symbol") {
    return 0;
  }
  return Buffer.byteLength(JSON.stringify(data), "utf8");
}

/**
 * Measure one completed raw response. Pure given the two clock readings, so the whole accounting path is
 * testable without a network or a real clock.
 *
 * @param data the response payload
 * @param headers the response headers (any shape, or absent)
 * @param elapsedMs how long the raw call took
 * @returns the observed cost, ready to fold
 */
function observeResponse({
  data,
  headers,
  elapsedMs,
}: {
  data: unknown;
  headers: unknown;
  elapsedMs: number;
}): LinearObservedRequest {
  return { bytes: responseBytes({ data }), latencyMs: elapsedMs, ...parseLinearCost({ headers }) };
}

/** What both request paths below need to do their job, minus the raw call itself. */
interface RequestContext {
  readonly gate: RateScheduler;
  readonly scopeId: string;
  readonly now: () => number;
  readonly observe: ({ observed }: { observed: LinearObservedRequest }) => void;
  /**
   * The server-reported-headroom pacer. It sits INSIDE the request-rate gate, so the two compose as a floor
   * and a ceiling: `p-throttle` guarantees we never burst faster than the derated request rate, and the pacer
   * adds more delay when Linear says a budget is running down. Neither can be bypassed by the other.
   */
  readonly pacer: BudgetPacer;
}

/**
 * The LIVE request: the one read client, behind the door, behind the gate, measured.
 *
 * The nesting order is load-bearing and easy to invert. The door's `execute` holds the gate, which holds the
 * raw call, so a request waits on any shared 429 block FIRST, then acquires this lane's rate slot, then
 * issues exactly one call — and because the gate is inside the retried unit, a retry after a 429 re-acquires
 * a slot instead of firing immediately. The measurement is inside too, so a retried 429 is counted as the
 * two requests it really was rather than the one the caller asked for.
 *
 * The door is written out here AND in {@link injectedRequest} rather than factored into one helper, because
 * `boundary-residue` requires the raw boundary to sit LEXICALLY inside `safeProviderCall`. Hoisting the door
 * into a shared wrapper would still route every call through it, but the gate could no longer see that — and
 * a gate that has to be trusted rather than checked is the thing this repo does not want. Ten duplicated
 * lines is the price of a gate that stays honest.
 */
function liveRequest({ token, ctx }: { token: string; ctx: RequestContext }): LinearRequest {
  // devlint: sdk-factory -- THE single Linear read client; every read lane's requests flow through it
  const client = new LinearClient({ apiKey: token });
  return async ({ query, variables }) =>
    orThrow({
      result: await safeProviderCall({
        execute: () =>
          ctx.gate(async () => {
            await ctx.pacer.waitTurn();
            const startedAt = ctx.now();
            const response = await client.client.rawRequest(query, variables);
            // `rawRequest` is untyped in the SDK, so `headers` crosses into our code unnarrowed and is read
            // only by the defensive pure parsers above, never trusted for its shape here.
            ctx.observe({
              observed: observeResponse({
                data: response.data,
                elapsedMs: ctx.now() - startedAt,
                headers: response.headers,
              }),
            });
            return response.data;
          }),
        operation: "linear.rawRequest",
        provider: "linear",
        retryMode: "transient",
        scopeId: ctx.scopeId,
      }),
    });
}

/**
 * An INJECTED raw seam, given exactly the same treatment as the live one.
 *
 * Gating the injected transport is deliberate rather than incidental: a fake that skipped the door and the
 * gate would test a different program from the one that ships, and an earlier version of this code lost the
 * pacing for injected transports precisely by treating them as the simple case.
 */
function injectedRequest({ raw, ctx }: { raw: LinearRawRequest; ctx: RequestContext }): LinearRequest {
  return async ({ query, variables }) =>
    orThrow({
      result: await safeProviderCall({
        execute: () =>
          ctx.gate(async () => {
            await ctx.pacer.waitTurn();
            const startedAt = ctx.now();
            const response = await raw({ query, variables });
            ctx.observe({
              observed: observeResponse({
                data: response.data,
                elapsedMs: ctx.now() - startedAt,
                headers: response.headers,
              }),
            });
            return response.data;
          }),
        operation: "linear.rawRequest",
        provider: "linear",
        retryMode: "transient",
        scopeId: ctx.scopeId,
      }),
    });
}

/**
 * Build THE Linear read transport: one rate scheduler, one shared-429 door, one observer, one raw seam.
 *
 * @param token the Linear API key (the quota scope)
 * @param raw the injected raw transport (defaults to the live SDK client)
 * @param scheduler an injected rate scheduler (defaults to one paced at {@link LINEAR_RATE_PER_SEC})
 * @param now an injected clock for the latency measure (defaults to `Date.now`)
 * @param pacer an injected budget pacer, which paces against the complexity budget rather than the request
 *   count — the one that actually binds on this API
 * @returns the shared transport
 */
export function makeLinearTransport({
  token,
  raw,
  scheduler,
  pacer,
  now = () => Date.now(),
}: {
  token: string;
  raw?: LinearRawRequest;
  scheduler?: RateScheduler;
  pacer?: BudgetPacer;
  now?: () => number;
}): LinearTransport {
  let stats = ZERO_LINEAR_STATS;
  const budgetPacer = pacer ?? createBudgetPacer({ now });
  const ctx: RequestContext = {
    gate: scheduler ?? createRateScheduler({ ratePerSec: LINEAR_RATE_PER_SEC }),
    now,
    observe: ({ observed }) => {
      stats = foldLinearRequest({ observed, stats });
      if (observed.budgets !== undefined) {
        budgetPacer.observe({ budgets: observed.budgets });
      }
    },
    pacer: budgetPacer,
    scopeId: scopeIdForToken({ token }),
  };
  const request = raw === undefined ? liveRequest({ ctx, token }) : injectedRequest({ ctx, raw });
  return { request, stats: () => stats };
}

/**
 * The process-wide transport cache, keyed by token.
 *
 * A memo rather than a threaded parameter, and that is the deliberate choice. The three Linear lanes run at
 * three different points of the `refresh` shell — activity ingest, then member hydration, then structural
 * hydration — reached through three separate seams with three separate dependency bags. Threading one
 * transport through all of them would make the invariant "every caller remembered to pass it", which is
 * exactly the discipline that failed and produced three schedulers. Keying on the token makes it structural:
 * ask for the transport for a token and you get the one that already holds that token's budget.
 *
 * Keyed by the token itself, not by {@link scopeIdForToken}'s hash: two keys belonging to one Linear user do
 * share a quota, but they are also two different clients, and pretending otherwise would hand one lane a
 * client authenticated as something else.
 */
const TRANSPORTS = new Map<string, LinearTransport>();

/**
 * THE Linear transport for a token — built on first ask, shared by every later one.
 *
 * @param token the Linear API key
 * @returns the process-wide transport for that token
 */
export function sharedLinearTransport({ token }: { token: string }): LinearTransport {
  const existing = TRANSPORTS.get(token);
  if (existing !== undefined) {
    return existing;
  }
  const built = makeLinearTransport({ token });
  TRANSPORTS.set(token, built);
  return built;
}

/**
 * Drop the cached transports. For tests, and for a long-lived process that wants a fresh accounting — never
 * called mid-crawl, since a new transport would start a second scheduler over the same budget.
 */
export function resetSharedLinearTransports(): void {
  TRANSPORTS.clear();
}
