/**
 * A dry card's key: the hour of the reset ending it plus a digest of the spent set — so drift in the reset holds the
 * card while a plan coming back re-cuts it — and the lapse and revision read back off either key form.
 */
import { describe, expect, it } from "vitest";

import { drySpellKeyLapsesAt, drySpellKeyRevision, fleetDryKey } from "../../../monitor/fleetRunsDry.js";
import type { FleetDryInterval } from "../../../monitor/fleetRunsDryCeilings.js";

const INTERVAL: FleetDryInterval = {
  exhaustedCeilingIds: ["claude:plan-one", "codex:codex-one"],
  fromIso: "2026-11-05T10:00:00.000Z",
  providers: ["claude", "codex"],
  relievedByCeilingId: "claude:plan-one",
  routingBars: { claudeFiveHour: 95, claudeWeek: 98, codex: 90 },
  untilIso: "2026-11-05T16:42:00.000Z",
};

describe("fleetDryKey", () => {
  it("names the reset's hour, floored, and a sixteen-character revision", () => {
    const key = fleetDryKey({ interval: INTERVAL });
    expect(key).toMatch(/^until-2026-11-05t16-r[0-9a-f]{16}$/);
    expect(drySpellKeyLapsesAt({ key })).toBe("2026-11-05T16:00:00.000Z");
  });

  it("keeps its revision when only the reset moves", () => {
    const moved = fleetDryKey({ interval: { ...INTERVAL, untilIso: "2026-11-05T19:00:00.000Z" } });
    expect(drySpellKeyRevision({ key: moved })).toBe(drySpellKeyRevision({ key: fleetDryKey({ interval: INTERVAL }) }));
  });

  it("changes its revision when the spent set changes", () => {
    const fewer = fleetDryKey({ interval: { ...INTERVAL, exhaustedCeilingIds: ["claude:plan-one"] } });
    expect(drySpellKeyRevision({ key: fewer })).not.toBe(
      drySpellKeyRevision({ key: fleetDryKey({ interval: INTERVAL }) }),
    );
  });

  it("reads a key cut before keys carried a revision as lapsing, with no revision", () => {
    expect(drySpellKeyLapsesAt({ key: "until-2026-09-30t11" })).toBe("2026-09-30T11:00:00.000Z");
    expect(drySpellKeyRevision({ key: "until-2026-09-30t11" })).toBeUndefined();
  });

  it("reads a key naming no hour as never lapsing", () => {
    expect(drySpellKeyLapsesAt({ key: "unended" })).toBeUndefined();
  });
});
