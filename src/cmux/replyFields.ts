/** Field readers over a decoded cmux socket reply, shared by the client and the process-tree parser. */
import { isRecord } from "../lib/parsers.js";

/**
 * An optional NON-EMPTY string field on a decoded reply.
 *
 * Empty is treated as absent because cmux reports an unset field as `null` and an emptied one as `""`, and
 * every caller here means the same thing by both.
 *
 * @param value the decoded reply node, which may not be a record at all
 * @param field the key to read
 * @returns the string, or `undefined` when it is absent, empty or not a string
 */
export function optionalString({ value, field }: { value: unknown; field: string }): string | undefined {
  if (!isRecord(value) || typeof value[field] !== "string" || value[field].length === 0) {
    return undefined;
  }
  return value[field];
}
