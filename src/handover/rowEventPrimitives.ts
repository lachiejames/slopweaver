/**
 * The field shapes every row-event schema is built from, shared by `./rowEventSchema.ts`'s kind table and the
 * per-kind schemas split out beside it (`./rulingEventSchema.ts`), so one definition of "an instant" serves both.
 */

import { z } from "zod";

import type { RunEvent } from "./ledger.js";

/** A non-empty string field — the shape a decoder would otherwise turn into `""` and carry on with. */
export const words = z.string().trim().min(1);

/** An instant that actually parses. A journal ordered by an unparseable `atIso` is ordered by nothing. */
export const instant = words.refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "is not an instant Date.parse can read",
});

/**
 * Every event carries these two, and both are load-bearing for ordering and dispatch.
 *
 * @param kind the event kind the schema is for
 * @returns the object schema carrying `atIso` and the literal `kind`
 */
export const base = <K extends RunEvent["kind"]>({
  kind,
}: {
  kind: K;
}): z.ZodObject<{ kind: z.ZodLiteral<K>; atIso: typeof instant }> =>
  z.object({ atIso: instant, kind: z.literal(kind) });
