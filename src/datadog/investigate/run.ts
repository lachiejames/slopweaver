/**
 * The investigation engine: one query, counted first, then narrowed, then read. The effectful edge.
 *
 * A "count" here is what Datadog reported, and for `apm` that is a SAMPLED indexed-span figure — a lower
 * bound, not a population. Every result carries the label saying which, and the audit of whether its groups
 * partition its total, both judged by the pure `./counts.ts`.
 *
 * ## Every product's TOTAL comes from the same place
 *
 * The unified event track answers `hitCount` for any query on any product, in one request, at the measured
 * 85-per-10-seconds budget. So the total is read there rather than from each product's own analytics
 * endpoint: it is one call for every verb instead of five different shapes, and it works for the two
 * products (database queries, profiles) whose analytics endpoint this organisation cannot reach at all.
 *
 * The GROUPS still come from the product's own aggregate where one exists, because only that endpoint counts
 * a facet over the whole window — folding a page would report what the page held and call it the estate.
 * Where none exists the groups are folded from a bounded page and the report says so, in the same words the
 * census uses for the same reason.
 */

import type { Logger } from "../../lib/logger.js";
import { err, ok, type Result } from "../../lib/result.js";
import { ciPipelineGroups, ciTestGroups, type ProductBuckets, rumGroups, spanGroups } from "../census/aggregate.js";
import { type TrackEvent, trackString, trackValue } from "../census/event.js";
import { readTrackPage, TRACK_PAGE_LIMIT } from "../census/unified.js";
import type { DatadogClient } from "../client.js";
import type { PartitionAudit } from "../counting.js";
import type { Catalogue } from "../detective/catalogue.js";
import { presentOr } from "../detective/envelope.js";
import type { CountLabel } from "../domain.js";
import { runMultiGroupedLogsAggregate } from "../groupedAggregate.js";
import type { RawRequester } from "../rawRequest.js";
import type { AbsoluteWindow } from "../window.js";
import { investigationCountFacts } from "./counts.js";
import { type InvestigateProduct, investigateSpec } from "./spec.js";

/** How many groups one investigation asks for per facet. Small: this is a report a person reads. */
const GROUP_LIMIT = 20;

/** What one investigation was asked for. */
export interface InvestigateRequest {
  readonly product: InvestigateProduct;
  /** The Datadog query, in the product's own search syntax. */
  readonly query: string;
  readonly window: AbsoluteWindow;
  /** The facets to group by, or nothing to take the product's own defaults. */
  readonly facets: readonly string[];
  /** Clauses to EXCLUDE — the noise filter, each negated into the query. */
  readonly excludes: readonly string[];
  /** How many events to print, or zero for counts only. */
  readonly rows: number;
}

/** One counted group. */
export interface InvestigateGroup {
  readonly by: Readonly<Record<string, string>>;
  readonly count: number;
  /** What the census calls this group, when it holds a row for it. */
  readonly label: string | null;
}

/** One event, projected to what a report prints. */
export interface InvestigateRow {
  readonly occurredAtIso: string;
  readonly service: string;
  readonly status: string;
  readonly text: string;
}

/** What one investigation produced. */
export interface InvestigateResult {
  readonly product: InvestigateProduct;
  /** The query as it was actually issued, exclusions included, so a reader can paste it. */
  readonly query: string;
  readonly window: AbsoluteWindow;
  /** How many events the track reported matching, or nothing when it could not say. */
  readonly total: number | null;
  /** How `total` may be stated: a plain count, or a sampled lower bound with the caveats that say why. */
  readonly countLabel: CountLabel;
  /** Whether the groups partition `total`, or nothing when the comparison would mislead (see `./counts.ts`). */
  readonly partition: PartitionAudit | null;
  /** Where to corroborate a sampled `total` before it sizes anything, or nothing when it is a plain count. */
  readonly corroborate: string | null;
  readonly groups: readonly InvestigateGroup[];
  readonly groupedBy: readonly string[];
  /** Whether the grouping reached its own limit, so rarer groups exist. */
  readonly truncated: boolean;
  /** Whether the groups were folded from a bounded page rather than counted over the window. */
  readonly groupsFromPage: boolean;
  readonly rows: readonly InvestigateRow[];
  /** One line per thing this investigation could not read. */
  readonly notes: readonly string[];
}

/**
 * The query one investigation issues, with every exclusion negated onto it.
 *
 * @param query what the caller asked for
 * @param excludes the clauses to cut out
 * @returns the query as issued
 */
export function issuedQuery({ query, excludes }: { query: string; excludes: readonly string[] }): string {
  const asked = query.trim().length === 0 ? "*" : query.trim();
  return [asked, ...excludes.map((clause) => `-(${clause})`)].join(" ");
}

/**
 * Read one product's grouped counts from whichever analytics endpoint answers for it.
 *
 * @param client the shared client
 * @param product which product
 * @param query the query as issued
 * @param facets the facets to group by
 * @param window the absolute window
 * @returns the buckets, or the reason the product's endpoint could not be asked
 */
