/**
 * The two seat figures the fleet-ceiling page and its Queue card both speak: how a count is written, and the
 * whole-seat headroom worked out so the owner never subtracts.
 */
import { describe, expect, it } from "vitest";

import { seatFigure, seatHeadroom } from "../../../../live/automation/fleetCeilingFigures.js";
import { measuredFleetCeilingReport } from "../../../fleetCeilingReportFixture.js";

describe("seatFigure", () => {
  it("writes one decimal place and drops a trailing .0", () => {
    expect(seatFigure({ value: 4.24 })).toBe("4.2");
    expect(seatFigure({ value: 6 })).toBe("6");
  });

  it("spells out 999 and says over 999 past it", () => {
    expect(seatFigure({ value: 999 })).toBe("999");
    expect(seatFigure({ value: 999.01 })).toBe("over 999");
  });
});

describe("seatHeadroom", () => {
  it("counts only WHOLE seats the plans could have carried beyond the mean worked", () => {
    const report = measuredFleetCeilingReport({
      seats: { ...measuredFleetCeilingReport().seats, meanWorkingSeats: 4.2 },
    });
    expect(report.ceiling).toMatchObject({ kind: "measured", seats: 6 });
    expect(seatHeadroom({ report })).toBe(1);
  });

  it("never goes negative when the fleet worked past the ceiling", () => {
    const report = measuredFleetCeilingReport({
      seats: { ...measuredFleetCeilingReport().seats, meanWorkingSeats: 9 },
    });
    expect(seatHeadroom({ report })).toBe(0);
  });

  it("is null when the working mean is unmeasured", () => {
    const report = measuredFleetCeilingReport({
      seats: { ...measuredFleetCeilingReport().seats, meanWorkingSeats: null },
    });
    expect(seatHeadroom({ report })).toBeNull();
  });

  it("is null when the ceiling is unmeasurable", () => {
    const report = measuredFleetCeilingReport({
      ceiling: { kind: "unmeasurable", reason: "no plan reading is fresh" },
    });
    expect(seatHeadroom({ report })).toBeNull();
  });
});
