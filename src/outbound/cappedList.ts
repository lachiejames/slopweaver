/**
 * An item cap on a list that sits inside an arm of a plain `z.union`, held so the union can still name it.
 *
 * Since zod 4.6.6 an array's leading `.max()`/`.length()` fails BEFORE its elements parse and marks its issue
 * aborting (`capSize` in zod's `src/v4/core/schemas.ts`). A plain union reports the one arm that did not abort,
 * so an arm failing only on that cap now aborts like every arm that never matched, and the composer reads
 * `Invalid input` where zod 4.6.5 named the cap. A refine is not a size check, so it runs after the elements;
 * its `when` keeps the other half of `.max()`, which still ran after an element had failed. A union that has
 * a literal to discriminate on should be a `z.discriminatedUnion` instead, which needs none of this.
 */
import type { z } from "zod";

/**
 * Refuse a list longer than `max`, in a way a plain union around it can still report.
 *
 * @param list the array schema, with any `.min()` already applied
 * @param message the refusal a composer reads, naming where the rest goes
 * @returns the same list schema, refusing more than `max` items
 */
export function cappedList<T extends z.ZodArray<z.ZodType>>({
  list,
  max,
  message,
}: {
  list: T;
  max: number;
  message: string;
}): T {
  return list.refine((value) => value.length <= max, { message, when: (payload) => Array.isArray(payload.value) });
}
