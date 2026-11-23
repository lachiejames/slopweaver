/**
 * A paused Claude plan's week as it stood going into the pause.
 *
 * A paused plan is never probed (`./readCeilings.ts`), on purpose: the pause exists so the plan spends nothing, and
 * a one-token probe is spend. So the only reset anybody measured for it is the one the `machine capacity` reading
 * IN FORCE at the pause instant carried — the last one recorded at or before `paused.sinceIso`. This reads that
 * plan's `seven-day` window out of that document, exactly, and says why when it cannot.
 *
 * A paused plan reads paused, with the reason and the reset, never as "carried no measurable week in this
 * reading", which is what the Fleet page once drew for a deliberate pause.
 */
import { isRecord } from "#lib/parsers.js";

import type { PausedWeekAtPause } from "./ceilings.js";
import { ceilingsReadingSchema } from "./ceilingsSchema.js";

/** The weekly window a Claude plan's ceiling names. */
const CLAUDE_WEEK_WINDOW = "seven-day";

/**
 * The plan's week out of the `machine capacity` document in force at its pause.
 *
 * @param alias the paused plan's configured alias
 * @param document the whole earlier `machine capacity --json` document, as the readings ledger holds it
 * @returns the week as that reading saw it, or why there is none to show
 */
export function pausedWeekOf({ alias, document }: { alias: string; document: unknown }): PausedWeekAtPause {
  if (!isRecord(document) || !("ceilings" in document)) {
    return { kind: "unavailable", why: "the reading before the pause predates the plans' ceilings" };
  }
  const parsed = ceilingsReadingSchema.safeParse(document["ceilings"]);
  if (!parsed.success) {
    return { kind: "unavailable", why: "the plans' ceilings in the reading before the pause did not read" };
  }
  const id = `claude:${alias}`;
  const ceiling = parsed.data.ceilings.find((candidate) => candidate.id === id);
  if (ceiling === undefined) {
    return { kind: "unavailable", why: `the reading before the pause carried no ${alias}` };
  }
  const week = ceiling.windows.find((window) => window.window === CLAUDE_WEEK_WINDOW);
  if (week === undefined) {
    return {
      kind: "unavailable",
      why: `the reading before the pause carried no week for ${alias} (${ceiling.status})`,
    };
  }
  return {
    available: week.available,
    kind: "read",
    readAtIso: parsed.data.observedAtIso,
    resetAtIso: week.resetAtIso,
    used: week.used,
  };
}
