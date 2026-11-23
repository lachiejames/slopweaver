/**
 * The live channel's wire contracts and pure transformations: the route's answer shape and its guard, one fetch's
 * arrival, the channel key and route for a slug, and the turn of an arrival into a tile's state.
 */
import { type LiveState } from "../../lib/liveState";

/** The wire shape `app/api/live/[verb]/route.ts` answers with. */
export interface WireResult {
  readonly ok: boolean;
  readonly observedAtIso: string;
  readonly stampedByRoute?: boolean;
  readonly fixture?: string;
  readonly notMeasured?: string;
  readonly payload?: unknown;
}

/**
 * Narrow a parsed response body to the wire shape, refusing anything else.
 *
 * Written as a guard rather than an assertion on purpose: `response.json()` answers `any`, so a cast here
 * would let a route that changed shape flow into the tile as if it had not. The two fields every outcome
 * carries are the ones checked; the optional three are read only after `ok` has decided which arm this is.
 *
 * @param body whatever the route's JSON parsed to
 * @returns the wire result, or `undefined` when the body is not one
 */
export function wireOf({ body }: { body: unknown }): WireResult | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const held = body as Partial<Record<keyof WireResult, unknown>>;
  if (typeof held.ok !== "boolean" || typeof held.observedAtIso !== "string") {
    return undefined;
  }
  return {
    fixture: typeof held.fixture === "string" ? held.fixture : undefined,
    notMeasured: typeof held.notMeasured === "string" ? held.notMeasured : undefined,
    observedAtIso: held.observedAtIso,
    ok: held.ok,
    payload: held.payload,
    stampedByRoute: held.stampedByRoute === true,
  };
}

/**
 * What one fetch of a verb came to: its wire result, or the reason the fetch itself failed — and whether that
 * failure was the server's rather than the page's, so the read is owed again (`site/lib/liveRetry.ts`).
 */
export type Arrival =
  | { readonly kind: "wire"; readonly wire: WireResult }
  | { readonly kind: "failed"; readonly why: string; readonly retry: boolean };

/**
 * What a channel holds for a mount: its latest arrival, and the latest one that answered when that is an earlier one
 * — so a mount over a failed read draws the last reading, marked stale, rather than the failure alone.
 */
export interface Held {
  readonly last: Arrival;
  readonly answered: Arrival | undefined;
}

/** One component's hold on a channel: handed each arrival, and whether a read under way will replace it. */
export type Subscriber = (delivery: { readonly arrival: Arrival; readonly provisional: boolean }) => void;

/**
 * The live route for a channel key, which is `<slug>|<fixture>`.
 *
 * @param key the channel's key
 * @returns the route
 */
export function urlOfKey({ key }: { key: string }): string {
  const bar = key.indexOf("|");
  const fixture = key.slice(bar + 1);
  return urlOf({ fixture: fixture === "" ? undefined : fixture, slug: key.slice(0, bar) });
}

/**
 * The channel key for a slug and fixture: one channel per pair, so a fixture page and a live page never
 * share an arrival.
 *
 * @returns the key
 */
export function keyOf({ slug, fixture }: { slug: string; fixture: string | undefined }): string {
  if (fixture === undefined) {
    return `${slug}|`;
  }
  return `${slug}|${fixture}`;
}

/**
 * The live route for a slug, with the fixture query when one is named.
 *
 * @returns the URL
 */
export function urlOf({ slug, fixture }: { slug: string; fixture: string | undefined }): string {
  if (fixture === undefined) {
    return `/api/live/${slug}`;
  }
  return `/api/live/${slug}?fixture=${encodeURIComponent(fixture)}`;
}

/**
 * Turn an arrival into a tile's state, through the tile's own reader.
 *
 * @returns the state
 */
export function stateOf<T>({
  arrival,
  slug,
  read,
  provisional,
}: {
  arrival: Arrival;
  slug: string;
  read: (payload: unknown) => T | undefined;
  /** True for an arrival handed over on mount, which a read already under way will replace. */
  provisional: boolean;
}): LiveState<T> {
  if (arrival.kind === "failed") {
    if (arrival.retry) {
      return { phase: "not-measured", why: `${arrival.why} (the console server did not answer; reading again)` };
    }
    return { phase: "not-measured", why: arrival.why };
  }
  const wire = arrival.wire;
  if (!wire.ok) {
    // `notMeasured` is optional on the wire, so the absent case is NAMED rather than coalesced: a route
    // that failed without saying why is a different fact from one that gave a reason.
    let why = `${slug} could not be read, and gave no reason`;
    if (wire.notMeasured !== undefined) {
      why = wire.notMeasured;
    }
    return { phase: "not-measured", why };
  }
  const value = read(wire.payload);
  if (value === undefined) {
    return { phase: "not-measured", why: `${slug} answered in a shape this tile does not read` };
  }
  const ready: Extract<LiveState<T>, { phase: "ready" }> = {
    fixture: wire.fixture,
    observedAtIso: wire.observedAtIso,
    phase: "ready",
    stampedByRoute: wire.stampedByRoute === true,
    value,
  };
  if (provisional) {
    return { ...ready, refreshing: true };
  }
  return ready;
}
