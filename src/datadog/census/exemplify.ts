/**
 * The second phase every product shares: one exemplar page per counted shape, folded into a row.
 *
 * ## Why it is one function rather than one per product
 *
 * The products differ entirely in how they COUNT — a logs aggregate grouped by fingerprint, a spans
 * aggregate grouped by operation and kind, a page of database queries folded locally — and not at all in
 * what they do next: take the shape's own query, ask the unified track for a handful of its events, fold
 * them into paths, types, template and allowlisted facet values, and assemble the row. Written per product
 * it was the same twenty lines six times, and the sixth copy is where a fold stops matching its siblings.
 *
 * The exemplar reads run a few at a time ({@link ./pool}), which is what uses the unified track's measured
 * 85-per-10-seconds budget rather than leaving two thirds of it idle.
 */

import type { Logger } from "../../lib/logger.js";
import type { RawRequester } from "../rawRequest.js";
import type { AbsoluteWindow } from "../window.js";
import type { UnifiedTrack } from "./boundaries.js";
import { foldExemplars } from "./fold.js";
import { CENSUS_CONCURRENCY, mapBounded } from "./pool.js";
import type { CensusProduct } from "./product.js";
import { type CensusMember, type CensusRow, censusKey } from "./row.js";
import { readExemplars } from "./unified.js";

/** How many exemplars one shape is folded from. */
const EXEMPLARS_PER_SHAPE = 3;

/** One shape a product's counting phase found, before anything has been read about what it looks like. */
export interface CountedShape {
  readonly service: string;
  readonly identity: string;
  readonly label: string;
  /** What the product's own aggregate reported, or nothing for a shape that counts no events. */
  readonly count: number | null;
  /** The query that selects exactly this shape's events. */
  readonly query: string;
  readonly members: readonly CensusMember[];
  readonly membersTruncated: boolean;
}

/** The rows one exemplar phase produced, and every shape it could not read an exemplar for. */
export interface ExemplifiedShapes {
  readonly rows: readonly CensusRow[];
  readonly notMeasured: readonly string[];
}

/**
 * Fetch one exemplar page per counted shape and assemble the rows.
 *
 * @param shapes what the counting phase found
 * @param product which product the rows belong to
 * @param track the event track an exemplar comes from
 * @param requester the read-only raw path
 * @param window the absolute window
 * @param logger where progress goes, so a long phase is not a silent one
 * @returns the rows, and one line per shape whose exemplar did not come back
 */
export async function exemplifyShapes({
  shapes,
  product,
  track,
  requester,
  window,
  logger,
}: {
  shapes: readonly CountedShape[];
  product: CensusProduct;
  track: UnifiedTrack;
  requester: RawRequester;
  window: AbsoluteWindow;
  logger: Logger;
}): Promise<ExemplifiedShapes> {
  const notMeasured: string[] = [];
  const rows = await mapBounded({
    items: shapes,
    limit: CENSUS_CONCURRENCY,
    run: async ({ item, index }) => {
      const exemplars = await readExemplars({
        limit: EXEMPLARS_PER_SHAPE,
        logger,
        query: item.query,
        requester,
        track,
        window,
      });
      if (exemplars.missed !== null) {
        notMeasured.push(exemplars.missed);
      }
      if ((index + 1) % 500 === 0) {
        logger.info({ msg: `census ${product} exemplars ${String(index + 1)}/${String(shapes.length)}` });
      }
      const folded = foldExemplars({ events: exemplars.events });
      const row: CensusRow = {
        ...folded,
        count: item.count,
        countFrom: item.count === null ? "none" : "aggregate",
        identity: item.identity,
        key: censusKey({ identity: item.identity, product, service: item.service }),
        label: item.label,
        members: item.members,
        membersTruncated: item.membersTruncated,
        product,
        query: item.query,
        service: item.service,
      };
      return row;
    },
  });
  return { notMeasured, rows };
}
