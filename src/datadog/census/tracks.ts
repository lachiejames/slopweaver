/**
 * The two products with NO analytics endpoint at all: database monitoring and profiles.
 *
 * ## Counted from pages, and the row says so
 *
 * Every other product here is counted by its own aggregate over the whole window. Database queries and
 * profiles have none that this organisation's credentials reach — MEASURED,the unified track's
 * `aggregate` sibling answers `{"code":"InvalidArgument"}` for `type=databasequery` on every body shape
 * tried, while `list` answers 200 with an exact `hitCount`. So the shapes here are folded out of bounded
 * PAGES, each row's count is what those pages held, and `countFrom: "page"` is what tells a reader the
 * difference. The window's own total is carried into `notMeasured`, so a reader can see what fraction the
 * pages covered.
 *
 * ## The database product is the highest-disclosure surface in this atlas, and it is stored as PATHS
 *
 * A `databasequery` event carries `db.statement` (the SQL, whose predicates can hold member identifiers),
 * `db.plan.definition`, `network.client.ip` and `db.user`. None is allowlisted, so none is ever stored: a row
 * holds the PATH and the type, which is what makes a query writable, and nothing of the value. The identity
 * is `db.query_signature`, Datadog's own normalised-statement hash, and the members are the TABLE names the
 * event names — the two facts a person actually wants, neither of which is a literal from a query.
 */

import { pushInto } from "#lib/collections.js";
import type { Logger } from "../../lib/logger.js";
import { presentOr } from "../detective/envelope.js";
import { quoteTerm } from "../detective/shape.js";
import type { RawRequester } from "../rawRequest.js";
import type { AbsoluteWindow } from "../window.js";
import type { UnifiedTrack } from "./boundaries.js";
import type { TrackEvent } from "./event.js";
import { trackValue } from "./event.js";
import { foldExemplars } from "./fold.js";
import type { CensusProduct } from "./product.js";
import { type CensusMember, type CensusRow, censusKey, SERVICE_ABSENT, sortCensusRows } from "./row.js";
import type { ProductCensus, ServiceVolume } from "./scope.js";
import { readTrackPage, TRACK_PAGE_LIMIT } from "./unified.js";

/**
 * How many pages of a page-counted product one pass reads.
 *
 * Twenty pages of a thousand events is 20,000 events, about four seconds of the measured 85-per-10-seconds
 * budget, and the measured day held hundreds of thousands of database-query samples whose shapes repeat
 * heavily — 20,000 events produced only hundreds of distinct signatures. It is
 * a ceiling rather than a target, and a pass that reaches it says so in `notMeasured` instead of implying it
 * saw everything.
 */
const PAGE_PASSES = 20;

/** One page-counted product's declaration: where the shape's identity, service and members come from. */
export interface PageProductSpec {
  readonly product: CensusProduct;
  readonly track: UnifiedTrack;
  /** The attribute paths whose first present value is the shape's identity. */
  readonly identityFrom: readonly string[];
  /** The attribute paths whose first present value names the service, instance or host. */
  readonly serviceFrom: readonly string[];
  /** The attribute path holding a list whose entries become the row's members. */
  readonly membersFrom: string | null;
  /** The facet a row's own query filters the identity by. */
  readonly identityFacet: string;
}

/** Both page-counted products, declared once. */
const PAGE_PRODUCTS: readonly PageProductSpec[] = [
  {
    identityFacet: "@db.query_signature",
    identityFrom: ["@db.query_signature", "@postgres.query_signature"],
    membersFrom: "@db.metadata.tables",
    product: "dbm",
    serviceFrom: ["@db.instance", "@database_instance", "service"],
    track: "databasequery",
  },
  {
    identityFacet: "@family",
    identityFrom: ["family", "@family", "@info.runtime.engine"],
    membersFrom: null,
    product: "profiles",
    serviceFrom: ["service", "@info.application.service"],
    track: "profile",
  },
];

/**
 * The first present string at any of a list of paths.
 *
 * @param attributes one event's attribute tree
 * @param paths the paths to try, in priority order
 * @returns the value, or nothing when no path holds one
 */
