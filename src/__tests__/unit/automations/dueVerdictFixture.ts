/*
 * The one not-due verdict `./card.test.ts` and `./health.test.ts` both read a row over: the Slack resync, last run and
 * watermarked at the same instant, nothing owed and no slot handed on.
 */
import type { RecipeDueVerdict } from "../../../live/automation/definitionDue.js";

/**
 * A not-due verdict on the Slack resync row, with no firing since its watermark and no slot handed to a successor.
 *
 * @param over the fields a case changes on it
 * @returns the verdict
 */
export const verdict = (over: Partial<RecipeDueVerdict> = {}): RecipeDueVerdict => ({
  deferredSlotIso: null,
  due: false,
  firingsSinceWatermark: 0,
  lastRunAtIso: "2026-10-03T00:00:00.000Z",
  line: "",
  recipeId: "resync-corpus-slack",
  slotIso: null,
  slotsOwedAfterThis: 0,
  watermarkIso: "2026-10-03T00:00:00.000Z",
  ...over,
});
