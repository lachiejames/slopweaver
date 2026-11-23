/**
 * `handover wake` attempts its due parks longest-due first, never in slug order, and still reports every row in
 * board order. MEASURED: in slug order, rows late in the alphabet waited indefinitely behind early
 * ones that re-parked within the hour.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { removeFixtureDirs } from "../../turn/dispatch/harness.js";
import { record } from "./fixtures.js";
import { fakes, mintWakeHome, parkedRow, stillParked, wakeJson } from "./harness.js";

describe("runHandoverWake's order", () => {
  beforeEach(() => {
    mintWakeHome();
  });

  afterEach(() => {
    removeFixtureDirs();
  });

  it("reseats the longest-due parks first, whatever their slugs, and defers the most recent", async () => {
    parkedRow({ slug: "a-recent", wake: { atIso: "2026-10-15T03:10:00Z", kind: "at" } });
    parkedRow({ slug: "b-recent", wake: { atIso: "2026-10-15T03:05:00Z", kind: "at" } });
    parkedRow({ slug: "y-old", wake: { atIso: "2026-10-15T02:30:00Z", kind: "at" } });
    parkedRow({ slug: "z-oldest", wake: { atIso: "2026-10-15T02:20:00Z", kind: "at" } });
    const recorded = record();
    const { code, report } = await wakeJson({ deps: fakes({ recorded }), recorded });
    expect([code, recorded.spawned]).toEqual([EXIT_OK, ["z-oldest", "y-old", "b-recent"]]);
    expect(report.rows.map((row) => [row.slug, row.action])).toEqual([
      ["a-recent", "due-deferred"],
      ["b-recent", "spawned"],
      ["y-old", "spawned"],
      ["z-oldest", "spawned"],
    ]);
    expect(stillParked({ slug: "a-recent" })).toBe(true);
  });

  it("counts a clock wake as due from the park when its instant had already passed", async () => {
    // Parked at 02:00 on an instant of 01:00: due since 02:00, so a park whose own instant is 01:30 goes first.
    parkedRow({
      parkedAtIso: "2026-10-15T02:00:00.000Z",
      slug: "a-stale-clock",
      wake: { atIso: "2026-10-15T01:00:00Z", kind: "at" },
    });
    parkedRow({
      parkedAtIso: "2026-10-15T01:00:00.000Z",
      slug: "b-earlier",
      wake: { atIso: "2026-10-15T01:30:00Z", kind: "at" },
    });
    const recorded = record();
    await wakeJson({ deps: fakes({ recorded }), recorded });
    expect(recorded.spawned).toEqual(["b-earlier", "a-stale-clock"]);
  });

  it("orders a checks wake by when it parked", async () => {
    parkedRow({
      parkedAtIso: "2026-10-15T02:40:00.000Z",
      slug: "a-checks",
      wake: { kind: "checks", number: 3, repo: "o/r" },
    });
    parkedRow({ slug: "b-clock", wake: { atIso: "2026-10-15T02:10:00Z", kind: "at" } });
    const recorded = record();
    await wakeJson({ deps: fakes({ checks: { 3: { prState: "CLOSED" } }, recorded }), recorded });
    expect(recorded.spawned).toEqual(["b-clock", "a-checks"]);
  });
});