async function groupsFor({
  client,
  product,
  query,
  facets,
  window,
}: {
  client: DatadogClient;
  product: InvestigateProduct;
  query: string;
  facets: readonly string[];
  window: AbsoluteWindow;
}): Promise<Result<ProductBuckets>> {
  const spec = investigateSpec({ product });
  const asked = facets.map((facet) => ({ facet, limit: GROUP_LIMIT }));
  if (spec.countedBy === "spans") {
    return spanGroups({ client, facets: asked, query, window });
  }
  if (spec.countedBy === "rum") {
    return rumGroups({ client, facets: asked, query, window });
  }
  if (spec.countedBy === "ci-pipelines") {
    return ciPipelineGroups({ client, facets: asked, query, window });
  }
  if (spec.countedBy === "ci-tests") {
    return ciTestGroups({ client, facets: asked, query, window });
  }
  if (spec.countedBy === "logs") {
    const aggregate = await runMultiGroupedLogsAggregate({ client, facets, limit: GROUP_LIMIT, query, window });
    if (aggregate.isErr()) {
      return err(aggregate.error);
    }
    return ok({
      buckets: aggregate.value.buckets.map((bucket) => ({ by: definedOnly({ by: bucket.by }), count: bucket.count })),
      // The logs aggregate omits `traffic_type`: logs are unsampled here.
      trafficType: null,
      truncated: aggregate.value.truncated,
    });
  }
  return err(["this product has no analytics endpoint this organisation can reach"]);
}

/**
 * Drop the facets a bucket did not carry, so a group never claims a value of `null`.
 *
 * @param by the bucket's own facet values
 * @returns the facets that had a value
 */
function definedOnly({ by }: { by: Readonly<Record<string, string | null>> }): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [facet, value] of Object.entries(by)) {
    if (value !== null) {
      out[facet] = value;
    }
  }
  return out;
}

/**
 * Fold a bounded page into groups, for a product whose analytics endpoint cannot be reached.
 *
 * @param events the page's events
 * @param facets the facets to group by
 * @returns the groups, biggest first
 */
export function foldPageGroups({
  events,
  facets,
}: {
  events: readonly TrackEvent[];
  facets: readonly string[];
}): readonly InvestigateGroup[] {
  const counts = new Map<string, { by: Record<string, string>; count: number }>();
  for (const event of events) {
    const by: Record<string, string> = {};
    for (const facet of facets) {
      const value = trackValue({ attributes: event.attributes, path: facet });
      if (typeof value === "string" && value.length > 0) {
        by[facet] = value;
      }
    }
    const key = JSON.stringify(by);
    const seen = counts.get(key);
    if (seen === undefined) {
      counts.set(key, { by, count: 1 });
      continue;
    }
    seen.count += 1;
  }
  return [...counts.values()]
    .map((group) => ({ by: group.by, count: group.count, label: null }))
    .toSorted((left, right) => right.count - left.count);
}

/**
 * What the census calls one group, when it holds a row whose identity the group names.
 *
 * This is the join that makes a count legible: a logs group keyed on a fingerprint is a hex string until the
 * census supplies the message template that fingerprint stands for.
 *
 * @param catalogue the built census, or nothing when none has been built
 * @param product which product's rows to look in
 * @param identity the value the group is keyed on
 * @returns the label, or nothing when the census has no row for it
 */
export function labelFor({
  catalogue,
  product,
  identity,
}: {
  catalogue: Catalogue | null;
  product: InvestigateProduct;
  identity: string | undefined;
}): string | null {
  if (catalogue === null || identity === undefined) {
    return null;
  }
  const census = investigateSpec({ product }).census;
  if (census === null) {
    return null;
  }
  const row = catalogue.rows.find((one) => one.product === census && one.identity === identity);
  if (row === undefined) {
    return null;
  }
  return row.label;
}

/**
 * Project one track event onto what a report prints.
 *
 * The TEXT is the event's message where it has one, and its own identity where it does not — a span prints
 * its resource, a database query prints its signature and never its statement, which is the same disclosure
 * rule the census row follows.
 *
 * @param event one event from the track
 * @returns the row
 */
export function rowOf({ event }: { event: TrackEvent }): InvestigateRow {
  const service = trackString({ attributes: event.attributes, path: "service" });
  const status = trackString({ attributes: event.attributes, path: "status" });
  const message = event.message;
  const resource = trackString({ attributes: event.attributes, path: "resource_name" });
  const signature = trackString({ attributes: event.attributes, path: "@db.query_signature" });
  let text = "(no message)";
  if (signature !== null) {
    text = `query signature ${signature}`;
  }
  if (resource !== null) {
    text = resource;
  }
  if (message !== null) {
    text = message;
  }
  return {
    occurredAtIso: event.occurredAtIso,
    service: printedService({ service }),
    status: presentOr({ absent: "(none)", value: status }),
    text,
  };
}

/**
 * The service column of one printed row.
 *
 * Datadog tags an event with the reserved `service` attribute only when its emitter declared one — the census
 * counts the untagged bucket as `-service:*` — and a CI pipeline event names itself under `@ci.*` instead, so
 * such a row prints a marker rather than a blank column.
 */
