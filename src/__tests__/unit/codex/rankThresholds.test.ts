/**
 * The Codex ranking judged under a register's own thresholds: a pause bar that is not the default moves the verdict.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import { NOW, rankCodexPlans, weeklyAt } from "./rankFixtures.js";

const RESET = "2026-09-29T12:00:00.000Z";

describe("ranking under register thresholds", () => {
  it("ranks a 92% week under the default 99% bar", () => {
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [weeklyAt({ alias: "codex-92", percent: 92 })],
      thresholds: DEFAULT_THRESHOLDS.codex,
    });

    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-92"]);
    expect(ranking.excluded).toEqual([]);
  });

  it("pauses the same 92% week once the register's pause bar is 90, naming that bar", () => {
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [weeklyAt({ alias: "codex-92", percent: 92 })],
      thresholds: { alertAtPercent: 60, pauseAtPercent: 90 },
    });

    expect(ranking.ranked).toEqual([]);
    expect(ranking.excluded).toEqual([
      {
        destination: { alias: "codex-92", codexHome: "/homes/codex-92" },
        kind: "near-cap",
        reason: `weekly window at 92% used, resets ${RESET} — paused for new work at 90% (about 10 percent left)`,
      },
    ]);
  });

  it("keeps a week at 89% in the pool under a pause bar of 90", () => {
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [weeklyAt({ alias: "codex-89", percent: 89 })],
      thresholds: { alertAtPercent: 60, pauseAtPercent: 90 },
    });

    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-89"]);
  });
});
