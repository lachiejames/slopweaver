/**
 * Fold the first-party calls this atlas made onto one `method` detail per operation.
 *
 * Two admitted rows may read one operation with different fixed parameters — the AI alert history, read once
 * per alert type — so the calls fold onto one detail with the field set widened and the calls counted, never
 * two entities sharing one id.
 */
import type { TrelicaMethodFirstPartyDetail } from "./model.js";

/**
 * One detail per operation, keyed by its method provider id.
 *
 * @param calls each call made, already keyed by the operation it reached
 * @param fieldNames the response field names observed per call id
 * @returns the folded details, in first-seen order
 */
export function foldTrelicaFirstPartyCalls({
  calls,
  fieldNames,
}: {
  calls: readonly { providerId: string; callId: string; statusCode: number }[];
  fieldNames: ReadonlyMap<string, readonly string[]>;
}): ReadonlyMap<string, TrelicaMethodFirstPartyDetail> {
  const byProviderId = new Map<string, TrelicaMethodFirstPartyDetail>();
  for (const call of calls) {
    const held = byProviderId.get(call.providerId);
    const heldFields = held === undefined ? [] : held.responseFields;
    const observed = fieldNames.get(call.callId);
    const fields = [...heldFields];
    if (observed !== undefined) {
      fields.push(...observed);
    }
    byProviderId.set(call.providerId, {
      callCount: held === undefined ? 1 : held.callCount + 1,
      calledDirectly: true,
      responseFields: [...new Set(fields)].toSorted(),
      statusCode: call.statusCode,
    });
  }
  return byProviderId;
}
