/**
 * `renderUnusedLines` — pure text rendering. Two report fixtures cover every line shape: one with an expired
 * row and no ticks (the "no supervisor tick" machine line), one with an open-only row, a real machine line and
 * two problems.
 */
import { describe, expect, it } from "vitest";
import type { UnusedCapacityReport } from "../../../capacity/unused.js";
import { renderUnusedLines } from "../../../capacity/unusedRender.js";

describe("renderUnusedLines", () => {
  it("renders an expired row's bound and the no-tick machine line", () => {
    const report: UnusedCapacityReport = {
      fromIso: "2026-09-21T00:00:00.000Z",
      machine: { heldPct: null, loadHold: 22, meanLoad1: null, ticks: 0, unusedLoadPct: null, widestGapSeconds: null },
      problems: [],
      toIso: "2026-09-28T00:00:00.000Z",
      windows: [
        {
          ceilingId: "claude:plan-two",
          expiredWindows: 2,
          firstObservedAtIso: "2026-09-21T00:00:00.000Z",
          lastObservedAtIso: "2026-09-21T19:30:00.000Z",
          open: null,
          samples: 5,
          unusedAtResetPct: 45,
          widestGapSeconds: 3600,
          widestLastReadingToResetSeconds: 16200,
          window: "five-hour",
        },
      ],
    };
    const lines = renderUnusedLines({ report });
    expect(lines[0]).toBe("unused capacity, 2026-09-21T00:00:00.000Z → 2026-09-28T00:00:00.000Z");
    expect(lines[2]).toBe("| ceiling | window | expired windows: unused at reset | open now | samples | widest gap |");
    expect(lines[4]).toBe(
      "| claude:plan-two | five-hour | ≤ 45% over 2 (last reading ≤ 4.5h before reset) | — | 5 | 1.0h |",
    );
    expect(lines[5]).toBe("");
    expect(lines[6]).toBe("machine: no supervisor tick read the machine in this span");
    expect(lines.length).toBe(7);
  });

  it("renders an open-only row's dash, the real machine line and every problem", () => {
    const report: UnusedCapacityReport = {
      fromIso: "2026-09-21T00:00:00.000Z",
      machine: { heldPct: 30, loadHold: 22, meanLoad1: 5.234, ticks: 10, unusedLoadPct: 64, widestGapSeconds: 5400 },
      problems: [
        "codex: the plan register could not be read",
        "1 reading(s) carried an instant that does not parse, and were not counted",
      ],
      toIso: "2026-09-28T00:00:00.000Z",
      windows: [
        {
          ceilingId: "codex:default",
          expiredWindows: 0,
          firstObservedAtIso: "2026-09-27T10:00:00.000Z",
          lastObservedAtIso: "2026-09-27T12:00:00.000Z",
          open: { resetAtIso: "2026-09-29T00:00:00.000Z", usedPct: 22 },
          samples: 3,
          unusedAtResetPct: null,
          widestGapSeconds: 7200,
          widestLastReadingToResetSeconds: null,
          window: "weekly",
        },
      ],
    };
    const lines = renderUnusedLines({ report });
    expect(lines[4]).toBe("| codex:default | weekly | — | 78% unused, resets 2026-09-29T00:00:00.000Z | 3 | 2.0h |");
    expect(lines[6]).toBe(
      "machine: 64% of the load hold (22, today's) left free on average over 10 ticks; mean 1-minute load 5.2; " +
        "30% of ticks read a hold; widest gap between ticks 1.5h",
    );
    expect(lines[7]).toBe("could not see: codex: the plan register could not be read");
    expect(lines[8]).toBe("could not see: 1 reading(s) carried an instant that does not parse, and were not counted");
    expect(lines.length).toBe(9);
  });
});