function firstString({
  attributes,
  paths,
}: {
  attributes: Readonly<Record<string, unknown>>;
  paths: readonly string[];
}): string | null {
  for (const path of paths) {
    const value = trackValue({ attributes, path });
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

/**
 * The member names one event contributes — the entries of its declared list attribute.
 *
 * @param attributes one event's attribute tree
 * @param path the list attribute, or nothing for a product with no members
 * @returns the names, empty when the event carries none
 */
function memberNames({
  attributes,
  path,
}: {
  attributes: Readonly<Record<string, unknown>>;
  path: string | null;
}): readonly string[] {
  if (path === null) {
    return [];
  }
  const value = trackValue({ attributes, path });
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

/** One shape's events and the member names they carried, keyed `service|identity`. */
interface PageGroups {
  readonly events: ReadonlyMap<string, TrackEvent[]>;
  readonly members: ReadonlyMap<string, Map<string, number>>;
}

/**
 * Group a page-counted product's events by the shape each belongs to.
 *
 * @param events every event the pages held
 * @param spec which product these events belong to
 * @returns the events and the member tallies, both keyed the same way
 */
function groupPageEvents({ events, spec }: { events: readonly TrackEvent[]; spec: PageProductSpec }): PageGroups {
  const grouped = new Map<string, TrackEvent[]>();
  const members = new Map<string, Map<string, number>>();
  for (const event of events) {
    const identity = firstString({ attributes: event.attributes, paths: spec.identityFrom });
    const service = firstString({ attributes: event.attributes, paths: spec.serviceFrom });
    const key = `${presentOr({ absent: SERVICE_ABSENT, value: service })}|${presentOr({ absent: "(none)", value: identity })}`;
    pushInto({ buckets: grouped, key, value: event });
    const tally = members.get(key);
    const counts = presentOr({ absent: new Map<string, number>(), value: tally });
    for (const name of memberNames({ attributes: event.attributes, path: spec.membersFrom })) {
      const seen = counts.get(name);
      counts.set(name, seen === undefined ? 1 : seen + 1);
    }
    members.set(key, counts);
  }
  return { events: grouped, members };
}

/**
 * One shape's members, biggest first.
 *
 * @param tally the per-name counts, or nothing for a product with no members
 * @returns the members
 */
function membersOf({ tally }: { tally: Map<string, number> | undefined }): readonly CensusMember[] {
  if (tally === undefined) {
    return [];
  }
  return [...tally.entries()]
    .map(([name, count]) => ({ count, name }))
    .toSorted((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

/**
 * Fold a set of pages into one row per shape.
 *
 * @param events every event the pages held
 * @param spec which product these events belong to
 * @returns the rows, biggest first
 */
export function foldPageProduct({
  events,
  spec,
}: {
  events: readonly TrackEvent[];
  spec: PageProductSpec;
}): readonly CensusRow[] {
  const grouped = groupPageEvents({ events, spec });
  const rows: CensusRow[] = [];
  for (const [key, group] of grouped.events) {
    // Every key is built as `service|identity` in `groupPageEvents`, so both halves are present — read by
    // position rather than by a split, because an identity may itself contain the separator.
    const service = key.slice(0, key.indexOf("|"));
    const identity = key.slice(key.indexOf("|") + 1);
    const clause = service === SERVICE_ABSENT ? "" : `service:${quoteTerm({ value: service })} `;
    rows.push({
      ...foldExemplars({ events: group }),
      count: group.length,
      countFrom: "page",
      identity,
      key: censusKey({ identity, product: spec.product, service }),
      label: identity,
      members: membersOf({ tally: grouped.members.get(key) }),
      membersTruncated: false,
      product: spec.product,
      query: `${clause}${spec.identityFacet}:${quoteTerm({ value: identity })}`,
      service,
    });
  }
  return sortCensusRows({ rows });
}

/**
 * Read up to {@link PAGE_PASSES} pages of one track.
 *
 * @param requester the read-only raw path
 * @param spec which product to read
 * @param window the absolute window
 * @param logger where per-page progress goes
 * @returns the events, the window's own total where the track reported one, and what could not be read
 */
async function readPages({
  requester,
  spec,
  window,
  logger,
}: {
  requester: RawRequester;
  spec: PageProductSpec;
  window: AbsoluteWindow;
  logger: Logger;
}): Promise<{ events: readonly TrackEvent[]; hitCount: number | null; notMeasured: readonly string[] }> {
  const events: TrackEvent[] = [];
  const notMeasured: string[] = [];
  let after: string | null = null;
  let hitCount: number | null = null;
  for (let page = 0; page < PAGE_PASSES; page += 1) {
    const read = await readTrackPage({
      after,
      limit: TRACK_PAGE_LIMIT,
      query: "*",
      requester,
      track: spec.track,
      window,
    });
    if (read.isErr()) {
      notMeasured.push(`${spec.product} page ${String(page + 1)} — not read: ${read.error.join("; ")}`);
      break;
    }
    hitCount = read.value.hitCount;
    events.push(...read.value.events);
    after = read.value.after;
    logger.info({
      msg: `census ${spec.product} page ${String(page + 1)} → ${String(read.value.events.length)} event(s)`,
    });
    if (after === null || read.value.events.length === 0) {
      break;
    }
  }
  return { events, hitCount, notMeasured };
}

/**
 * Build one page-counted product's census.
 *
 * @param requester the read-only raw path
 * @param product which of the two page-counted products to build
 * @param window the absolute window
 * @param logger where per-page progress goes
 * @returns the rows, the services and what the pass could not reach
 */
export async function censusPageProduct({
  requester,
  product,
  window,
  logger,
}: {
  requester: RawRequester;
  product: "dbm" | "profiles";
  window: AbsoluteWindow;
  logger: Logger;
}): Promise<ProductCensus> {
  const spec = PAGE_PRODUCTS.find((one) => one.product === product);
  if (spec === undefined) {
    // Unreachable: the parameter's own type is the two products declared above.
    throw new Error(`no page-product spec for ${product}`);
  }
  const read = await readPages({ logger, requester, spec, window });
  const rows = foldPageProduct({ events: read.events, spec });
  const sampled =
    read.hitCount === null || read.events.length >= read.hitCount
      ? []
      : [
          `${product} shapes are folded from ${String(read.events.length)} of the ${String(read.hitCount)} event(s) in this window — a shape rarer than that sample is absent, and every count on these rows is a floor`,
        ];
  return {
    notMeasured: [...read.notMeasured, ...sampled],
    rows,
    services: serviceVolumes({ rows }),
  };
}

/**
 * How much of a page-counted product each service held, summed off the rows.
 *
 * @param rows the folded rows
 * @returns one entry per service
 */
function serviceVolumes({ rows }: { rows: readonly CensusRow[] }): readonly ServiceVolume[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const seen = totals.get(row.service);
    const count = presentOr({ absent: 0, value: row.count });
    totals.set(row.service, seen === undefined ? count : seen + count);
  }
  return [...totals.entries()].map(([service, events]) => ({ events, service }));
}
