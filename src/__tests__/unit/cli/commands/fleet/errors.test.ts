/**
 * The fleet verbs' typed failures: each factory's code and message, and the lines the renderer prints.
 */
import { describe, expect, it } from "vitest";
import { FleetCommandErrors, fleetCommandErrorLines } from "../../../../../cli/commands/fleet/errors.js";

describe("FleetCommandErrors", () => {
  it("aggregates leaf problems, one rendered line each, in order", () => {
    const error = FleetCommandErrors.argumentsRefused({
      problems: [FleetCommandErrors.daysOutOfRange({ got: "0", max: 28 }), FleetCommandErrors.nowNotIso({ got: "x" })],
    });
    expect(error.code).toBe("ARGUMENTS_REFUSED");
    expect(error.message).toBe("--days must be a whole number from 1 to 28, got 0; --now x is not an ISO-8601 instant");
    expect(fleetCommandErrorLines({ error })).toEqual([
      "--days must be a whole number from 1 to 28, got 0",
      "--now x is not an ISO-8601 instant",
    ]);
  });

  it("names a missing --minutes value as undefined", () => {
    const error = FleetCommandErrors.minutesOutOfRange({ got: undefined, max: 1440 });
    expect(error.code).toBe("FLAG_VALUE_INVALID");
    expect(error.message).toBe("--minutes must be a whole number from 1 to 1440, got undefined");
  });

  it("wraps the tokeniser's own reasons as they are", () => {
    const error = FleetCommandErrors.flagsRefused({ reasons: ["unknown flag --x", "--now needs a value"] });
    expect(error.code).toBe("FLAGS_REFUSED");
    expect(fleetCommandErrorLines({ error })).toEqual(["unknown flag --x", "--now needs a value"]);
  });

  it("says a config that is not UTF-8 would be rewritten lossily", () => {
    const error = FleetCommandErrors.configInvalidUtf8({ path: "/c.json" });
    expect(error.code).toBe("CONFIG_INVALID_UTF8");
    expect(fleetCommandErrorLines({ error })).toEqual([
      "it is not valid UTF-8, and a rewrite would replace the bytes that are not",
    ]);
  });

  it("carries a config read failure's own message", () => {
    const error = FleetCommandErrors.configReadFailed({ cause: new Error("EACCES"), path: "/c.json" });
    expect(error.code).toBe("CONFIG_READ_FAILED");
    expect(error.message).toBe("EACCES");
  });

  it("explains a journal that would not take the attempt's start", () => {
    const error = FleetCommandErrors.resumeStartJournalFailed({ cause: { message: "disk full" } });
    expect(error.code).toBe("RESUME_START_JOURNAL_FAILED");
    expect(error.message).toBe(
      "the recovery journal would not take this attempt's start, so nothing was touched: disk full",
    );
  });

  it("forwards the lock and journal-read messages unchanged", () => {
    const lock = FleetCommandErrors.lockUnavailable({ cause: { message: "held" } });
    const read = FleetCommandErrors.resumeJournalReadFailed({ cause: { message: "torn" } });
    expect([lock.code, lock.message, read.code, read.message]).toEqual([
      "FLEET_LOCK_UNAVAILABLE",
      "held",
      "RESUME_JOURNAL_READ_FAILED",
      "torn",
    ]);
  });
});
