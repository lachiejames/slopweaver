/** `calendar prep-due`'s report half: the exit code a pass earns and the lines it prints. Pure, no seams. */
import { describe, expect, it } from "vitest";

import { type PrepOutcome, prepDueLines, prepExitCode } from "../../../../../cli/commands/calendar/prepDueReport.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";

const outcome = (over: Partial<PrepOutcome> = {}): PrepOutcome => ({
  eventId: "6h1s9r0k4p2m8n3q",
  outcome: "registered",
  reason: "small",
  slug: "meeting-prep-6h1s9r0k4p2m",
  startIso: "2026-10-30T23:00:00.000Z",
  summary: "Acme weekly",
  ...over,
});

describe("prepExitCode", () => {
  it("fails a pass with any failed meeting, even beside a registered one", () => {
    expect(prepExitCode({ outcomes: [outcome(), outcome({ outcome: "failed" })] })).toBe(EXIT_ERROR);
  });

  it("succeeds when a row was or would be registered", () => {
    expect([
      prepExitCode({ outcomes: [outcome()] }),
      prepExitCode({ outcomes: [outcome({ outcome: "would-register" })] }),
    ]).toEqual([EXIT_OK, EXIT_OK]);
  });

  it("reads an hour with nothing owed as expected-empty", () => {
    expect([
      prepExitCode({ outcomes: [] }),
      prepExitCode({ outcomes: [outcome({ outcome: "existing" }), outcome({ outcome: "started" })] }),
    ]).toEqual([EXIT_EXPECTED_EMPTY, EXIT_EXPECTED_EMPTY]);
  });
});

describe("prepDueLines", () => {
  it("prints one line per meeting, naming an untitled one as such", () => {
    expect(prepDueLines({ outcomes: [outcome(), outcome({ summary: undefined })], skipped: [] })).toEqual([
      "registered  meeting-prep-6h1s9r0k4p2m  2026-10-30T23:00:00.000Z  Acme weekly (small)",
      "registered  meeting-prep-6h1s9r0k4p2m  2026-10-30T23:00:00.000Z  (untitled) (small)",
    ]);
  });

  it("says so when the window held no meeting", () => {
    expect(prepDueLines({ outcomes: [], skipped: [] })).toEqual(["calendar prep-due: no meeting in the window"]);
  });
});
