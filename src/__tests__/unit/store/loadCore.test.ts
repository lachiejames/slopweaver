/**
 * What a load is asked for, and what its report claims — both pure, and both places a number has already
 * gone wrong on this workstream.
 *
 * The recurring defect here is a number that reads as one thing and counts another: a facet percentage
 * that was of the page, a byte count that was of chunks touched, a row count that was of write operations.
 * So the assertions below are about the LABEL as much as the number — a capped leg must say what it
 * fetched as well as what it kept, because "10,000 records" and "10,000 of 11,266 records" are different
 * facts and only one of them is true.
 */
import { describe, expect, it } from "vitest";

import {
  LOAD_CAP,
  LOAD_DAYS,
  loadLines,
  loadSucceeded,
  loadWindow,
  sourceLoadLine,
} from "../../../cli/commands/store/loadCore.js";

const leg = ({
  source = "linear",
  fetched = 10,
  offered = 10,
  stored = 10,
  refused = 0,
  ok = true,
  errors = [],
  collapsed = 0,
}: {
  source?: "linear" | "slack" | "github" | "notion";
  fetched?: number;
  offered?: number;
  stored?: number;
  refused?: number;
  ok?: boolean;
  errors?: readonly string[];
  collapsed?: number;
} = {}) =>
  ({ collapsed, elapsedMs: 1_000, errors, fetched, offered, ok, refused, source, stored, warnings: [] }) as const;

describe("loadWindow", () => {
  it("ends TOMORROW, so a record written later today is inside the window rather than one day outside it", () => {
    expect(loadWindow({ now: new Date("2026-09-10T11:00:00.000Z") }).until).toBe("2026-09-11");
  });

  it("starts a week before today, which is the bound the owner set", () => {
    expect(loadWindow({ now: new Date("2026-09-10T11:00:00.000Z") }).since).toBe("2026-09-03");
  });

  it("takes a caller's own depth rather than the default when one is given", () => {
    expect(loadWindow({ days: 1, now: new Date("2026-09-10T11:00:00.000Z") }).since).toBe("2026-09-09");
  });

  it("defaults to the seven days the ruling named", () => {
    expect(LOAD_DAYS).toBe(7);
    expect(LOAD_CAP).toBe(10_000);
  });
});

describe("sourceLoadLine", () => {
  it("says what was fetched as well as what was kept, whenever the cap bound", () => {
    const line = sourceLoadLine({ cap: 10_000, result: leg({ fetched: 11_266, offered: 10_000, stored: 10_000 }) });
    expect(line).toContain("10000 row(s) written from 10000 record(s) fetched");
    expect(line).toContain("CAPPED at 10000 (11266 fetched)");
  });

  it("says nothing about a cap that did not bind, so the word means something when it appears", () => {
    expect(sourceLoadLine({ cap: 10_000, result: leg() })).not.toContain("CAPPED");
  });

  it("counts refused records separately from written ones", () => {
    expect(sourceLoadLine({ cap: 10_000, result: leg({ refused: 4 }) })).toContain("4 record(s) refused");
  });

  it("accounts for the gap between offered and written, rather than leaving a reader to assume a bug", () => {
    const line = sourceLoadLine({ cap: 10_000, result: leg({ collapsed: 95, offered: 10_000, stored: 9_905 }) });
    expect(line).toContain("9905 row(s) written from 10000 record(s) fetched");
    expect(line).toContain("95 collapsed as repeats");
  });

  it("reports a failed leg as FAILED with its own reason, never as zero rows", () => {
    const line = sourceLoadLine({ cap: 10_000, result: leg({ errors: ["no slack token"], ok: false }) });
    expect(line).toContain("FAILED");
    expect(line).toContain("no slack token");
  });
});

describe("loadLines", () => {
  it("states that the pull came from the providers, because that is the whole claim of this verb", () => {
    const lines = loadLines({
      cap: 10_000,
      results: [leg()],
      window: { since: "2026-09-03", until: "2026-09-11" },
    });
    expect(lines.some((line) => line.includes("This pulled from the PROVIDERS"))).toBe(true);
    expect(lines.some((line) => line.includes("It read no bronze file"))).toBe(true);
  });

  it("sums only what was written, across only the legs that succeeded", () => {
    const lines = loadLines({
      cap: 10_000,
      results: [leg({ stored: 7 }), leg({ errors: ["boom"], ok: false, source: "slack", stored: 0 })],
      window: { since: "2026-09-03", until: "2026-09-11" },
    });
    expect(lines.some((line) => line === "7 row(s) written across 1 platform(s)")).toBe(true);
  });
});

describe("loadSucceeded", () => {
  it("is false when any platform failed, so a partial pull cannot exit zero", () => {
    expect(loadSucceeded({ results: [leg(), leg({ ok: false, source: "slack" })] })).toBe(false);
  });

  it("is false when nothing ran at all, because an empty run proves nothing", () => {
    expect(loadSucceeded({ results: [] })).toBe(false);
  });

  it("is true only when every platform succeeded", () => {
    expect(loadSucceeded({ results: [leg(), leg({ source: "slack" })] })).toBe(true);
  });
});
