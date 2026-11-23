/**
 * `judgeRecipeTolerance` — how late a due row is, in a band derived from its OWN cadence.
 *
 * The point every case here defends is that there is no constant to tune: an hourly row and a daily row
 * that are each 40 minutes late are in different bands, and the boundary between them is the comparison
 * between elapsed and remaining rather than a number this repository picked.
 */
import { describe, expect, it } from "vitest";

import { judgeRecipeTolerance } from "../../../../live/automation/definitionTolerance.js";

const HOURLY = "0 * * * *";
const EVERY_FIVE_MINUTES = "*/5 * * * *";
const EVERY_TEN_MINUTES = "*/10 * * * *";

describe("judgeRecipeTolerance", () => {
  it("is comfortable while more of the period remains than has elapsed", () => {
    const tolerance = judgeRecipeTolerance({
      cadence: HOURLY,
      firingsSinceWatermark: 1,
      nowIso: "2026-09-08T12:20:00.000Z",
    });
    expect(tolerance.band).toBe("comfortable");
    expect(tolerance.lateByMs).toBe(20 * 60 * 1000);
    expect(tolerance.nextFiringInMs).toBe(40 * 60 * 1000);
  });

  it("turns urgent once the next firing is nearer than the time already elapsed", () => {
    const tolerance = judgeRecipeTolerance({
      cadence: HOURLY,
      firingsSinceWatermark: 1,
      nowIso: "2026-09-08T12:40:00.000Z",
    });
    expect(tolerance.band).toBe("urgent");
    expect(tolerance.lateByMs).toBe(40 * 60 * 1000);
    expect(tolerance.nextFiringInMs).toBe(20 * 60 * 1000);
  });

  it("is exactly urgent at the period's midpoint, where remaining equals elapsed", () => {
    const tolerance = judgeRecipeTolerance({
      cadence: HOURLY,
      firingsSinceWatermark: 1,
      nowIso: "2026-09-08T12:30:00.000Z",
    });
    expect(tolerance.band).toBe("urgent");
    expect(tolerance.lateByMs).toBe(30 * 60 * 1000);
    expect(tolerance.nextFiringInMs).toBe(30 * 60 * 1000);
  });

  it("calls the SAME lateness comfortable on a slow row and urgent on a fast one", () => {
    // Minute cadences on purpose: `cron-parser` reads an expression in the installation's LOCAL time, so an
    // hour-anchored cadence would make this comparison depend on the machine's offset. Both rows below are
    // four minutes past their own firing, which is comfortable inside ten and urgent inside five.
    const slow = judgeRecipeTolerance({
      cadence: EVERY_TEN_MINUTES,
      firingsSinceWatermark: 1,
      nowIso: "2026-09-08T12:04:00.000Z",
    });
    const fast = judgeRecipeTolerance({
      cadence: EVERY_FIVE_MINUTES,
      firingsSinceWatermark: 1,
      nowIso: "2026-09-08T12:04:00.000Z",
    });
    expect(slow.band).toBe("comfortable");
    expect(fast.band).toBe("urgent");
    expect(slow.lateByMs).toBe(4 * 60 * 1000);
    expect(fast.lateByMs).toBe(4 * 60 * 1000);
  });

  it("is overdue the moment a whole firing has been missed, whatever the spans say", () => {
    const tolerance = judgeRecipeTolerance({
      cadence: HOURLY,
      firingsSinceWatermark: 3,
      nowIso: "2026-09-08T12:05:00.000Z",
    });
    expect(tolerance.band).toBe("overdue");
    expect(tolerance.lateByMs).toBe(5 * 60 * 1000);
  });

  it("reports an unreadable cadence as its own band rather than as comfortable", () => {
    const tolerance = judgeRecipeTolerance({
      cadence: "not a cron expression",
      firingsSinceWatermark: 1,
      nowIso: "2026-09-08T12:05:00.000Z",
    });
    expect(tolerance.band).toBe("unschedulable");
    expect(tolerance.lateByMs).toBe(null);
    expect(tolerance.nextFiringInMs).toBe(null);
  });
});
