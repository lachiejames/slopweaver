/**
 * Building one census: the service map, then every product's own pass, then the stated residue.
 *
 * The orchestration is here and every decision is elsewhere — {@link ./logs}, {@link ./spans}, {@link ./rum},
 * {@link ./ci}, {@link ./tracks} and {@link ./metrics} each own one product, and {@link ../detective/map}
 * owns the service map. What this file owns is the ORDER and the honesty: which products ran, how many rows
 * each produced, how many of those rows nothing could be exemplified for, and everything that was not
 * reached.
 *
 * ## Products run in the order that fails cheapest
 *
 * The map first, because it is what says whether the credentials work at all; then the products whose
 * budgets are generous (RUM, CI, the page-counted tracks); then spans, whose 5-per-60-seconds budget makes
 * it the slowest per service; then logs, which is the longest pass by an order of magnitude; then metrics.
 * A pass killed halfway therefore leaves the widest coverage it could have, and `--product` re-runs one.
 */

import type { Logger } from "../../lib/logger.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { DatadogClient } from "../client.js";
import {
  CATALOGUE_SCHEMA_VERSION,
  type Catalogue,
  type ProductTally,
  type ServiceVolume,
  shortestRetentionDays,
} from "../detective/catalogue.js";
import { type DatadogDetectiveError, DatadogDetectiveErrors } from "../detective/errors.js";
import { readServiceMap } from "../detective/map.js";
import type { RawRequester } from "../rawRequest.js";
import type { AbsoluteWindow } from "../window.js";
import { censusCiPipelines, censusCiTests } from "./ci.js";
import { censusLogs } from "./logs.js";
import { censusMetrics } from "./metrics.js";
import { CENSUS_PRODUCTS, type CensusProduct } from "./product.js";
import type { CensusRow } from "./row.js";
import { censusRum } from "./rum.js";
import type { ProductCensus } from "./scope.js";
import { censusSpans } from "./spans.js";
import { censusPageProduct } from "./tracks.js";

/** What one census pass was asked for. */
export interface CensusRequest {
  readonly window: AbsoluteWindow;
  /** Which products to run. Defaults to every one of them, which is the owner's "everything is in scope". */
  readonly products: readonly CensusProduct[];
}

/** What a pass produced, beside the catalogue itself. */
export interface CensusReport {
  readonly catalogue: Catalogue;
  /** How many track and aggregate calls the pass made, as each product reported them. */
  readonly rows: number;
}

/**
 * The order products run in — the reasoning is in this file's header.
 *
 * Declared rather than derived from {@link CENSUS_PRODUCTS} so the list a reader sees in a report (which is
 * the declaration order) stays independent of the order a pass happens to be cheapest in.
 */
const CENSUS_RUN_ORDER: readonly CensusProduct[] = [
  "rum",
  "ci-pipelines",
  "ci-tests",
  "dbm",
  "profiles",
  "spans",
  "logs",
  "metrics",
];

/**
 * Run one product's pass.
 *
 * @param product which product
 * @param client the shared client, for the aggregates
 * @param requester the read-only raw path, for the exemplars
 * @param window the absolute window
 * @param logger where progress goes
 * @returns that product's rows, services and residue
 */
async function runProduct({
  product,
  client,
  requester,
  window,
  logger,
}: {
  product: CensusProduct;
  client: DatadogClient;
  requester: RawRequester;
  window: AbsoluteWindow;
  logger: Logger;
}): Promise<ProductCensus> {
  if (product === "logs") {
    return censusLogs({ client, logger, requester, window });
  }
  if (product === "spans") {
    return censusSpans({ client, logger, requester, window });
  }
  if (product === "rum") {
    return censusRum({ client, logger, requester, window });
  }
  if (product === "ci-pipelines") {
    return censusCiPipelines({ client, logger, requester, window });
  }
  if (product === "ci-tests") {
    return censusCiTests({ client, logger, requester, window });
  }
  if (product === "dbm" || product === "profiles") {
    return censusPageProduct({ logger, product, requester, window });
  }
  return censusMetrics({ client, logger });
}

