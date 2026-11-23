/**
 * `handover wake`'s reseats rotate past a park whose spawn keeps failing: a failed
 * spawn leaves the park and its due instant standing, so age alone would hand it the turn on every tick. Parks
 * never attempted go first, then the least recently attempted, read off the wake journal's own attempt rows.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { HandoverWakeDeps } from "../../../../../../cli/commands/handover/wakeRows.js";
import { removeFixtureDirs } from "../../turn/dispatch/harness.js";
import { NOW, record } from "./fixtures.js";
import { fakes, mintWakeHome, parkedRow, stillParked, wakeJson } from "./harness.js";

describe("handover wake's reseat rotation", () => {
  beforeEach(() => {
    mintWakeHome();
  });

  afterEach(() => {
    removeFixtureDirs();
  });

  it("attempts a park never attempted ahead of the ones whose spawn failed last run", async () => {
    for (const [index, slug] of ["a", "b", "c", "d"].entries()) {
      parkedRow({
        parkedAtIso: `2026-10-15T02:1${String(index)}:00.000Z`,
        slug,
        wake: { atIso: "2026-10-15T01:00:00.000Z", kind: "at" },
      });
    }
    const first = record();
    await wakeJson({ deps: fakes({ exitCode: 1, recorded: first }), recorded: first });
    const second = record();
    const later = new Date(NOW.getTime() + 5 * 60_000);
    const deps: HandoverWakeDeps = { ...fakes({ exitCode: 1, recorded: second }), now: () => later };
    const { report } = await wakeJson({ deps, recorded: second });
    expect([first.spawned, second.spawned]).toEqual([
      ["a", "b", "c"],
      ["d", "a", "b"],
    ]);
    expect(report.rows.map((row) => [row.slug, row.action])).toEqual([
      ["a", "spawn-failed"],
      ["b", "spawn-failed"],
      ["c", "due-deferred"],
      ["d", "spawn-failed"],
    ]);
    expect(["a", "b", "c", "d"].map((slug) => stillParked({ slug }))).toEqual([true, true, true, true]);
  });
});
