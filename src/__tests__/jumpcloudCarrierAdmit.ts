/**
 * A JumpCloud page admitter for the tests of the WALK — pagination, journalling, coverage, publishing — over an
 * invented tenancy.
 *
 * The production admitter (`responseRegistry.ts`'s `admitJumpcloudPage`) holds every surface to the keys measured on
 * the live tenant, so an invented record is refused there by design, and a surface the tenant never answered refuses
 * every record at all. Those refusals are tested where admission is; a walk test that wants a RADIUS server with a
 * shared secret in it needs the page admitted, so it passes this instead. It reads the carrier from the answer's own
 * shape and checks no field, which is exactly what production must never do and why it lives under the test tree.
 */
import { JumpcloudReadErrors } from "../atlas/jumpcloud/errors.js";
import { headerTotal } from "../atlas/jumpcloud/paging.js";
import type { JumpcloudAdmit } from "../atlas/jumpcloud/responseRegistry.js";
import { err, ok } from "../lib/result.js";

/**
 * Admit any page in whichever carrier it arrived in, a `results` array's own `totalCount` taken when it is a number.
 * A body that is not JSON is refused exactly as production refuses it, by length alone.
 *
 * @returns the page's records, carrier and total, or `BODY_NOT_JSON` naming the body's length
 */
export const admitAnyCarrier: JumpcloudAdmit = ({ surface, text, headers }) => {
  const fromHeader = headerTotal({ headers });
  if (text.trim().length === 0) {
    return ok({ records: [], shape: "empty", totalCount: fromHeader });
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return err(JumpcloudReadErrors.bodyNotJson({ length: text.length, surface }));
  }
  if (Array.isArray(value)) {
    return ok({ records: value, shape: "bare-array", totalCount: fromHeader });
  }
  if (typeof value === "object" && value !== null && "results" in value && Array.isArray(value.results)) {
    const declared = "totalCount" in value && typeof value.totalCount === "number" ? value.totalCount : fromHeader;
    return ok({ records: value.results, shape: "wrapped-results", totalCount: declared });
  }
  return ok({ records: [value], shape: "single-object", totalCount: fromHeader });
};
