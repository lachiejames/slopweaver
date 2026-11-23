/**
 * Two shapes every strict Trelica boundary is assembled from: a page of `{items, total, resultsTruncated}`,
 * and the run of keys an answer carries that this atlas declares and never reads.
 *
 * `src/lib/boundary.ts` refuses an answer whose key set differs from the declared one, so an unread key is
 * still DECLARED — as `z.unknown().optional()`, which `src/lib/boundaryWalk.ts` admits only as an object
 * field's value. Spelling a hundred of them one per line would bury the dozen fields a projection actually
 * reads, so {@link unreadTrelicaKeys} spells them as one list and the read fields stay visible beside it.
 */
import { z } from "zod";

/** The schema one unread key is declared as. */
type UnreadKey = z.ZodOptional<z.ZodUnknown>;

/**
 * Declare keys an answer carries and this atlas does not read.
 *
 * @param keys the keys, each as the provider spells it
 * @returns a shape to spread into a `z.strictObject`
 */
export function unreadTrelicaKeys<const K extends string>({ keys }: { keys: readonly K[] }): Record<K, UnreadKey> {
  // Total: one entry per listed key, which is exactly the record type's key set. `Object.fromEntries` cannot
  // say so for a generic `K`, and spelling the keys out is what this helper exists to avoid.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return Object.fromEntries(keys.map((key) => [key, z.unknown().optional()])) as Record<K, UnreadKey>;
}

/**
 * One page of a `FilterItems`/`GetMany` list. `resultsTruncated` is the provider's own flag for a page it cut
 * short, read rather than declared-and-ignored so a truncated read is refused instead of published as complete.
 *
 * @param item the schema of one record
 * @returns the page schema
 */
export function trelicaPageSchema<I extends z.ZodType>({
  item,
}: {
  item: I;
}): z.ZodObject<{ items: z.ZodArray<I>; resultsTruncated: z.ZodBoolean; total: z.ZodNumber }, z.core.$strict> {
  return z.strictObject({ items: z.array(item), resultsTruncated: z.boolean(), total: z.number() });
}

/** A person as Trelica embeds one in another record: a contract owner, a workflow owner, an assignee. */
export const trelicaEmbeddedPersonSchema = z.strictObject({
  email: z.string(),
  name: z.string(),
  terminated: z.boolean(),
  ...unreadTrelicaKeys({ keys: ["id", "personType"] }),
});
