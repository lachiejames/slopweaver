import { describe, expect, it } from "vitest";

import { spanOf, trailingDayWindows } from "../../../velocity/windows.js";

describe("trailingDayWindows", () => {
  it("returns one window per trailing day, oldest first, ending on the reference instant's own day", () => {
    const windows = trailingDayWindows({ days: 3, nowIso: "2026-09-01T14:00:00.000Z" });

    expect(windows.map((w) => w.dayKey)).toEqual(["2026-08-30", "2026-08-31", "2026-09-01"]);
  });

  it("each window spans exactly one UTC calendar day, midnight to midnight", () => {
    const windows = trailingDayWindows({ days: 1, nowIso: "2026-09-01T23:59:00.000Z" });

    expect(windows).toEqual([
      { dayKey: "2026-09-01", sinceIso: "2026-09-01T00:00:00.000Z", untilIso: "2026-09-02T00:00:00.000Z" },
    ]);
  });

  it("returns an empty array for zero days", () => {
    expect(trailingDayWindows({ days: 0, nowIso: "2026-09-01T00:00:00.000Z" })).toEqual([]);
  });
});

describe("spanOf", () => {
  it("spans the first window's start to the last window's end", () => {
    const windows = trailingDayWindows({ days: 3, nowIso: "2026-09-01T00:00:00.000Z" });

    expect(spanOf({ windows })).toEqual({ sinceIso: "2026-08-30T00:00:00.000Z", untilIso: "2026-09-02T00:00:00.000Z" });
  });

  it("returns undefined for an empty window list", () => {
    expect(spanOf({ windows: [] })).toBe(undefined);
  });
});
