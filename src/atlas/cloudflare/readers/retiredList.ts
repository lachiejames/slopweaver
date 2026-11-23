/**
 * The records a RETIRED list endpoint answered with. From `cloudflare` 7.2.0 the SDK types the legacy rate-limit
 * and WAF-override lists as `APIPromise<void>`, documenting each as "deprecated and returns 410 Gone", and
 * dropped their pager: the runtime is a plain `GET` that resolves to the whole `{ result, result_info }`
 * envelope, `result` NOT unwrapped. Both readers keep CALLING the endpoint, so the live `410` stays an observed,
 * typed gap rather than a guess, and read a success defensively here — the same runtime check
 * `readCloudflareWafPackageInventory` applies to an item the SDK types as bare `unknown`. A success whose
 * `result` is not an array, one declaring a second page this one GET cannot follow, or one carrying a record
 * with no usable id, is a schema error, never an empty or truncated read.
 */
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type CloudflareClientError, CloudflareClientErrors } from "../errors.js";

/**
 * Whether an envelope's `result_info` could declare more than the records the one plain GET returned: a
 * `total_pages` above 1, or a `total_count` other than the number returned. A paging block that is not a
 * record, or either field present but not a number, is unreadable paging and counts as more: nothing missing
 * can be ruled out by a field this code cannot read.
 *
 * @param envelope the response envelope
 * @param returned how many records its `result` carries
 * @returns true unless `result_info` is absent, or a record whose paging, where declared, is this one page whole
 */
function mayHoldMoreThanReturned({
  envelope,
  returned,
}: {
  envelope: Record<string, unknown>;
  returned: number;
}): boolean {
  const info = envelope["result_info"];
  if (info === undefined) {
    return false;
  }
  if (!isRecord(info)) {
    return true;
  }
  const totalPages = info["total_pages"];
  const totalCount = info["total_count"];
  const pagesBeyondOne = totalPages !== undefined && (typeof totalPages !== "number" || totalPages > 1);
  const countBeyondReturned = totalCount !== undefined && (typeof totalCount !== "number" || totalCount !== returned);
  return pagesBeyondOne || countBeyondReturned;
}

/**
 * Narrow what a retired list endpoint returned into its records, each of which must carry a usable id.
 *
 * @param listed the awaited envelope, untyped because the SDK no longer declares one
 * @param operation the operation label the typed error names
 * @returns every record, or a schema error naming the shape or the record that failed
 */
export function retiredListRecords({
  listed,
  operation,
}: {
  listed: unknown;
  operation: string;
}): Result<readonly { readonly id: string; readonly [key: string]: unknown }[], CloudflareClientError> {
  const result = isRecord(listed) ? listed["result"] : undefined;
  if (!isRecord(listed) || !Array.isArray(result)) {
    const keys = isRecord(listed) ? Object.keys(listed).join(", ") : typeof listed;
    return err(
      CloudflareClientErrors.schema({
        cause: new Error(`expected an envelope whose result is an array, got: ${keys}`),
        operation,
      }),
    );
  }
  if (mayHoldMoreThanReturned({ envelope: listed, returned: result.length })) {
    return err(
      CloudflareClientErrors.schema({
        cause: new Error(
          "the envelope declares more than it returned, or paging this code cannot read, and the SDK no longer pages this retired list",
        ),
        operation,
      }),
    );
  }
  const items: readonly unknown[] = result;
  const records: { readonly id: string; readonly [key: string]: unknown }[] = [];
  for (const [index, item] of items.entries()) {
    if (!isRecord(item) || typeof item["id"] !== "string" || item["id"].length === 0) {
      return err(
        CloudflareClientErrors.schema({
          cause: new Error(`record ${String(index)} is not a record with a non-empty string id`),
          operation,
        }),
      );
    }
    records.push({ ...item, id: item["id"] });
  }
  return ok(records);
}
