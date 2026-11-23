/**
 * What one `admin-api` fill BROUGHT BACK, as a value the publish path can consume — the same shape the
 * console walk uses, and for the same reason.
 *
 * `walk` already established the idiom here: the effectful half returns an observation, and
 * `sync.ts`'s pure builder turns it into coverage cells, gaps and entities. Keeping the fill to that shape
 * means the whole judgement about what a fill MEANS stays pure and testable, and the network half has no
 * opinion about the atlas at all.
 *
 * ## It carries no account, deliberately
 *
 * The grant knows which mailbox it bound to, and that is a private identifier this repository may not hold
 * (AGENTS.md). Nothing here needs it: a coverage cell's scope on this platform is the PLATFORM name, which
 * `coverage.ts` already chose for exactly this reason. So the observation records what was READ and never
 * whose account read it.
 */
import { z } from "zod";

/**
 * One record a filled operation returned, reduced to what the atlas stores.
 *
 * The reduction is the point rather than an optimisation. See `model.ts`'s
 * `googleAdminLiveRecordDetailSchema` for why this carries field names and no values.
 * @internal
 */
export const googleAdminFilledRecordSchema = z
  .object({
    /**
     * Google's own key for the record — its `name`, `id`, `primaryEmail` or `orgUnitPath`, whichever it
     * published. This is what the entity's channels are matched on, byte-exactly.
     */
    providerId: z.string().min(1),
    /**
     * The names of the fields Google returned for it, sorted. NAMES, never values — `model.ts`'s
     * `googleAdminLiveRecordDetailSchema` carries why, and keeping values out of the observation too means
     * no artifact this fill writes anywhere holds one.
     */
    fields: z.array(z.string().min(1)),
  })
  .strict();

/** One record a filled operation returned. */
export type GoogleAdminFilledRecord = z.infer<typeof googleAdminFilledRecordSchema>;

/** One operation that was called and answered.
 * @internal
 */
export const googleAdminFilledOperationSchema = z
  .object({
    /** The registry method id. */
    id: z.string().min(1),
    /** The document it was declared in — the other half of the provider key. */
    document: z.string().min(1),
    /** The kind its records land under. */
    kind: z.string().min(1),
    /** The records it returned, empty when the collection was genuinely empty. */
    records: z.array(googleAdminFilledRecordSchema),
    /**
     * Whether the read stopped at its own page bound rather than at the end of the collection.
     *
     * A stored count that silently means "the first N" is the dishonesty a coverage cell exists to
     * prevent, so this is what turns the cell `deferred` instead of `synced`.
     */
    truncated: z.boolean(),
    /**
     * Whether the payload field held an aggregate (`countChromeOsDevices` answers a `count`) rather than a
     * collection, as `records.ts` judged it on the first page. Carried because an empty `records` cannot
     * tell an aggregate from a collection that was genuinely empty.
     */
    aggregate: z.boolean(),
  })
  .strict();

/** One operation that was called and answered.
 * @internal
 */
export type GoogleAdminFilledOperation = z.infer<typeof googleAdminFilledOperationSchema>;

/** One operation that was called and refused.
 * @internal
 */
export const googleAdminFailedOperationSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1),
    /** Google's own HTTP status, or 0 when the call never reached it. */
    status: z.number().int(),
    /** What Google said, or what the transport said when it did not answer. */
    message: z.string().min(1),
  })
  .strict();

/** One operation that was called and refused.
 * @internal
 */
export type GoogleAdminFailedOperation = z.infer<typeof googleAdminFailedOperationSchema>;

/** One operation the plan excluded before any call was made.
 * @internal
 */
export const googleAdminExcludedOperationSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1),
    exclusion: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict();

/** One operation the plan excluded before any call was made.
 * @internal
 */
export type GoogleAdminExcludedOperation = z.infer<typeof googleAdminExcludedOperationSchema>;

/** Everything one fill run saw.
 * @internal
 */
export const googleAdminFillObservationSchema = z
  .object({
    /** When the fill ran, which is what stamps every cell it produces. */
    filledAtIso: z.iso.datetime(),
    /** The scope URIs the grant carried, which is what decided the plan. */
    grantedScopes: z.array(z.string().min(1)),
    /** Every operation that answered. */
    operations: z.array(googleAdminFilledOperationSchema),
    /** Every operation that was called and refused. */
    failed: z.array(googleAdminFailedOperationSchema),
    /** Every operation the plan never attempted, each with the reason. */
    excluded: z.array(googleAdminExcludedOperationSchema),
  })
  .strict();

/** Everything one fill run saw. */
export type GoogleAdminFillObservation = z.infer<typeof googleAdminFillObservationSchema>;

/**
 * Parse an observation read back from disk, so a hand-edited file fails at the boundary.
 *
 * @param value the parsed JSON
 * @returns the observation, or `null` when it will not parse
 * @internal
 */
export function parseGoogleAdminFillObservation({ value }: { value: unknown }): GoogleAdminFillObservation | null {
  const parsed = googleAdminFillObservationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
