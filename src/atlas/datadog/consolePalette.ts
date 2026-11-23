/**
 * What the command palette's own entity list comes to, and the one value of it that is ever kept.
 *
 * `POST /api/ui/search/suggestions/entities` is session-authenticated and answers 401 to API keys, so the
 * palette arm is the only way to read it at all — and what it holds is this organisation's dashboards,
 * monitors, users and teams BY NAME. The entities of this atlas are operations, so a name has nothing here
 * to corroborate and no row to sit in. What this module keeps instead is a COUNT per entity kind, plus the
 * console ADDRESSES its `page` entries carry, which are the one thing the left-nav denominator can be
 * checked against. A person's name reaches disk nowhere on this path.
 *
 * The body's shape was measured only for its byte size, never its structure — so the reduction looks for its
 * list under a few plausible paths and reports the field names that defeated it rather than throwing. A walk
 * must publish its pages whatever the palette answered.
 */
import { isRecord } from "../../lib/parsers.js";

import { canonicalNavHref, DATADOG_CONSOLE_ROUTES, isConsolePageHref } from "./consolePages.js";
import type { DatadogWalkResult } from "./consoleWalk.js";

/**
 * One entity kind the palette listed, and how many of it. Never a name.
 * @internal a field type of {@link DatadogPaletteSummary}
 */
export interface DatadogPaletteBucket {
  readonly bucket: string;
  readonly count: number;
}

/**
 * What the palette body listed, reduced to counts, or why it could not be read that way.
 * @internal a field type of {@link import("./consoleSurface.js").DatadogConsoleOutcome}
 */
export interface DatadogPaletteSummary {
  readonly filterNames: readonly string[];
  readonly optionCount: number;
  /** `true` when the suggestions body was captured and its list found; `buckets` is empty otherwise. */
  readonly bodyRead: boolean;
  readonly buckets: readonly DatadogPaletteBucket[];
  /** The body's top-level field names when its list could not be found, so the next reader knows its shape. */
  readonly unreadShape: readonly string[];
  /** Console addresses the palette's `page` entries carry that the declared nav list does not, sorted. */
  readonly pagesUndeclared: readonly string[];
  /** How many `page` entries carried an address at all. */
  readonly pageCount: number;
}

/** The path the palette's entity list answers on. */
const PALETTE_ENTITIES_PATH = "/api/ui/search/suggestions/entities";

/** Where the list of entities sits: MEASURED, `data.attributes.entities` on this install's site. */
const LIST_PATHS: readonly (readonly string[])[] = [
  ["data", "attributes", "entities"],
  ["entities"],
  ["data"],
  ["results"],
  ["suggestions"],
];

/** The palette bucket whose entries are console pages: MEASURED, `type: "page"`; the walk counts them as `pageCount`. */
const PALETTE_PAGE_BUCKET = "page";

/** Field names an entity's kind has been seen under, tried in order. */
const KIND_FIELDS = ["type", "entity_type", "entityType", "kind", "resource_type", "resourceType", "category"] as const;

/**
 * Which field the list's entries carry their KIND under, or `null` when none of the known names fits.
 *
 * @param list the entity list found in the body
 * @returns the field name, or `null`
 */
function kindFieldOf({ list }: { list: readonly unknown[] }): string | null {
  const first = list.find((entry) => isRecord(entry));
  const found = KIND_FIELDS.find((field) => isRecord(first) && typeof first[field] === "string");
  if (found === undefined) {
    return null;
  }
  return found;
}

/** The value at one path into a record, or `undefined` when any step is missing. */
function valueAt({ body, path }: { body: unknown; path: readonly string[] }): unknown {
  let current: unknown = body;
  for (const step of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[step];
  }
  return current;
}

/** The entity list the body carries, or `null` with the top-level field names that defeated the search. */
function entityListOf({ body }: { body: unknown }): { list: readonly unknown[] | null; shape: readonly string[] } {
  if (!isRecord(body)) {
    return { list: null, shape: [] };
  }
  const found = LIST_PATHS.map((path) => valueAt({ body, path })).find((value) => Array.isArray(value));
  if (!Array.isArray(found)) {
    return { list: null, shape: Object.keys(body).toSorted() };
  }
  return { list: found, shape: [] };
}

