/*
 * `latestGauge` — the latest OBSERVED reading by instant, never by list position or string order.
 */
import { describe, expect, it } from "vitest";
import { parseGaugeLine } from "../../../../codex/gauge.js";
import { latestGauge } from "../../../../codex/gaugeScan.js";
import { REAL_HEALTHY_WEEKLY_LINE, REAL_WEEKLY_EXHAUSTED_LINE } from "../../../codexRolloutLines.js";

describe("latestGauge", () => {
  it("returns undefined when no file held a reading", () => {
    expect(latestGauge({ gauges: [] })).toBeUndefined();
  });

  it("picks the latest OBSERVED reading, not the one that came last in the list", () => {
    const older = parseGaugeLine({ line: REAL_WEEKLY_EXHAUSTED_LINE })!;
    const newer = parseGaugeLine({ line: REAL_HEALTHY_WEEKLY_LINE })!;

    expect(latestGauge({ gauges: [newer, older] })?.observedAtIso).toBe("2026-09-13T05:51:14.803Z");
    expect(latestGauge({ gauges: [older, newer] })?.observedAtIso).toBe("2026-09-13T05:51:14.803Z");
  });

  it("does NOT pick an offset timestamp that sorts higher but is the EARLIER instant", () => {
    // The +01:00 offset reading is 31 minutes BEFORE the other reading — while sorting above it as a string.
    // Found by a Codex review of this function on exactly this pair; `quotaGate.ts` already parsed and this
    // one did not, which made it the same defect in two places rather than one rule with an exception.
    const utc = { ...parseGaugeLine({ line: REAL_HEALTHY_WEEKLY_LINE })!, observedAtIso: "2026-09-11T07:31:24.319Z" };
    const offset = {
      ...parseGaugeLine({ line: REAL_WEEKLY_EXHAUSTED_LINE })!,
      observedAtIso: "2026-09-11T08:00:00+01:00",
    };

    expect(latestGauge({ gauges: [utc, offset] })?.observedAtIso).toBe("2026-09-11T07:31:24.319Z");
    expect(latestGauge({ gauges: [offset, utc] })?.observedAtIso).toBe("2026-09-11T07:31:24.319Z");
  });

  it("DOES pick an offset timestamp that is genuinely the later instant", () => {
    const utc = { ...parseGaugeLine({ line: REAL_HEALTHY_WEEKLY_LINE })!, observedAtIso: "2026-09-11T07:31:24.319Z" };
    const offset = {
      ...parseGaugeLine({ line: REAL_WEEKLY_EXHAUSTED_LINE })!,
      observedAtIso: "2026-09-11T09:00:00+01:00",
    };

    expect(latestGauge({ gauges: [utc, offset] })?.observedAtIso).toBe("2026-09-11T09:00:00+01:00");
  });

  it("never prefers a reading whose instant will not parse over one that does", () => {
    const readable = parseGaugeLine({ line: REAL_HEALTHY_WEEKLY_LINE })!;
    const unreadable = { ...parseGaugeLine({ line: REAL_WEEKLY_EXHAUSTED_LINE })!, observedAtIso: "whenever" };

    expect(latestGauge({ gauges: [readable, unreadable] })?.observedAtIso).toBe("2026-09-13T05:51:14.803Z");
    expect(latestGauge({ gauges: [unreadable, readable] })?.observedAtIso).toBe("2026-09-13T05:51:14.803Z");
  });

  it("still returns an undatable reading when it is the only one there is", () => {
    const unreadable = { ...parseGaugeLine({ line: REAL_WEEKLY_EXHAUSTED_LINE })!, observedAtIso: "whenever" };

    expect(latestGauge({ gauges: [unreadable] })?.observedAtIso).toBe("whenever");
  });
});
