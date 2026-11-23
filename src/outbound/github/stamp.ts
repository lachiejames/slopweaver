/**
 * The one check a write makes against the door's own clock.
 *
 * A C3 description carries no write stamp: no byte of it depends on the day it is written, so a `--pull` then
 * `--file` round trip with no edits renders the same bytes and stays a no-op on its own. What the clock still
 * decides is whether the problem's seen day is honest — a problem cannot have been seen on a day after the write.
 */
import { err, ok, type Result } from "#lib/result.js";
import { utcMidnightOf } from "./days.js";
import { type PrBodyError, PrBodyErrors } from "./errors.js";
import type { IsoDay, PrForm, PrFormDraft } from "./types.js";

/**
 * Accept a draft for a write: refused when its problem is marked seen after today.
 *
 * @param draft the validated draft about to be written
 * @param today the door's UTC day, from its injected clock
 * @returns the form to write, or a refusal naming the seen day and today
 */
export function stampForWrite({ draft, today }: { draft: PrFormDraft; today: IsoDay }): Result<PrForm, PrBodyError> {
  const seen = draft.problemSeen;
  if (seen.kind !== "seen") {
    return ok(draft);
  }
  const on = utcMidnightOf({ day: seen.on });
  if (on === undefined) {
    return err(PrBodyErrors.invalidDay({ field: "problemSeen.on", value: seen.on }));
  }
  const now = utcMidnightOf({ day: today });
  if (now !== undefined && on > now) {
    return err(PrBodyErrors.seenAfterToday({ on: seen.on, today }));
  }
  return ok(draft);
}