/** What one pass over the entity list counted. */
interface PaletteTally {
  readonly bodyRead: boolean;
  readonly buckets: readonly DatadogPaletteBucket[];
  readonly pageHrefs: readonly string[];
  readonly unreadShape: readonly string[];
}

/**
 * Reduce the palette's entity body to a count per entity kind, plus its `page` entries' own addresses.
 *
 * @param body the parsed response body
 * @returns the counts, or an empty tally carrying the shape that defeated the reduction
 */
export function paletteBuckets({ body }: { body: unknown }): PaletteTally {
  const found = entityListOf({ body });
  if (found.list === null) {
    return { bodyRead: false, buckets: [], pageHrefs: [], unreadShape: found.shape };
  }
  const kindField = kindFieldOf({ list: found.list });
  if (kindField === null) {
    // The list was found and its entries carry no kind under a name this knows: report THEIR field names,
    // so the next reader can add the right one rather than rediscover the shape.
    const first = found.list.find((entry) => isRecord(entry));
    return {
      bodyRead: false,
      buckets: [],
      pageHrefs: [],
      unreadShape: isRecord(first) ? Object.keys(first).toSorted() : [],
    };
  }
  return tallyEntities({ kindField, list: found.list });
}

/**
 * Count one entity list by kind, keeping a `page` entry's address and nothing else.
 *
 * @param list the entity list
 * @param kindField the field its entries carry their kind under
 * @returns the tally
 */
function tallyEntities({ list, kindField }: { list: readonly unknown[]; kindField: string }): PaletteTally {
  const counts = new Map<string, number>();
  const pageHrefs = new Set<string>();
  for (const entry of list) {
    const record = isRecord(entry) ? entry : {};
    const kind = record[kindField];
    const bucket = typeof kind === "string" ? kind : "(untyped)";
    const held = counts.get(bucket);
    counts.set(bucket, held === undefined ? 1 : held + 1);
    // A `page` entry's `url` is a console ADDRESS, not a name — the one value this reduction keeps, and only
    // for that bucket: a dashboard's url carries its id and a user's carries nothing a page list wants.
    if (bucket === PALETTE_PAGE_BUCKET && typeof record["url"] === "string") {
      pageHrefs.add(canonicalNavHref({ href: record["url"] }));
    }
  }
  return {
    bodyRead: true,
    buckets: [...counts.entries()]
      .map(([bucket, count]) => ({ bucket, count }))
      .toSorted((left, right) => left.bucket.localeCompare(right.bucket)),
    pageHrefs: [...pageHrefs].toSorted(),
    unreadShape: [],
  };
}

/**
 * The palette summary for one walk, or `null` when the palette leg did not open.
 *
 * @param walk what the walk produced
 * @returns the summary, or `null`
 *
 * @internal
 */
export function paletteSummary({ walk }: { walk: DatadogWalkResult }): DatadogPaletteSummary | null {
  const observed = walk.palette;
  if (observed === null) {
    return null;
  }
  const entities = observed.responses.find((response) => {
    try {
      return new URL(response.url).pathname === PALETTE_ENTITIES_PATH;
    } catch {
      return false;
    }
  });
  const reduced = paletteBuckets({ body: entities === undefined ? null : entities.body });
  const declared = new Set(DATADOG_CONSOLE_ROUTES.map((route) => route.href));
  return {
    bodyRead: reduced.bodyRead,
    buckets: reduced.buckets,
    filterNames: observed.filterNames,
    optionCount: observed.optionCount,
    pageCount: reduced.pageHrefs.length,
    pagesUndeclared: reduced.pageHrefs.filter((href) => isConsolePageHref({ href }) && !declared.has(href)),
    unreadShape: reduced.unreadShape,
  };
}

/**
 * What the palette came to, as one clause of the `console-request` cell's reason.
 *
 * @param palette the summary, or `null` when the leg did not run
 * @returns the clause
 *
 * @internal
 */
export function paletteLine({ palette }: { palette: DatadogPaletteSummary | null }): string {
  if (palette === null) {
    return "the palette was not opened";
  }
  const listed = palette.bodyRead
    ? `lists ${palette.buckets.map((bucket) => `${bucket.bucket}×${String(bucket.count)}`).join(", ")}`
    : `was not reduced (top-level fields: ${palette.unreadShape.join(", ")})`;
  return `the palette offered ${String(palette.filterNames.length)} entity filter(s) and ${String(palette.optionCount)} suggestion(s); its entity body ${listed}`;
}
