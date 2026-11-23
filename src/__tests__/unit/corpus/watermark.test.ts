import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { watermarkPath } from "../../../corpus/corpusPaths.js";
import { advanceWatermark, computeSourceWatermarks, readWatermark, resolveSince } from "../../../corpus/watermark.js";

describe("computeSourceWatermarks", () => {
  /** A clock well past every fixture instant below, so the cap is inert unless a case pulls it in. */
  const LATER_THAN_EVERY_FIXTURE = "2030-01-01T00:00:00Z";

  it("takes the max observed tsIso per source", () => {
    const marks = computeSourceWatermarks({
      fallbackUntil: "2024-01-09",
      nowIso: LATER_THAN_EVERY_FIXTURE,
      records: [
        { source: "github", tsIso: "2024-01-02T00:00:00Z" },
        { source: "github", tsIso: "2024-01-05T00:00:00Z" },
      ],
    });
    expect(marks).toEqual([{ cursor: "2024-01-05T00:00:00Z", source: "github" }]);
  });

  // The defect this cap exists for, in the exact shape it was measured in: `fallbackUntil` is the window's
  // `until`, which is today+1, so a source that was READ and yielded no usable timestamp banked TOMORROW.
  it("caps the fallbackUntil fallback at the clock — a read source never banks tomorrow", () => {
    const marks = computeSourceWatermarks({
      fallbackUntil: "2026-09-18",
      nowIso: "2026-09-17T23:51:00Z",
      records: [{ source: "fathom", tsIso: "" }],
    });
    expect(marks).toEqual([{ cursor: "2026-09-17T23:51:00Z", source: "fathom" }]);
  });

  it("caps an OBSERVED tsIso ahead of the clock too, not only the fallback", () => {
    const marks = computeSourceWatermarks({
      fallbackUntil: "2026-09-18",
      nowIso: "2026-09-17T23:51:00Z",
      records: [{ source: "calendar", tsIso: "2027-09-05T23:30:00.000Z" }],
    });
    expect(marks).toEqual([{ cursor: "2026-09-17T23:51:00Z", source: "calendar" }]);
  });

  it("leaves a cursor behind the clock alone — it is a cap, not an overwrite", () => {
    const marks = computeSourceWatermarks({
      fallbackUntil: "2026-09-18",
      nowIso: "2026-09-17T23:51:00Z",
      records: [{ source: "github", tsIso: "2026-09-16T08:00:00Z" }],
    });
    expect(marks).toEqual([{ cursor: "2026-09-16T08:00:00Z", source: "github" }]);
  });

  it("caps nothing on an unparseable clock — a broken clock is no evidence about a cursor", () => {
    const marks = computeSourceWatermarks({
      fallbackUntil: "2026-09-18",
      nowIso: "not-an-instant",
      records: [{ source: "fathom", tsIso: "" }],
    });
    expect(marks).toEqual([{ cursor: "2026-09-18", source: "fathom" }]);
  });
});

describe("resolveSince", () => {
  it("slices a cursor to a date, else uses the fallback", () => {
    expect(resolveSince({ cursor: "2024-01-05T09:30:00Z", fallbackSince: "fb" })).toBe("2024-01-05");
    expect(resolveSince({ cursor: undefined, fallbackSince: "fb" })).toBe("fb");
  });
});

describe("advanceWatermark", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slop-wm-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("persists a cursor and never regresses it (MAX merge)", () => {
    advanceWatermark({ home, watermarks: [{ cursor: "2024-01-05T00:00:00Z", source: "github" }] });
    expect(readWatermark({ home, source: "github" })).toBe("2024-01-05T00:00:00Z");
    advanceWatermark({ home, watermarks: [{ cursor: "2024-01-03T00:00:00Z", source: "github" }] });
    expect(readWatermark({ home, source: "github" })).toBe("2024-01-05T00:00:00Z");
  });

  it("keeps each source's cursor in its OWN file — concurrent sources never clobber each other", () => {
    // Two independent advances (what parallel per-source refreshes do). A single shared read-modify-write
    // file would lose one of these to a stale-read clobber; separate per-source files cannot.
    advanceWatermark({ home, watermarks: [{ cursor: "2024-01-05T00:00:00Z", source: "github" }] });
    advanceWatermark({ home, watermarks: [{ cursor: "2024-02-01T00:00:00Z", source: "slack" }] });
    expect(readWatermark({ home, source: "github" })).toBe("2024-01-05T00:00:00Z");
    expect(readWatermark({ home, source: "slack" })).toBe("2024-02-01T00:00:00Z");
  });

  it("reads from the LEGACY combined .watermark.json when no per-source file exists, then the per-source file wins", () => {
    const legacy = watermarkPath({ home });
    mkdirSync(dirname(legacy), { recursive: true });
    writeFileSync(
      legacy,
      JSON.stringify({ sources: { github: { cursor: "2023-12-31T00:00:00Z" } }, version: 1 }),
      "utf8",
    );
    expect(readWatermark({ home, source: "github" })).toBe("2023-12-31T00:00:00Z"); // migrated read
    advanceWatermark({ home, watermarks: [{ cursor: "2024-06-01T00:00:00Z", source: "github" }] });
    expect(readWatermark({ home, source: "github" })).toBe("2024-06-01T00:00:00Z"); // per-source file now wins
  });
});