function printedService({ service }: { service: string | null }): string {
  if (service === null) {
    return "(none)";
  }
  return service;
}

/**
 * Run one investigation: the total, the groups, and the rows when the caller asked for them.
 *
 * @param client the shared client, for the analytics endpoints
 * @param requester the read-only raw path, for the track
 * @param request what the caller asked for
 * @param catalogue the built census, which labels the groups, or nothing when none has been built
 * @param logger where a rate-limit wait is announced
 * @returns the result
 */
export async function investigate({
  client,
  requester,
  request,
  catalogue,
  logger,
}: {
  client: DatadogClient;
  requester: RawRequester;
  request: InvestigateRequest;
  catalogue: Catalogue | null;
  logger: Logger;
}): Promise<InvestigateResult> {
  const spec = investigateSpec({ product: request.product });
  const facets = request.facets.length === 0 ? spec.defaultFacets : request.facets;
  const query = issuedQuery({ excludes: request.excludes, query: request.query });
  const notes: string[] = [];
  // A product with no analytics endpoint folds its groups out of THIS page, so it asks for a full one; a
  // product that has one only needs the events the caller asked to read, plus the hitCount every page carries.
  const pageLimit = spec.countedBy === "track" ? TRACK_PAGE_LIMIT : Math.max(request.rows, 1);
  const head = await readTrackPage({
    limit: pageLimit,
    query,
    requester,
    track: spec.track,
    window: request.window,
  });
  if (head.isErr()) {
    notes.push(`the ${spec.track} track — not read: ${head.error.join("; ")}`);
  }
  const counted = await countGroups({ catalogue, client, facets, head, notes, query, request, window: request.window });
  logger.debug({ msg: `investigate ${request.product}: ${String(counted.groups.length)} group(s)` });
  const total = head.isErr() ? null : head.value.hitCount;
  const facts = investigationCountFacts({ ...counted, groupedBy: facets, product: request.product, total });
  return {
    corroborate: facts.corroborate,
    countLabel: facts.countLabel,
    groupedBy: facets,
    groups: counted.groups,
    groupsFromPage: counted.groupsFromPage,
    notes,
    partition: facts.partition,
    product: request.product,
    query,
    rows:
      head.isErr() || request.rows === 0
        ? []
        : head.value.events.slice(0, request.rows).map((event) => rowOf({ event })),
    total,
    truncated: counted.truncated,
    window: request.window,
  };
}

/** What the groups half found, carrying everything `investigationCountFacts` judges the groups by. */
interface CountedGroups {
  readonly groups: readonly InvestigateGroup[];
  readonly truncated: boolean;
  readonly groupsFromPage: boolean;
  /** Whether the product's own aggregate came back — false for a page fold and for a failed call. */
  readonly aggregateRead: boolean;
  /** The `traffic_type` that aggregate declared, or nothing when none was read or none declared. */
  readonly trafficType: string | null;
}

/**
 * The groups half: the product's own aggregate, or a fold of the page when it has none.
 *
 * @param head the track page already read, which doubles as the fold's input
 * @param notes where a failed aggregate is stated
 * @returns the groups, how they were obtained, and the `traffic_type` the aggregate declared
 */
async function countGroups({
  client,
  request,
  facets,
  query,
  window,
  head,
  catalogue,
  notes,
}: {
  client: DatadogClient;
  request: InvestigateRequest;
  facets: readonly string[];
  query: string;
  window: AbsoluteWindow;
  head: Awaited<ReturnType<typeof readTrackPage>>;
  catalogue: Catalogue | null;
  notes: string[];
}): Promise<CountedGroups> {
  const spec = investigateSpec({ product: request.product });
  const labelled = ({ groups }: { groups: readonly InvestigateGroup[] }): readonly InvestigateGroup[] =>
    groups.map((group) => ({
      ...group,
      label: labelFor({
        catalogue,
        identity: spec.shapeFacet === null ? undefined : group.by[spec.shapeFacet],
        product: request.product,
      }),
    }));
  if (spec.countedBy === "track") {
    if (head.isErr()) {
      return { aggregateRead: false, groups: [], groupsFromPage: true, trafficType: null, truncated: false };
    }
    notes.push(
      `${request.product} has no analytics endpoint this organisation can reach, so these groups are folded from ${String(head.value.events.length)} event(s) of the page — every count here is a floor`,
    );
    return {
      aggregateRead: false,
      groups: labelled({ groups: foldPageGroups({ events: head.value.events, facets }) }),
      groupsFromPage: true,
      trafficType: null,
      truncated: false,
    };
  }
  const grouped = await groupsFor({ client, facets, product: request.product, query, window });
  if (grouped.isErr()) {
    notes.push(`the ${request.product} counts — not read: ${grouped.error.join("; ")}`);
    return { aggregateRead: false, groups: [], groupsFromPage: false, trafficType: null, truncated: false };
  }
  return {
    aggregateRead: true,
    groups: labelled({
      groups: grouped.value.buckets.map((bucket) => ({ by: bucket.by, count: bucket.count, label: null })),
    }),
    groupsFromPage: false,
    trafficType: grouped.value.trafficType,
    truncated: grouped.value.truncated,
  };
}
