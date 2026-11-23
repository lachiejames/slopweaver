/**
 * The retention bound, which is the difference between "nothing happened" and "the evidence was deleted".
 */
import { describe, expect, it } from "vitest";

import {
  retentionFloor,
  retentionLine,
  retentionVerdictFor,
  TRANSCRIPT_RETENTION_DAYS_NOMINAL,
} from "../../../transcripts/retention.js";

const NOW_MS = Date.parse("2026-08-28T00:00:00.000Z");
const OLDEST_MS = Date.parse("2026-07-28T00:00:00.000Z");

describe("retentionFloor", () => {
  it("measures the floor from the oldest transcript that is actually there", () => {
    expect(retentionFloor({ nowMs: NOW_MS, oldestMs: OLDEST_MS, transcriptCount: 1633 })).toStrictEqual({
      oldestIso: "2026-07-28T00:00:00.000Z",
      retainedDays: 31,
      transcriptCount: 1633,
    });
  });

  it("reports no floor at all when there are no transcripts, rather than the epoch", () => {
    expect(retentionFloor({ nowMs: NOW_MS, oldestMs: undefined, transcriptCount: 0 })).toStrictEqual({
      oldestIso: "",
      retainedDays: 0,
      transcriptCount: 0,
    });
  });

  it("floors a partial day rather than rounding it up", () => {
    expect(
      retentionFloor({ nowMs: NOW_MS, oldestMs: Date.parse("2026-08-27T18:00:00.000Z"), transcriptCount: 1 })
        .retainedDays,
    ).toBe(0);
  });
});

describe("retentionVerdictFor", () => {
  const floor = retentionFloor({ nowMs: NOW_MS, oldestMs: OLDEST_MS, transcriptCount: 1633 });

  it("calls a window that starts at the floor within retention", () => {
    expect(retentionVerdictFor({ floor, sinceMs: OLDEST_MS, untilMs: undefined })).toBe("within-retention");
  });

  it("calls a window that ends before the floor OUTSIDE retention, so an empty answer is not read as absence", () => {
    expect(
      retentionVerdictFor({
        floor,
        sinceMs: Date.parse("2026-06-01T00:00:00.000Z"),
        untilMs: Date.parse("2026-07-01T00:00:00.000Z"),
      }),
    ).toBe("predates-retention");
  });

  it("calls a window that starts before the floor and runs past it a partial answer", () => {
    expect(retentionVerdictFor({ floor, sinceMs: Date.parse("2026-06-01T00:00:00.000Z"), untilMs: undefined })).toBe(
      "spans-retention-floor",
    );
  });

  it("calls an unbounded window within retention, because it asked for everything that is there", () => {
    expect(retentionVerdictFor({ floor, sinceMs: undefined, untilMs: undefined })).toBe("within-retention");
  });

  it("calls any window within retention when there is no floor to be outside of", () => {
    const empty = retentionFloor({ nowMs: NOW_MS, oldestMs: undefined, transcriptCount: 0 });
    expect(retentionVerdictFor({ floor: empty, sinceMs: 0, untilMs: 1 })).toBe("within-retention");
  });
});

describe("retentionLine", () => {
  const floor = retentionFloor({ nowMs: NOW_MS, oldestMs: OLDEST_MS, transcriptCount: 1633 });

  it("states the nominal window and the measured floor together", () => {
    const line = retentionLine({ floor, verdict: "within-retention" });
    expect(line).toBe(
      "retention: within the window. Holding 1633 transcripts, oldest 2026-07-28T00:00:00.000Z (31d back; Claude Code retains roughly 31 days and deletes the rest)",
    );
    expect(TRANSCRIPT_RETENTION_DAYS_NOMINAL).toBe(31);
  });

  it("says DELETED rather than empty when the window ends before the floor", () => {
    expect(retentionLine({ floor, verdict: "predates-retention" })).toContain("DELETED");
  });

  it("says the early part is unanswerable when the window crosses the floor", () => {
    expect(retentionLine({ floor, verdict: "spans-retention-floor" })).toContain("unanswerable rather than absent");
  });

  it("says so plainly when this machine holds no transcripts at all", () => {
    const empty = retentionFloor({ nowMs: NOW_MS, oldestMs: undefined, transcriptCount: 0 });
    expect(retentionLine({ floor: empty, verdict: "within-retention" })).toBe(
      "retention: no transcripts on disk at all — Claude Code keeps roughly 31 days and this machine is holding none",
    );
  });
});
