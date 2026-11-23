/**
 * The `ruling` event's write schema — the one kind whose optional halves (a gate, an explicit steer, a standing
 * session, an attach-upload verdict) each carry a rule a reconstruction may not author, so it sits in its own module beside the kind table
 * in `./rowEventSchema.ts`.
 */

import { z } from "zod";

import { ATTACH_UPLOAD_VERDICTS } from "./attachUploadRulingTypes.js";
import { base, instant, words } from "./rowEventPrimitives.js";

/**
 * The gate a ruling may place — see `./rulingGateTypes.ts` for why a ruling has a machine-readable half.
 *
 * `verbs` is non-empty because a gate naming no verb refuses nothing while reading as a constraint, which is
 * the worst of both. `subjects` may be empty (the gate covers the whole verb) but never carries a blank
 * entry: a blank subject would match no argv token and silently narrow the gate to nothing.
 */
const gateSchema = z
  .object({
    subjects: z.array(words).readonly(),
    untilIso: instant.optional(),
    verbs: z
      .array(z.object({ noun: words, verb: words }).strict())
      .min(1)
      .readonly(),
  })
  .strict();

// `gate` and `gateReleases` are the machine-readable half of a ruling, and neither may sit
// on a reconstruction: a backfill rebuilds free-text answers, so a gate on one would be a refusal nobody
// authored. That is the mirror of the permission property `backfilledFrom` already buys.
/** The `ruling` kind's schema, as `ROW_EVENT_SCHEMAS.ruling`. */
export const rulingEventSchema: z.ZodType = base({ kind: "ruling" })
  .extend({
    anchor: words,
    attachUpload: z
      .object({ verdict: z.enum(ATTACH_UPLOAD_VERDICTS) })
      .strict()
      .optional(),
    backfilledFrom: instant.optional(),
    decidedIso: instant,
    // Strict, like `gate`: the decoder rebuilds exactly these fields, so an extra one would validate, append and
    // then fail the read-back.
    explicitSteer: z.object({ deliverByIso: instant.optional() }).strict().optional(),
    gate: gateSchema.optional(),
    gateReleases: z.array(words).min(1).readonly().optional(),
    ruling: words,
    standingSession: z.object({ untilIso: instant.optional() }).strict().optional(),
  })
  .loose()
  .refine((value) => value.backfilledFrom === undefined || value.backfilledFrom === value.decidedIso, {
    message: "a backfilled ruling's decidedIso must be its source answer's own instant",
  })
  .refine(
    (value) => value.backfilledFrom === undefined || (value.gate === undefined && value.gateReleases === undefined),
    { message: "a reconstruction cannot place or lift a gate — a backfill authors no refusal" },
  )
  .refine((value) => value.backfilledFrom === undefined || value.explicitSteer === undefined, {
    message: "a reconstruction cannot be an explicit steer — a backfill authors no override",
  })
  .refine((value) => value.backfilledFrom === undefined || value.standingSession === undefined, {
    message: "a reconstruction cannot make a standing session — a backfill keeps no seat open",
  })
  .refine((value) => value.backfilledFrom === undefined || value.attachUpload === undefined, {
    message: "a reconstruction cannot rule on attach upload — a backfill neither permits nor refuses it",
  });
