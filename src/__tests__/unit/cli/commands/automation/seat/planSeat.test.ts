/**
 * `planSeat`, the pure half of `slopweaver automation seat`: which composed report rows a seat takes, how the
 * limit and `--recipe` bound it, and how a row the slot ledger refuses is stepped past and named.
 */
import { describe, expect, it } from "vitest";

import { planSeat } from "../../../../../../cli/commands/automation/seat.js";
import { unseatableSkipLine } from "../../../../../../cli/commands/automation/seatRefusals.js";
import { COOLING_WHY, report, reportRow } from "./fixtures.js";

describe("planSeat", () => {
  it("takes only actionable spawn-shaped rows", () => {
    const plan = planSeat({
      unseatable: new Map(),
      id: "abcdef12-3456",
      limit: 10,
      recipeId: null,
      report: report({
        rows: [
          reportRow(),
          reportRow({ recipeId: "atlas-rolling-window", shape: "run-here" }),
          reportRow({ actionable: false, recipeId: "resync-corpus-notion" }),
        ],
      }),
    });
    expect(plan.rows.map((row) => row.recipeId)).toEqual(["resync-atlas-trelica"]);
  });

  it("bounds the seat at the limit, keeping the report's own order", () => {
    const plan = planSeat({
      unseatable: new Map(),
      id: "abcdef12-3456",
      limit: 2,
      recipeId: null,
      report: report({
        rows: [reportRow({ recipeId: "a" }), reportRow({ recipeId: "b" }), reportRow({ recipeId: "c" })],
      }),
    });
    expect(plan.rows.map((row) => row.recipeId)).toEqual(["a", "b"]);
  });

  it("seats only the row --recipe names, whatever the ranking says", () => {
    const plan = planSeat({
      unseatable: new Map(),
      id: "abcdef12-3456",
      limit: 10,
      recipeId: "growth-ops",
      report: report({
        rows: [reportRow({ recipeId: "resync-corpus-notion" }), reportRow({ recipeId: "growth-ops" })],
      }),
    });
    expect(plan.rows.map((row) => row.recipeId)).toEqual(["growth-ops"]);
  });

  it("seats nothing when the row --recipe names is not seatable", () => {
    const plan = planSeat({
      unseatable: new Map(),
      id: "abcdef12-3456",
      limit: 10,
      recipeId: "growth-ops",
      report: report({ rows: [reportRow({ recipeId: "growth-ops", shape: "run-here" })] }),
    });
    expect(plan.rows).toEqual([]);
  });

  it("steps past a row the ledger refuses and fills the limit from the rows behind it, naming what it skipped", () => {
    const refused = { recipeId: "a", slotIso: "2026-09-15T20:00:00.000Z", why: COOLING_WHY };
    const plan = planSeat({
      id: "abcdef12-3456",
      limit: 2,
      recipeId: null,
      report: report({
        rows: [reportRow({ recipeId: "a" }), reportRow({ recipeId: "b" }), reportRow({ recipeId: "c" })],
      }),
      unseatable: new Map([["a", refused]]),
    });
    expect(plan.rows.map((row) => row.recipeId)).toEqual(["b", "c"]);
    expect(plan.skipped).toEqual([refused]);
  });

  it("names no refused row it never reached, because the limit filled first", () => {
    const plan = planSeat({
      id: "abcdef12-3456",
      limit: 2,
      recipeId: null,
      report: report({
        rows: [reportRow({ recipeId: "a" }), reportRow({ recipeId: "b" }), reportRow({ recipeId: "c" })],
      }),
      unseatable: new Map([["c", { recipeId: "c", slotIso: "2026-09-15T20:00:00.000Z", why: COOLING_WHY }]]),
    });
    expect(plan.rows.map((row) => row.recipeId)).toEqual(["a", "b"]);
    expect(plan.skipped).toEqual([]);
  });

  it("steps past the row --recipe names when the ledger refuses that one row", () => {
    const refused = { recipeId: "growth-ops", slotIso: "2026-09-15T20:00:00.000Z", why: COOLING_WHY };
    const plan = planSeat({
      id: "abcdef12-3456",
      limit: 10,
      recipeId: "growth-ops",
      report: report({
        rows: [reportRow({ recipeId: "resync-corpus-notion" }), reportRow({ recipeId: "growth-ops" })],
      }),
      unseatable: new Map([["growth-ops", refused]]),
    });
    expect(plan.rows).toEqual([]);
    expect(plan.skipped).toEqual([refused]);
  });

  it("writes one skip line per refused row, carrying the ledger's own words", () => {
    expect(
      unseatableSkipLine({ row: { recipeId: "resync-atlas-github", slotIso: "2026-09-15T23:00:00.000Z", why: "X" } }),
    ).toBe("recipe resync-atlas-github · slot 2026-09-15T23:00:00.000Z · X · skipped, not seated");
  });

  it("names the board row after the seat, so two seats never collide", () => {
    const plan = planSeat({
      unseatable: new Map(),
      id: "abcdef12-3456",
      limit: 1,
      recipeId: null,
      report: report({ rows: [reportRow()] }),
    });
    expect(plan.slug).toBe("automations-seat-abcdef12");
  });
});
