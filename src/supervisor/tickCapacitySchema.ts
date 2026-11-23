/**
 * The capacity facts' slice of the supervisor tick row schema (`./tickSchema.ts`), with the seat ceiling it
 * carries. Split out when the seat ceiling joined it, so the row schema stays a file one reader can hold.
 */
import { z } from "zod";

import { ceilingsReadingSchema } from "../capacity/ceilingsSchema.js";

/** A non-empty string, as `./tickSchema.ts` reads every label. */
const text = z.string().min(1);

/** The seat ceiling one tick carries. See `./tickTypes.ts`'s `TickSeatCeiling`. */
const tickSeatCeilingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("measured"), seats: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("unmeasurable"), reason: text }).strict(),
]);

/** The four dispatch readings added together, which a row carries all of or none of. */
const DISPATCH_KEYS = ["dispatchBackoffSeconds", "dispatchOpen", "dispatchCovering", "dispatchSubject"] as const;

/** The machine reading's slice. See `./tickTypes.ts`'s `CapacityFacts`. */
export const capacityFactsSchema = z
  .object({
    /** Every ceiling a seat spends, optional for the same reason as the disk readings below. */
    ceilings: ceilingsReadingSchema.optional(),
    // The three disk readings are optional: every row journalled before they existed carries none, and
    // `.strict()` above means a required key here would refuse to read the ledger's own history back.
    diskFreeGb: z.number().optional(),
    /** The free GB the disk holds below. Optional: every row journalled before this field existed has none. */
    diskHoldFreeGb: z.number().optional(),
    diskUsedPct: z.number().optional(),
    // The four dispatch readings are optional for the disk readings' reason: every row journalled by an
    // older build carries none, and requiring them refused the first 647 rows of the real ledger, which
    // stopped every reader that walks its whole history. They arrive together or not at all — see the refine.
    /** Seconds until another investigation may be seated on the open dispatch's signature; 0 means now. */
    dispatchBackoffSeconds: z.number().nonnegative().optional(),
    /**
     * Open anomalous-load findings at the reading, seated or not — what a reader still has to settle.
     * {@link dispatchCovering} is what answers a hold; this one is the wider register fact beside it.
     */
    dispatchOpen: z.number().int().nonnegative().optional(),
    /** Open findings that SEATED a session — the count `loadDispatchGate.ts` refuses a hold over. */
    dispatchCovering: z.number().int().nonnegative().optional(),
    /**
     * The newest open dispatch's subject. EMPTY is the ordinary reading — nothing is open — so this one
     * field is a bare string rather than the `text` every other label here uses, which refuses "".
     */
    dispatchSubject: z.string().optional(),
    hold: z.boolean(),
    holdSubjects: z.array(text),
    load1: z.number(),
    /** The 1-minute load the hold is judged at. Optional: every row journalled before this field existed has none. */
    loadHold: z.number().optional(),
    registeredWorktrees: z.number().int().nonnegative().optional(),
    segmentsPct: z.number(),
    swapfileCount: z.number().int().nonnegative(),
    topForeignGb: z.number(),
    topForeignLabel: text,
    /** The working seats the plans carry until they reset. Optional: every row journalled before this field existed has none. */
    workingSeatCeiling: tickSeatCeilingSchema.optional(),
  })
  .strict()
  .superRefine((facts, context) => {
    const present = DISPATCH_KEYS.filter((key) => facts[key] !== undefined);
    if (present.length > 0 && present.length < DISPATCH_KEYS.length) {
      context.addIssue({
        code: "custom",
        message:
          `the dispatch readings arrive together or not at all; this row carries only ${present.join(", ")}, ` +
          "so it is neither a row from before they existed nor a whole one",
      });
    }
  });
