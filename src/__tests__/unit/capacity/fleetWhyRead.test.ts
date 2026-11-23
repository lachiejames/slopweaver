import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readFleetWhyReport } from "../../../capacity/fleetWhyRead.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { recordReading } from "../../../readings/store.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/** A throwaway state home this test may write into — never the ambient one. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-fleet-why-"));
  homes.push(dir);
  return dir;
}

/** The fields of a `machine capacity --json` document the report reads, held on cpu at 26.61. */
const MACHINE = {
  cpuHogs: {
    cpuAttributed: true,
    hogs: [
      { classification: "foreign", cpuPct: 60, label: "WindowServer" },
      { classification: "fleet", cpuPct: 30, label: "node" },
      { classification: "fleet", cpuPct: 40, label: "claude", sessionId: "s-1" },
    ],
  },
  fleet: { sessions: [{ cpuPct: 200 }] },
  hiddenCpu: { busyCores: 9.5, hiddenFromTop: ["mds"], unattributedCores: 3 },
  hold: true,
  holdSubjects: ["cpu"],
  load: { load1: 26.61 },
  loadHold: 22,
};

/** Record one document as `producer`'s reading, observed and recorded at `atIso`, by tick-27. */
function record({
  dir,
  producer,
  document,
  atIso,
}: {
  dir: string;
  producer: string;
  document: unknown;
  atIso: string;
}) {
  return unwrap(
    recordReading({
      by: "tick-27",
      document: JSON.stringify(document),
      home: dir,
      nowIso: atIso,
      observedAtIso: atIso,
      producer,
    }),
  );
}

/** One coherent tick: the held machine, a measured ceiling of four, five working seats. */
function tick({ dir }: { dir: string }): void {
  record({ atIso: "2026-10-09T14:40:00.000Z", dir, document: MACHINE, producer: "machine capacity" });
  record({
    atIso: "2026-10-09T14:40:00.000Z",
    dir,
    document: {
      ceiling: {
        burnPerWorkingSeatHour: 0.00390625,
        kind: "measured",
        seats: 4,
        sustainablePlanWeeksPerHour: 0.015625,
      },
    },
    producer: "fleet ceiling",
  });
  record({
    atIso: "2026-10-09T14:40:00.000Z",
    dir,
    document: { rows: [1, 2, 3, 4, 5].map(() => ({ signal: "working" })).concat([{ signal: "idle" }]) },
    producer: "session watch",
  });
}

