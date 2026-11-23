/**
 * The ceilings reading as text — `machine capacity`'s lines and the briefing's one clause. Exact strings, so a
 * dropped window, reset or reason reddens here.
 */
import { describe, expect, it } from "vitest";

import { buildCeilingsReading, type ClaudePlanInput } from "../../../capacity/ceilings.js";
import { ceilingLines, unusedNowClause } from "../../../capacity/ceilingsRender.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";

const NOW = "2026-09-28T09:00:00.000Z";

/** A read Claude plan at these utilisations, every window resetting at the fixture reset instant. */
function claude({ alias, sevenDay, fable }: { alias: string; sevenDay: number; fable?: number }): ClaudePlanInput {
  const window = ({ utilization }: { utilization: number }) => ({
    resetAtIso: "2026-10-01T00:00:00.000Z",
    status: "allowed" as const,
    utilization,
  });
  return {
    account: `${alias}@example.test`,
    gauge: {
      alias,
      allowance: { kind: "weekly-window" },
      fiveHour: window({ utilization: 0.22 }),
      observedAtIso: NOW,
      sevenDay: window({ utilization: sevenDay }),
      usageLimitPercent: 100,
      ...(fable === undefined ? {} : { sevenDayFable: window({ utilization: fable }) }),
    },
    kind: "read",
  };
}

/** A reading with a free machine, one Claude plan at 35% of its week with Fable nearly spent, and a failed Codex read. */
const OPEN = buildCeilingsReading({
  machine: { hold: false, holdSubjects: [], idlePct: null, load1: 5.5, loadHold: 22 },
  observedAtIso: NOW,
  plans: {
    claude: [claude({ alias: "plan-two", fable: 0.9, sevenDay: 0.35 })],
    claudeThresholds: DEFAULT_THRESHOLDS.claude,
    codex: [],
    codexRoutedAlias: null,
    problems: ["codex fleet: app-server did not answer"],
  },
});

/** A reading whose machine holds on cpu. */
const HELD = buildCeilingsReading({
  machine: { hold: true, holdSubjects: ["cpu"], idlePct: null, load1: 32.31, loadHold: 22 },
  observedAtIso: NOW,
  plans: {
    claude: [claude({ alias: "plan-two", sevenDay: 0.36 })],
    claudeThresholds: DEFAULT_THRESHOLDS.claude,
    codex: [],
    codexRoutedAlias: null,
    problems: [],
  },
});

describe("ceilingLines", () => {
  it("heads with the lowest ceiling and the route a seat would take, then every window with its reset", () => {
    expect(ceilingLines({ reading: OPEN })).toStrictEqual([
      "ceilings: lowest unused is claude:plan-two — a seat can start now via claude on claude:plan-two, 65% headroom",
      "  machine open, 75% unused — load1 5.5/22",
      "  claude:plan-two open, 65% unused — five-hour 22/100 resets 2026-10-01T00:00Z · seven-day 35/100 resets " +
        "2026-10-01T00:00Z · fable-seven-day 90/100 resets 2026-10-01T00:00Z",
      "  could not read: codex fleet: app-server did not answer",
    ]);
  });

  it("says no seat can start on a held machine, with the hold's reason", () => {
    expect(ceilingLines({ reading: HELD }).slice(0, 2)).toStrictEqual([
      "ceilings: no seat can start now — lowest is machine",
      "  machine held, 0% unused — load1 32.31/22 (hold on cpu)",
    ]);
  });
});

describe("unusedNowClause", () => {
  it("names each ceiling's binding window, never the Fable week, and the lowest", () => {
    expect(unusedNowClause({ reading: OPEN })).toBe(
      "unused now: machine 75% (load1 5.5/22), claude:plan-two 65% (seven-day 35/100 resets 2026-10-01T00:00Z); " +
        "lowest claude:plan-two",
    );
  });

  it("prefixes a ceiling that is not open with its status", () => {
    expect(unusedNowClause({ reading: HELD })).toBe(
      "unused now: machine 0% (held, load1 32.31/22), claude:plan-two 64% (seven-day 36/100 resets " +
        "2026-10-01T00:00Z); lowest machine",
    );
  });
});
