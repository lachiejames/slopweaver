/**
 * Reading one operation's paging parameter names out of the generated side table.
 *
 * The table itself is `generated/pagingParameters.ts`, whose header carries the measurement that made it a
 * side table rather than two more fields on every registry row. What lives HERE is the one thing a generated
 * file should not: the statement of what an ABSENT key means.
 *
 * A surface missing from the table does not walk and caps no page. That is a fact about the operation, not a
 * lookup miss, so it is said once here rather than at every call site as a `??` a reader has to interpret.
 */
import { DATADOG_PAGING_PARAMETERS, type DatadogPagingParameters } from "./generated/pagingParameters.js";

/**
 * The parameter names one operation pages with.
 *
 * @param surface the surface name, exactly as `generated/surfaces.ts` spells it
 * @returns the operation's own parameter names, both `null` when it neither walks nor caps
 */
export function datadogPagingParametersFor({ surface }: { surface: string }): DatadogPagingParameters {
  const held = DATADOG_PAGING_PARAMETERS[surface];
  if (held === undefined) {
    return { size: null, walk: null };
  }
  return held;
}
