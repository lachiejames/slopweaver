/**
 * The fleet-wide fallback report — the fold, the rows, and the headline that keeps an empty report honest.
 */
import { describe, expect, it } from "vitest";

import type { ModelFallbackRecord } from "../../../sessions/modelFallback.js";
import {
  renderSeatFallbackReport,
  type SeatFallbackReading,
  seatFallbackLine,
  seatFallbackReport,
} from "../../../sessions/seatFallbackReport.js";

/** The measured switch on the aether worktree's seat. */
const FALLBACK: ModelFallbackRecord = {
  atIso: "2026-09-15T12:03:00.259Z",
  category: "cyber",
  fallbackModel: "claude-opus-4-8",
  originalModel: "claude-opus-5",
};

/** That seat, still demoted. */
const DEMOTED: SeatFallbackReading = {
  cwd: "/wt/aether-pentest-portal",
  pid: 42,
  sessionId: "29b955c3",
  title: "◑ Aether pentest portal atlas",
  unreadable: undefined,
  verdict: { fallback: FALLBACK, kind: "demoted" },
};

/** A seat somebody put back. */
const RESTORED: SeatFallbackReading = {
  ...DEMOTED,
  pid: 43,
  sessionId: "f0e7c7c6",
  title: undefined,
  verdict: { fallback: FALLBACK, kind: "restored", model: "claude-opus-5" },
};

/** A seat no fallback ever touched. */
const CLEAN: SeatFallbackReading = { ...DEMOTED, pid: 44, sessionId: "aaaa1111", verdict: { kind: "none" } };

/** A seat whose transcript could not be read. */
const UNREAD: SeatFallbackReading = {
  ...DEMOTED,
  pid: 45,
  sessionId: "bbbb2222",
  unreadable: "no transcript was found for this session",
  verdict: undefined,
};

describe("seatFallbackReport", () => {
  it("buckets by verdict and counts every seat it looked at", () => {
    const report = seatFallbackReport({ readings: [DEMOTED, RESTORED, CLEAN, UNREAD] });

    expect(report.demoted).toStrictEqual([DEMOTED]);
    expect(report.restored).toStrictEqual([RESTORED]);
    expect(report.unreadable).toStrictEqual([UNREAD]);
    expect(report.scanned).toBe(4);
  });

  it("reports a clean fleet as zero out of the number it scanned, never as an empty read", () => {
    const report = seatFallbackReport({ readings: [CLEAN, CLEAN] });

    expect(report.demoted.length).toBe(0);
    expect(report.scanned).toBe(2);
    expect(renderSeatFallbackReport({ report })).toStrictEqual([
      "0 seat(s) DEMOTED by a safeguard fallback, 0 restored since, 0 unread, of 2 live session(s) scanned",
    ]);
  });

  it("distinguishes a read that saw nothing from a clean one", () => {
    const report = seatFallbackReport({ readings: [] });

    expect(renderSeatFallbackReport({ report })[0]!).toContain("of 0 live session(s) scanned");
  });
});

describe("seatFallbackLine", () => {
  it("names the seat by its workspace title, the switch, the category and the instant", () => {
    expect(seatFallbackLine({ reading: DEMOTED })).toBe(
      "DEMOTED\t◑ Aether pentest portal atlas\t29b955c3 (pid 42)\tclaude-opus-5 -> claude-opus-4-8 at " +
        "2026-09-15T12:03:00.259Z (category cyber); nothing has run on claude-opus-5 since",
    );
  });

  it("falls back to the cwd when no workspace title resolved, and names what moved it back", () => {
    expect(seatFallbackLine({ reading: RESTORED })).toBe(
      "restored\t/wt/aether-pentest-portal\tf0e7c7c6 (pid 43)\tclaude-opus-5 -> claude-opus-4-8 at " +
        "2026-09-15T12:03:00.259Z (category cyber); a later turn ran on claude-opus-5",
    );
  });

  it("says a category the record did not name is unnamed rather than printing an empty one", () => {
    const reading: SeatFallbackReading = {
      ...DEMOTED,
      verdict: { fallback: { ...FALLBACK, category: "" }, kind: "demoted" },
    };

    expect(seatFallbackLine({ reading })).toContain("(category unnamed)");
  });

  it("reports an unread seat as UNREAD with the reason", () => {
    expect(seatFallbackLine({ reading: UNREAD })).toBe(
      "UNREAD\t◑ Aether pentest portal atlas\tbbbb2222 (pid 45)\tno transcript was found for this session",
    );
  });

  it("reports a seat no fallback touched as clean", () => {
    expect(seatFallbackLine({ reading: CLEAN })).toBe("clean\t◑ Aether pentest portal atlas\taaaa1111 (pid 44)");
  });
});

describe("renderSeatFallbackReport", () => {
  it("puts every demoted seat above every restored one, behind the headline", () => {
    const lines = renderSeatFallbackReport({ report: seatFallbackReport({ readings: [RESTORED, DEMOTED, CLEAN] }) });

    expect(lines[0]!).toBe(
      "1 seat(s) DEMOTED by a safeguard fallback, 1 restored since, 0 unread, of 3 live session(s) scanned",
    );
    expect(lines[1]!).toBe("");
    expect(lines[2]!).toContain("DEMOTED\t");
    expect(lines[3]!).toContain("restored\t");
    expect(lines.length).toBe(4);
  });
});
