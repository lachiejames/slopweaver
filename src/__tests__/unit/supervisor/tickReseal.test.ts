/**
 * The pure reseal: stale stats are the ONE defect it repairs, every other defect stays refused, and a sound row
 * comes back untouched — through the same check list `parseSupervisorTickRow` runs.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { resealSupervisorTickRow } from "../../../supervisor/tickReseal.js";
import { parseSupervisorTickRow } from "../../../supervisor/tickSchema.js";
import { supervisorTickLine } from "../../../supervisor/tickStore.js";
import { backwardsTick, STALE_BYTES, soundTick, staleTick } from "./tickResealFixture.js";

const SOUND = soundTick({ finalisedIso: "2026-11-10T09:00:00.000Z", tickId: "tick-1" });

/**
 * A row as the ledger holds it: its line, parsed back.
 *
 * @param row the row
 * @returns the parsed JSON of its ledger line
 */
function asRead({ row }: { row: typeof SOUND }): unknown {
  return JSON.parse(supervisorTickLine({ row }));
}

describe("resealSupervisorTickRow", () => {
  it("recomputes stats that are the row's only defect, keeping every other field", () => {
    const stale = staleTick({ row: SOUND });
    expect(unwrapErr(parseSupervisorTickRow({ value: asRead({ row: stale }) }))[0]).toContain("stats disagree");

    const resealed = unwrap(resealSupervisorTickRow({ value: asRead({ row: stale }) }));

    expect(resealed.changed).toBe(true);
    expect(resealed.before.structuredUtf8Bytes).toBe(SOUND.stats.structuredUtf8Bytes + STALE_BYTES);
    expect(resealed.after).toEqual(SOUND.stats);
    expect(supervisorTickLine({ row: resealed.row })).toBe(supervisorTickLine({ row: SOUND }));
    expect(unwrap(parseSupervisorTickRow({ value: asRead({ row: resealed.row }) }))).toEqual(SOUND);
  });

  it("refuses a row with any other defect, even when its stats are stale too", () => {
    const reasons = unwrapErr(resealSupervisorTickRow({ value: asRead({ row: backwardsTick({ row: SOUND }) }) }));

    expect(reasons.some((reason) => reason.includes("is before startedIso"))).toBe(true);
    expect(reasons.some((reason) => reason.includes("stats disagree"))).toBe(false);
  });

  it("refuses a value the schema refuses", () => {
    expect(unwrapErr(resealSupervisorTickRow({ value: { tickId: "tick-1" } })).length).toBeGreaterThan(0);
  });

  it("returns a sound row unchanged, its stats the same either side", () => {
    const resealed = unwrap(resealSupervisorTickRow({ value: asRead({ row: SOUND }) }));

    expect(resealed.changed).toBe(false);
    expect(resealed.before).toEqual(SOUND.stats);
    expect(resealed.after).toEqual(SOUND.stats);
    expect(supervisorTickLine({ row: resealed.row })).toBe(supervisorTickLine({ row: SOUND }));
  });
});
