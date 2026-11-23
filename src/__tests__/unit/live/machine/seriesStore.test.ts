/**
 * The `machine series` ring on disk: written whole, owner-only, read back exactly, and every unreadable line an
 * error naming it rather than a skipped gap.
 */
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { machineSeriesPath, readMachineSeries, writeMachineSeries } from "../../../../live/machine/seriesStore.js";
import { sampleAt } from "./seriesFixtures.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "series-store-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/**
 * Put raw text where the ring lives.
 *
 * @returns nothing
 */
function writeRaw({ text }: { text: string }): void {
  const path = machineSeriesPath({ home });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

describe("machine series ring", () => {
  it("is empty on a home that never sampled", () => {
    expect(unwrap(readMachineSeries({ home }))).toEqual([]);
  });

  it("reads back exactly what it wrote, owner-only", () => {
    const samples = [
      sampleAt({ load1: 1, observedAtIso: "2026-10-17T19:59:40.000Z" }),
      sampleAt({ load1: 2, observedAtIso: "2026-10-17T20:00:00.000Z" }),
    ];
    unwrap(writeMachineSeries({ home, samples }));
    expect(unwrap(readMachineSeries({ home }))).toEqual(samples);
    expect(statSync(machineSeriesPath({ home })).mode & 0o777).toBe(0o600);
  });

  it("round-trips a row carrying top's idle percentage, exactly", () => {
    const samples = [sampleAt({ idlePct: 40.5, load1: 50, observedAtIso: "2026-10-17T20:00:00.000Z" })];
    unwrap(writeMachineSeries({ home, samples }));
    const read = unwrap(readMachineSeries({ home }));
    expect(read).toEqual(samples);
    expect(read[0]!.cpu.idlePct).toBe(40.5);
  });

  it("still reads a row written before idle was recorded, whose cpu carries no idle, without inventing one", () => {
    const old = sampleAt({ load1: 1, observedAtIso: "2026-10-17T20:00:00.000Z" });
    writeRaw({ text: `${JSON.stringify(old)}\n` });
    const read = unwrap(readMachineSeries({ home }));
    expect(read).toEqual([old]);
    expect(Object.hasOwn(read[0]!.cpu, "idlePct")).toBe(false);
  });

  it("refuses an idle percentage over 100 or under 0", () => {
    for (const idlePct of [100.1, -1]) {
      const bad = sampleAt({ idlePct, load1: 1, observedAtIso: "2026-10-17T20:00:00.000Z" });
      writeRaw({ text: `${JSON.stringify(bad)}\n` });
      expect(unwrapErr(readMachineSeries({ home })).code).toBe("SERIES_ROW_INVALID");
    }
  });

  it("names a line that is not JSON", () => {
    const good = JSON.stringify(sampleAt({ load1: 1, observedAtIso: "2026-10-17T20:00:00.000Z" }));
    writeRaw({ text: `${good}\n{not json\n` });
    const failure = unwrapErr(readMachineSeries({ home }));
    expect(failure.code).toBe("SERIES_ROW_MALFORMED");
    expect(failure.message).toContain("line 2");
  });

  it("names a line that is JSON but not a sample", () => {
    const extra = { ...sampleAt({ load1: 1, observedAtIso: "2026-10-17T20:00:00.000Z" }), extra: true };
    writeRaw({ text: `${JSON.stringify(extra)}\n` });
    const failure = unwrapErr(readMachineSeries({ home }));
    expect(failure.code).toBe("SERIES_ROW_INVALID");
    expect(failure.message).toContain("line 1");
  });

  it("refuses a negative figure", () => {
    const negative = sampleAt({ load1: -1, observedAtIso: "2026-10-17T20:00:00.000Z" });
    writeRaw({ text: `${JSON.stringify(negative)}\n` });
    expect(unwrapErr(readMachineSeries({ home })).code).toBe("SERIES_ROW_INVALID");
  });
});
