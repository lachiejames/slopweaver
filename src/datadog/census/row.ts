/**
 * What one census row IS — the thing the atlas stores instead of an event. Pure.
 *
 * ## A row is a COUNT plus a SHAPE, and the two come from different places
 *
 * `count` is what the product's own analytics endpoint reported over the window: an exact aggregate, not a
 * sample multiplied up. `paths`, `facets` and `template` come from a handful of exemplar events fetched for
 * that one shape. Keeping the two separate is the same rule the sampling catalogue stated and could not
 * honour — it only ever had a sample — and it is why `countFrom` is a field: a product with no analytics
 * endpoint (database queries, profiles) is counted from the page the exemplars came out of, and a reader
 * has to be able to tell those apart.
 *
 * ## What a row never holds
 *
 * No message, no user, no email, no token, no IP, no session id, no stack, and for a database query no
 * statement text, no plan and no bind values. Values reach a row only through
 * {@link ../detective/facets.FACET_ALLOWLIST} and only under its cap. The reason is unchanged from the
 * catalogue this replaces: a row is kept forever and an event is kept for about fifteen days, so a row
 * carrying event data is a retention decision nobody made.
 */

import type { LeafPath } from "../detective/attributes.js";
import type { FacetValues } from "../detective/facets.js";
import type { CensusProduct } from "./product.js";

/** One thing that sits UNDER a row — a span's resources, a pipeline's jobs, a metric's tag keys. */
export interface CensusMember {
  readonly name: string;
  /** How many events (or values) carried it, from the same aggregate the row's own count came from. */
  readonly count: number;
}

/**
 * Where a row's count came from, which decides how much it claims.
 *
 * `aggregate` is the product's own analytics endpoint over the whole window — exact. `page` is what the
 * exemplar pages themselves held, for a product with no analytics endpoint at all, and it is a FLOOR rather
 * than a total. `none` is a shape that has no event count in the first place: a metric is a name this
 * organisation can query, not a thing that happened, and inventing a zero for it would read as a metric
 * nobody emits.
 */
type CensusCountFrom = "aggregate" | "page" | "none";

/** One catalogued shape — the row that is stored, and the only thing that is. */
export interface CensusRow {
  readonly key: string;
  readonly product: CensusProduct;
  /** The service, application or instance the shape belongs to, or `(none)` when the product names none. */
  readonly service: string;
  /** What this product discriminates shapes by — a fingerprint, an operation, a query signature. */
  readonly identity: string;
  /** The identity in the words a person reads: a message template, `postgresql.query (client)`, a view group. */
  readonly label: string;
  /** How many events the window held, or nothing for a shape that counts no events at all. */
  readonly count: number | null;
  readonly countFrom: CensusCountFrom;
  /** Every environment the exemplars carried, which is a sample of the shape rather than of the window. */
  readonly envs: readonly string[];
  /** Every status the exemplars carried. */
  readonly statuses: readonly string[];
  /** The message template, per-event values already replaced, or nothing for a product with no message. */
  readonly template: string | null;
  /** Every attribute path the exemplars carried, in Datadog's own search spelling, with the types seen at it. */
  readonly paths: readonly LeafPath[];
  /** The allowlisted facets' values, or the reason a facet kept none. */
  readonly facets: readonly FacetValues[];
  /** What sits under this shape, counted — resources, jobs, test names, tag keys. */
  readonly members: readonly CensusMember[];
  /** Whether the member list reached the limit the request asked for, so more exist than are named. */
  readonly membersTruncated: boolean;
  /** How many exemplar events the paths were folded from. `0` means counted but never exemplified. */
  readonly exemplars: number;
  /** The earliest instant an exemplar was seen at, or nothing when none was fetched. */
  readonly firstSeenIso: string | null;
  /** The latest instant an exemplar was seen at, or nothing when none was fetched. */
  readonly lastSeenIso: string | null;
  /** The Datadog query that returns this shape's own events, ready to paste into the Explorer. */
  readonly query: string;
}

/** What a row's service reads as when the product attributes the shape to none. */
export const SERVICE_ABSENT = "(none)";

/**
 * The key one row is stored under — unique across a whole census.
 *
 * Product first, then service, then identity: a reader scanning the file sees the products grouped, and two
 * services emitting the same log pattern stay two rows, because the count and the query differ.
 *
 * @param identity what the product discriminates by
 * @returns the key
 */
export function censusKey({
  product,
  service,
  identity,
}: {
  product: CensusProduct;
  service: string;
  identity: string;
}): string {
  return `${product}|${service}|${identity}`;
}

/**
 * Order rows the way every reader wants them: biggest first, ties broken by key so two runs agree.
 *
 * @param rows the rows to order
 * @returns the same rows, sorted
 */
export function sortCensusRows({ rows }: { rows: readonly CensusRow[] }): readonly CensusRow[] {
  const size = (row: CensusRow): number => {
    if (row.count === null) {
      return -1;
    }
    return row.count;
  };
  return [...rows].toSorted((left, right) => size(right) - size(left) || left.key.localeCompare(right.key));
}
