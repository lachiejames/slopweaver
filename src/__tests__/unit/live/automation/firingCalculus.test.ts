/**
 * `firingCalculus.ts` — the cadence arithmetic behind a due verdict, asked directly.
 *
 * `definitionDue.test.ts` exercises the same functions through `judgeRecipeDue`'s sentences. These cases
 * ask them on their own terms, because two of them answer a shape no line can show: `firingsBetween`'s
 * oldest/latest pair, and `deferralToSuccessor`'s two spans in milliseconds.
 *
 * Pure: every case is a cron string, a row literal and a clock.
 */
import { describe, expect, it } from "vitest";

import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../../live/automation/definition.js";
import {
  chooseSlot,
  deferralToSuccessor,
  firingsBetween,
  latestFiringAtOrBefore,
  minutesOf,
  nextFiringAfter,
} from "../../../../live/automation/firingCalculus.js";

/** An hourly `verb-run` row, overridable field by field. */
function row(over: Partial<RecipeDefinition> = {}): RecipeDefinition {
  return {
    cadence: "0 * * * *",
    destination: { kind: "local-atlas" },
    effect: "read",
    enabled: true,
    kind: "verb-run",
    onMissed: "backfill",
    params: { argv: ["atlas", "freshness"] },
    recipeId: "atlas-rolling-window",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    ...over,
  };
}

describe("latestFiringAtOrBefore", () => {
  it("takes a firing the instant lands exactly on, not the one before it", () => {
    expect(latestFiringAtOrBefore({ cadence: "0 * * * *", nowIso: "2026-09-08T12:00:00.000Z" })).toBe(
      "2026-09-08T12:00:00.000Z",
    );
  });

  it("takes the previous firing between two", () => {
    expect(latestFiringAtOrBefore({ cadence: "0 * * * *", nowIso: "2026-09-08T12:59:59.000Z" })).toBe(
      "2026-09-08T12:00:00.000Z",
    );
  });

  it("answers the refusal rather than an instant when the cadence is not a cron expression", () => {
    const answer = latestFiringAtOrBefore({ cadence: "every so often", nowIso: "2026-09-08T12:00:00.000Z" });
    expect(JSON.stringify(answer)).toBe(JSON.stringify({ error: "Invalid characters, got value: so" }));
  });
});

describe("firingsBetween", () => {
  it("counts every firing strictly after the watermark and names the oldest and the latest", () => {
    const firings = firingsBetween({
      afterIso: "2026-09-08T09:00:00.000Z",
      cadence: "0 * * * *",
      nowIso: "2026-09-08T12:05:00.000Z",
    });
    expect(firings).toEqual({
      count: 3,
      latestIso: "2026-09-08T12:00:00.000Z",
      oldestIso: "2026-09-08T10:00:00.000Z",
    });
  });

  it("answers a zero count with no instants when the watermark is the latest firing", () => {
    expect(
      firingsBetween({
        afterIso: "2026-09-08T12:00:00.000Z",
        cadence: "0 * * * *",
        nowIso: "2026-09-08T12:05:00.000Z",
      }),
    ).toEqual({ count: 0, latestIso: null, oldestIso: null });
  });

  it("answers the refusal rather than a count when the cadence is not a cron expression", () => {
    const firings = firingsBetween({
      afterIso: "2026-09-08T09:00:00.000Z",
      cadence: "every so often",
      nowIso: "2026-09-08T12:05:00.000Z",
    });
    expect("error" in firings).toBe(true);
  });
});

describe("chooseSlot", () => {
  it("takes the OLDEST owed slot on a backfill row whose kind covers one slot per run", () => {
    const chosen = chooseSlot({
      definition: row({ kind: "metrics-push", onMissed: "backfill" }),
      firings: { count: 3, latestIso: "2026-09-08T12:00:00.000Z", oldestIso: "2026-09-08T10:00:00.000Z" },
    });
    expect(chosen.slotIso).toBe("2026-09-08T10:00:00.000Z");
    expect(chosen.slotsOwedAfterThis).toBe(2);
    expect(chosen.coversLatest).toBe(false);
  });

  it("takes the LATEST slot on a skip row, and says so", () => {
    const chosen = chooseSlot({
      definition: row({ onMissed: "skip" }),
      firings: { count: 3, latestIso: "2026-09-08T12:00:00.000Z", oldestIso: "2026-09-08T10:00:00.000Z" },
    });
    expect(chosen.slotIso).toBe("2026-09-08T12:00:00.000Z");
    expect(chosen.slotsOwedAfterThis).toBe(0);
    expect(chosen.coversLatest).toBe(true);
  });
});

describe("deferralToSuccessor", () => {
  // An HOURLY cadence throughout: `cron-parser` reads a cadence in the machine's own timezone, so a daily
  // expression would make these instants depend on where the test runs. Every hour is a period everywhere.
  it("defers a single owed firing past its own period's midpoint to the successor", () => {
    expect(
      deferralToSuccessor({
        cadence: "0 * * * *",
        coversLatest: true,
        firingsSinceWatermark: 1,
        nowIso: "2026-09-08T12:39:00.000Z",
      }),
    ).toEqual({ lateByMs: 2340000, nextFiringInMs: 1260000 });
  });

  it("does not defer a firing still nearer its own hour than the next one", () => {
    expect(
      deferralToSuccessor({
        cadence: "0 * * * *",
        coversLatest: true,
        firingsSinceWatermark: 1,
        nowIso: "2026-09-08T12:20:00.000Z",
      }),
    ).toBeNull();
  });

  it("never defers a backfilled slot, whose run answers that slot rather than the world now", () => {
    expect(
      deferralToSuccessor({
        cadence: "0 * * * *",
        coversLatest: false,
        firingsSinceWatermark: 1,
        nowIso: "2026-09-08T12:39:00.000Z",
      }),
    ).toBeNull();
  });

  it("never defers once more than one firing is owed, so a hold cannot outlast a period", () => {
    expect(
      deferralToSuccessor({
        cadence: "0 * * * *",
        coversLatest: true,
        firingsSinceWatermark: 2,
        nowIso: "2026-09-08T12:39:00.000Z",
      }),
    ).toBeNull();
  });
});

describe("minutesOf", () => {
  it("rounds to whole minutes", () => {
    expect(minutesOf({ ms: 161 * 60000 + 29000 })).toBe("161m");
  });

  it("answers 0m for a span under half a minute", () => {
    expect(minutesOf({ ms: 15000 })).toBe("0m");
  });
});

describe("nextFiringAfter", () => {
  it("answers the first firing strictly after the instant, never the instant itself", () => {
    expect([
      nextFiringAfter({ cadence: "*/15 * * * *", nowIso: "2026-10-03T12:05:00.000Z" }),
      nextFiringAfter({ cadence: "*/15 * * * *", nowIso: "2026-10-03T12:15:00.000Z" }),
    ]).toEqual(["2026-10-03T12:15:00.000Z", "2026-10-03T12:30:00.000Z"]);
  });

  it("says why when the cadence is not a cron expression", () => {
    expect(nextFiringAfter({ cadence: "every so often", nowIso: "2026-10-03T12:05:00.000Z" })).toEqual({
      error: "Invalid characters, got value: so",
    });
  });
});
