/*
 * `measureFleetCeiling` — the seats that ran: each supervisor tick weighted by how long it held, a gap over 40
 * minutes counted as unknown, the span clipped and read exactly as it stood at its end, and an unparseable tick
 * named and counted nowhere. Every figure is worked out by hand in the test that asserts it.
 */
import { describe, expect, it } from "vitest";
import type { SeatTickSample } from "../../../../capacity/seatBurn.js";
import { unwrap } from "../../../../lib/result.js";
import { HOUR_FROM, HOUR_TO, measureFleetCeiling, tick, weekly } from "../seatCeilingFixtures.js";

describe("measureFleetCeiling — the seats that ran", () => {
  it("weights each tick by how long it held, counts a gap over 40 minutes as unknown, and holds the last tick 40 minutes", () => {
    // 00:00 w2 o10 holds 20m; 00:20 w4 o12 holds 30m; 00:50 w6 o14 is followed by a 70-minute gap, so holds
    // nothing; 02:00 w2 o8 holds 30m; 02:30 w2 o10 is the last tick and holds 40m to 03:10, not to 06:00.
    // Covered 120m; working 40+120+60+80 = 300 seat-min; open 200+360+240+400 = 1200 seat-min.
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly(),
        fromIso: "2026-10-04T00:00:00.000Z",
        problems: [],
        samples: [],
        ticks: [
          tick({ at: "2026-10-04T02:30:00.000Z", open: 10, working: 2 }),
          tick({ at: "2026-10-04T00:00:00.000Z", open: 10, working: 2 }),
          tick({ at: "2026-10-04T00:50:00.000Z", open: 14, working: 6 }),
          tick({ at: "2026-10-04T00:20:00.000Z", open: 12, working: 4 }),
          tick({ at: "2026-10-04T02:00:00.000Z", open: 8, working: 2 }),
        ],
        toIso: "2026-10-04T06:00:00.000Z",
      }),
    );
    expect(report.seats).toEqual({
      coveredHours: 2,
      meanOpenSeats: 10,
      meanWorkingSeats: 2.5,
      peakOpenSeats: 14,
      peakWorkingSeats: 6,
      samples: 5,
      unknownHours: 4,
      widestGapSeconds: 4200,
      workingSeatHours: 5,
    });
  });

  it("holds a tick across a gap of exactly 40 minutes", () => {
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly(),
        fromIso: "2026-10-04T00:00:00.000Z",
        problems: [],
        samples: [],
        ticks: [
          tick({ at: "2026-10-04T00:00:00.000Z", open: 1, working: 1 }),
          tick({ at: "2026-10-04T00:40:00.000Z", open: 1, working: 1 }),
        ],
        toIso: "2026-10-04T02:00:00.000Z",
      }),
    );
    // 40m held by the first tick, 40m by the last.
    expect(report.seats.coveredHours).toBeCloseTo(80 / 60, 12);
    expect(report.seats.unknownHours).toBeCloseTo(40 / 60, 12);
  });

  it("clips to the span, and takes peaks only from ticks observed inside it", () => {
    // 00:50 w9 o18 (before the span) holds to 01:30, clipped to 01:00 → 30m; 01:30 w6 o9 is the last tick read and
    // holds to the span's end → 30m; 02:10 w20 is after the span and never read. Working 270 + 180 = 450 seat-min, open 540 + 270 = 810.
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly(),
        fromIso: "2026-10-04T01:00:00.000Z",
        problems: [],
        samples: [],
        ticks: [
          tick({ at: "2026-10-04T00:50:00.000Z", open: 18, working: 9 }),
          tick({ at: "2026-10-04T01:30:00.000Z", open: 9, working: 6 }),
          tick({ at: "2026-10-04T02:10:00.000Z", open: 40, working: 20 }),
        ],
        toIso: "2026-10-04T02:00:00.000Z",
      }),
    );
    expect(report.seats).toEqual({
      coveredHours: 1,
      meanOpenSeats: 13.5,
      meanWorkingSeats: 7.5,
      peakOpenSeats: 9,
      peakWorkingSeats: 6,
      samples: 1,
      unknownHours: 0,
      widestGapSeconds: null,
      workingSeatHours: 7.5,
    });
  });

  it("reads a span exactly as it stood at its end, so a tick after it cannot drop the last tick's stretch", () => {
    // 01:20 → 02:10 is 50 minutes, but 02:10 is after the span: 01:20 is the last tick seen and holds 40m to 02:00.
    const measure = ({ ticks }: { ticks: readonly SeatTickSample[] }) =>
      unwrap(
        measureFleetCeiling({
          plans: weekly(),
          fromIso: "2026-10-04T01:00:00.000Z",
          problems: [],
          samples: [],
          ticks,
          toIso: "2026-10-04T02:00:00.000Z",
        }),
      );
    const seen = tick({ at: "2026-10-04T01:20:00.000Z", open: 9, working: 6 });
    const report = measure({ ticks: [seen, tick({ at: "2026-10-04T02:10:00.000Z", open: 40, working: 20 })] });
    expect(report.seats).toEqual(measure({ ticks: [seen] }).seats);
    expect(report.seats.coveredHours).toBeCloseTo(40 / 60, 12);
    expect(report.seats.unknownHours).toBeCloseTo(20 / 60, 12);
    expect(report.seats.meanWorkingSeats).toBe(6);
  });

  it("reports no means and no peaks when no tick saw the fleet, and the whole span as unknown", () => {
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly(),
        fromIso: HOUR_FROM,
        problems: [],
        samples: [],
        ticks: [],
        toIso: HOUR_TO,
      }),
    );
    expect(report.seats).toEqual({
      coveredHours: 0,
      meanOpenSeats: null,
      meanWorkingSeats: null,
      peakOpenSeats: null,
      peakWorkingSeats: null,
      samples: 0,
      unknownHours: 1,
      widestGapSeconds: null,
      workingSeatHours: 0,
    });
  });

  it("names a tick whose instant does not parse and counts it nowhere", () => {
    const report = unwrap(
      measureFleetCeiling({
        plans: weekly(),
        fromIso: HOUR_FROM,
        problems: [],
        samples: [],
        ticks: [tick({ at: "nope", open: 9, working: 9 })],
        toIso: HOUR_TO,
      }),
    );
    expect(report.problems).toEqual(['a tick at "nope" carries an instant that does not parse, and was not counted']);
    expect(report.seats.samples).toBe(0);
  });
});
