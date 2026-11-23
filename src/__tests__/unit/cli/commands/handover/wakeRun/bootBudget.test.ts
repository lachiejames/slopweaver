/**
 * `handover wake`'s reseats count against the 180-second boot window: a run attempts the wake's share of the
 * window less the boots already in flight, so the chair's own fill behind it is never starved.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EXIT_DEFERRED, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { removeFixtureDirs } from "../../turn/dispatch/harness.js";
import { PAST, record } from "./fixtures.js";
import { fakes, mintWakeHome, parkedRow, wakeJson } from "./harness.js";

describe("runHandoverWake's boot budget", () => {
  beforeEach(() => {
    mintWakeHome();
  });

  afterEach(() => {
    removeFixtureDirs();
  });

  it("attempts one fewer reseat for every boot already in flight", async () => {
    ["a", "b", "c"].forEach((slug) => {
      parkedRow({ slug, wake: { atIso: PAST, kind: "at" } });
    });
    const recorded = record();
    const { code, report } = await wakeJson({ deps: fakes({ bootsInFlight: 1, recorded }), recorded });
    expect([code, report.maxSpawns, report.bootsInFlight, recorded.spawned]).toEqual([EXIT_OK, 2, 1, ["a", "b"]]);
    expect([report.rows[2]!.action, report.rows[2]!.detail]).toEqual([
      "due-deferred",
      "over this run's 2-reseat budget: the wake fills at most 3 of the 180-second boot window, 1 already booted in it, and the rest is the chair's fill",
    ]);
  });

  it("attempts nothing once the window holds its share, and exits 4 so the parks stay owed", async () => {
    parkedRow({ slug: "owed", wake: { atIso: PAST, kind: "at" } });
    const recorded = record();
    const { code, report } = await wakeJson({ deps: fakes({ bootsInFlight: 5, recorded }), recorded });
    expect([code, report.maxSpawns, report.attempted, recorded.spawned, report.rows[0]!.action]).toEqual([
      EXIT_DEFERRED,
      0,
      0,
      [],
      "due-deferred",
    ]);
  });

  it("still finishes a merged park with no budget left, which spends no boot", async () => {
    parkedRow({ slug: "landed", wake: { kind: "checks", number: 7, repo: "o/r" } });
    parkedRow({ slug: "owed", wake: { atIso: PAST, kind: "at" } });
    const recorded = record();
    const deps = fakes({ bootsInFlight: 3, checks: { 7: { prState: "MERGED" } }, finishes: { landed: 0 }, recorded });
    const { code, report } = await wakeJson({ deps, recorded });
    expect([code, recorded.finished, recorded.spawned]).toEqual([EXIT_OK, ["landed"], []]);
    expect(report.rows.map((row) => [row.slug, row.action])).toEqual([
      ["landed", "finished"],
      ["owed", "due-deferred"],
    ]);
  });

  it("names the spawn backoff, not the budget, on every row after the backoff deferred one", async () => {
    ["a", "b", "c", "d"].forEach((slug) => {
      parkedRow({ slug, wake: { atIso: PAST, kind: "at" } });
    });
    const recorded = record();
    const deps = fakes({ exitCodes: [0, 0, EXIT_DEFERRED], recorded });
    const { code, report } = await wakeJson({ deps, recorded });
    expect(code).toBe(EXIT_DEFERRED);
    // `d` is past the 3-reseat budget too; the backoff, the bound that shut the window, is what it names.
    expect(report.rows.map((row) => [row.action, row.detail.startsWith("the spawn backoff")])).toEqual([
      ["spawned", false],
      ["spawned", false],
      ["spawn-deferred", true],
      ["due-deferred", true],
    ]);
  });

  it("reads no boot window when nothing is due", async () => {
    parkedRow({ slug: "later", wake: { atIso: "2026-10-15T04:00:00Z", kind: "at" } });
    const recorded = record();
    const { report } = await wakeJson({ deps: fakes({ bootsInFlight: 2, recorded }), recorded });
    expect([report.bootsInFlight, report.maxSpawns]).toEqual([0, 3]);
  });
});