/**
 * Build one census.
 *
 * @param client the shared client
 * @param requester the read-only raw path the exemplar pass uses
 * @param request the window and the products
 * @param logger where per-product progress goes, so an hour-long pass is not a silent one
 * @returns the catalogue, or the typed reason it produced nothing at all
 */
export async function buildCensus({
  client,
  requester,
  request,
  logger,
}: {
  client: DatadogClient;
  requester: RawRequester;
  request: CensusRequest;
  logger: Logger;
}): Promise<Result<CensusReport, DatadogDetectiveError>> {
  const mapped = await readServiceMap({ client, window: request.window });
  const rows: CensusRow[] = [];
  const services: ServiceVolume[] = [];
  const products: ProductTally[] = [];
  for (const product of CENSUS_RUN_ORDER) {
    if (!request.products.includes(product)) {
      continue;
    }
    logger.info({ msg: `census ${product}: starting` });
    const produced = await runProduct({ client, logger, product, requester, window: request.window });
    rows.push(...produced.rows);
    for (const service of produced.services) {
      services.push({ events: service.events, product, service: service.service });
    }
    products.push({
      exemplified: produced.rows.filter((row) => row.exemplars > 0).length,
      notMeasured: produced.notMeasured,
      product,
      rows: produced.rows.length,
    });
    logger.info({ msg: `census ${product}: ${String(produced.rows.length)} row(s)` });
  }
  if (rows.length === 0 && mapped.map.entities.length === 0 && mapped.map.monitors.length === 0) {
    return err(
      DatadogDetectiveErrors.callFailed({
        cause: [...mapped.notMeasured, ...products.flatMap((tally) => tally.notMeasured)].join("; "),
        what: "every leg of the census",
      }),
    );
  }
  const catalogue = assemble({ client, mapped, products, request, rows, services });
  return ok({ catalogue, rows: rows.length });
}

/**
 * Assemble the document from what the passes produced.
 *
 * Its own function because the manifest is fifteen fields and burying them inside the loop that produced
 * them is what pushes {@link buildCensus} past the length at which a reader holds the whole body.
 *
 * @param rows every product's rows
 * @param services every `(product, service)` volume
 * @param products the per-product tallies
 * @param mapped the service map and its own residue
 * @param request what the pass was asked for, so an unrun product is stated
 * @param client the client, for the site the pass read
 * @returns the catalogue
 */
function assemble({
  rows,
  services,
  products,
  mapped,
  request,
  client,
}: {
  rows: readonly CensusRow[];
  services: readonly ServiceVolume[];
  products: readonly ProductTally[];
  mapped: { map: Awaited<ReturnType<typeof readServiceMap>>["map"]; notMeasured: readonly string[] };
  request: CensusRequest;
  client: DatadogClient;
}): Catalogue {
  return {
    manifest: {
      builtAtIso: new Date().toISOString(),
      map: mapped.map,
      notMeasured: [
        ...mapped.notMeasured,
        ...products.flatMap((tally) => tally.notMeasured),
        ...unrunLines({ asked: request.products }),
      ],
      products,
      retentionDays: shortestRetentionDays({ indexes: mapped.map.indexes }),
      rows: rows.length,
      schemaVersion: CATALOGUE_SCHEMA_VERSION,
      services,
      site: client.config.site,
      window: {
        fromIso: new Date(request.window.fromMs).toISOString(),
        toIso: new Date(request.window.toMs).toISOString(),
      },
    },
    rows,
  };
}

/**
 * The `notMeasured` line for the products a narrowed pass did not run.
 *
 * A narrowed pass is legitimate — it is how one product is rebuilt without paying for the others — but the
 * document it writes has to say which sections are from this pass and which are simply absent, or a reader
 * concludes that Datadog holds nothing for a product nobody asked about.
 *
 * @param asked the products the pass was asked for
 * @returns nothing when every product ran, or one line naming those that did not
 */
export function unrunLines({ asked }: { asked: readonly CensusProduct[] }): readonly string[] {
  const missing = CENSUS_PRODUCTS.filter((product) => !asked.includes(product));
  if (missing.length === 0) {
    return [];
  }
  return [
    `${missing.join(", ")} ${missing.length === 1 ? "was" : "were"} not asked for in this pass — those products have no rows here, which is not the same as having none in Datadog`,
  ];
}
