/**
 * What every product's pass shares: the request ceilings, the service clause, and what a pass returns. Pure.
 *
 * These sat in the logs reader first and three other products imported them from there, which reads as logs
 * owning the vocabulary the whole census speaks. They are here instead, and the ceilings are Datadog's own
 * rather than a budget chosen here — which is the distinction the owner's coverage rule turns on.
 */

import type { DatadogClient } from "../client.js";
import { quoteTerm } from "../detective/shape.js";
import type { CensusRow } from "./row.js";
import { SERVICE_ABSENT } from "./row.js";

/**
 * How many groups one aggregate asks for.
 *
 * Datadog's own ceiling across all dimensions of one request, stated in its own refusal:
 * `invalid_argument(Cannot generate more than 10000 groups across all dimensions…)`. A pass that reaches it
 * repartitions or says so; nothing here lowers it.
 */
export const GROUP_LIMIT = 10_000;

/** How many services one listing asks for. Larger than any plausible estate, so truncation is visible. */
export const SERVICE_LIMIT = 1000;

/** One service and how much of one product it emitted over the window. */
export interface ServiceVolume {
  readonly service: string;
  readonly events: number;
}

/** What one product's pass produced. */
export interface ProductCensus {
  readonly rows: readonly CensusRow[];
  /** One entry per service this product saw, with how many events it held over the window. */
  readonly services: readonly ServiceVolume[];
  /** One line per thing this pass could not reach, in the words a report prints verbatim. */
  readonly notMeasured: readonly string[];
}

/**
 * The query clause that selects one service, including the one that selects the events carrying no service.
 *
 * There is no Datadog query meaning "no service tag" on a reserved attribute, so the absent bucket is
 * selected by NEGATING the existence of one — `-service:*` — which is the honest form and is stated here
 * rather than discovered by a reader wondering why one row's query looks different.
 *
 * @param service the service name, or the absent marker
 * @returns the clause
 */
export function serviceClause({ service }: { service: string }): string {
  if (service === SERVICE_ABSENT) {
    return "-service:*";
  }
  return `service:${quoteTerm({ value: service })}`;
}

/**
 * Read a grouped bucket's service, naming the absent case rather than dropping the bucket.
 *
 * @param by one bucket's facet values
 * @returns the service, or the absent marker
 */
export function serviceOfBucket({ by }: { by: Readonly<Record<string, string | null>> }): string {
  const name = by["service"];
  if (name == null || name.length === 0) {
    return SERVICE_ABSENT;
  }
  return name;
}

/**
 * The slice of the Datadog client a census pass actually uses.
 *
 * Narrower than {@link ../client.DatadogClient} on purpose, and the reason is testability rather than taste:
 * a whole client cannot be built in a unit test without credentials and a network, while this shape is six
 * methods a plain fake can implement — which is the injected seam `.claude/rules/testing.md` asks for
 * instead of a mock. A real client satisfies it structurally, so no call site changes.
 */
export interface CensusClient {
  readonly logs: Pick<DatadogClient["logs"], "aggregateLogs">;
  readonly spans: Pick<DatadogClient["spans"], "aggregateSpans">;
  readonly rum: Pick<DatadogClient["rum"], "aggregateRUMEvents">;
  readonly ciPipelines: Pick<DatadogClient["ciPipelines"], "aggregateCIAppPipelineEvents">;
  readonly ciTests: Pick<DatadogClient["ciTests"], "aggregateCIAppTestEvents">;
  readonly metrics: Pick<DatadogClient["metrics"], "listTagConfigurations" | "listTagsByMetricName">;
  readonly config: DatadogClient["config"];
}