describe("readFleetWhyReport", () => {
  it("refuses a window that is not one before reading the ledger", () => {
    const refused = unwrapErr(readFleetWhyReport({ home: home(), minutes: 60, nowIso: "teatime" }));
    expect([refused.code, refused.message]).toEqual([
      "INVALID_WINDOW",
      "the window 60 minutes to teatime is not a whole number of minutes to an instant",
    ]);
  });

  it("refuses when the ledger itself will not read, rather than reporting an empty window", () => {
    const dir = home();
    const gone = record({ atIso: "2026-10-09T14:40:00.000Z", dir, document: MACHINE, producer: "machine capacity" });
    rmSync(gone.documentPath);
    const refused = unwrapErr(readFleetWhyReport({ home: dir, minutes: 60, nowIso: "2026-10-09T15:00:00.000Z" }));
    expect(refused.code).toBe("LEDGER_UNREADABLE");
    expect(refused.message).toContain(gone.documentPath);
  });

  it("reads one coherent tick and the window's readings off the ledger", () => {
    const dir = home();
    tick({ dir });
    const report = unwrap(readFleetWhyReport({ home: dir, minutes: 60, nowIso: "2026-10-09T15:00:00.000Z" }));
    expect(report.binding).toBe("both");
    expect(report.current.working).toBe(5);
    expect(report.current.tick).toBe("tick-27");
    expect(report.problems).toEqual([]);
    expect(report.window.readings).toBe(1);
    // The session's 200% already sums its tree, so only the unowned `node` hog is added beside it.
    expect(report.window.fleetCpuPct).toEqual({ last: 230, max: 230, mean: 230, min: 230 });
    expect(report.window.topForeign).toEqual([{ label: "WindowServer", meanCapturedCpuPct: 60, readingsSeen: 1 }]);
    expect(report.window.hiddenFromTop).toEqual([{ label: "mds", readings: 1 }]);
  });

  it("names a window reading that will not decode and leaves it out", () => {
    const dir = home();
    const broken = record({
      atIso: "2026-10-09T14:20:00.000Z",
      dir,
      document: { load: {} },
      producer: "machine capacity",
    });
    tick({ dir });
    const report = unwrap(readFleetWhyReport({ home: dir, minutes: 60, nowIso: "2026-10-09T15:00:00.000Z" }));
    expect(report.window.readings).toBe(1);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toContain(`${broken.record.readingId} will not decode, so the window leaves it out`);
  });

  it("refuses a capture whose idle is not a percentage, and reads one whose idle is", () => {
    const dir = home();
    const broken = record({
      atIso: "2026-10-09T14:20:00.000Z",
      dir,
      document: { ...MACHINE, hiddenCpu: { ...MACHINE.hiddenCpu, idlePct: 101 } },
      producer: "machine capacity",
    });
    record({
      atIso: "2026-10-09T14:30:00.000Z",
      dir,
      document: { ...MACHINE, hiddenCpu: { ...MACHINE.hiddenCpu, idlePct: 12.5 } },
      producer: "machine capacity",
    });
    tick({ dir });
    const report = unwrap(readFleetWhyReport({ home: dir, minutes: 60, nowIso: "2026-10-09T15:00:00.000Z" }));
    expect(report.window.readings).toBe(2);
    expect(report.problems).toEqual([
      `${broken.record.readingId} will not decode, so the window leaves it out: hiddenCpu.idlePct: Too big: expected number to be <=100`,
    ]);
  });

  it("passes over a reading that claims an instant after --now, though recorded before it, to the tick before", () => {
    const dir = home();
    tick({ dir });
    unwrap(
      recordReading({
        by: "tick-28",
        document: JSON.stringify({ rows: [] }),
        home: dir,
        nowIso: "2026-10-09T14:50:00.000Z",
        observedAtIso: "2026-10-09T15:30:00.000Z",
        producer: "session watch",
      }),
    );
    const report = unwrap(readFleetWhyReport({ home: dir, minutes: 60, nowIso: "2026-10-09T15:00:00.000Z" }));
    expect([report.binding, report.current.tick, report.current.working, report.problems]).toEqual([
      "both",
      "tick-27",
      5,
      [],
    ]);
  });

  it("reads only what was recorded by --now, so a replay agrees with the tick", () => {
    const dir = home();
    tick({ dir });
    const report = unwrap(readFleetWhyReport({ home: dir, minutes: 60, nowIso: "2026-10-09T14:30:00.000Z" }));
    expect(report.binding).toBe("unknown");
    expect(report.window.readings).toBe(0);
    expect(report.problems).toEqual([
      "no machine capacity reading is recorded",
      "no fleet ceiling reading is recorded",
      "no session watch reading is recorded",
      "no usable machine capacity, fleet ceiling, session watch reading, so what binds the fleet is not known",
    ]);
  });

  it("says a recorded machine reading would not decode, rather than that none was recorded", () => {
    const dir = home();
    tick({ dir });
    const broken = record({
      atIso: "2026-10-09T14:45:00.000Z",
      dir,
      document: { load: {} },
      producer: "machine capacity",
    });
    const report = unwrap(readFleetWhyReport({ home: dir, minutes: 60, nowIso: "2026-10-09T15:00:00.000Z" }));
    expect(report.binding).toBe("unknown");
    expect(report.sentences[0]).toContain(
      `so what binds the fleet is not known: ${broken.record.readingId} will not decode, so the window leaves it out`,
    );
    expect(report.sentences[0]).toContain(
      `the latest machine capacity reading (${broken.record.readingId}) will not decode`,
    );
  });
});
