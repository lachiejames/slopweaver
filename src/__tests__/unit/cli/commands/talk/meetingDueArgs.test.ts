/*
 * `talk meeting-due`'s argv: `--now` is judged before any read, and each refusal is built by its own factory.
 */
import { describe, expect, it } from "vitest";

import { parseMeetingDueArgs } from "../../../../../cli/commands/talk/meetingDueArgs.js";
import { MeetingDueArgsErrors } from "../../../../../cli/commands/talk/meetingDueArgsErrors.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseMeetingDueArgs", () => {
  it("reads --json, --home and an ISO --now", () => {
    const rest = ["--json", "--home", "/tmp/h", "--now", "2026-10-08T23:00:00Z"];
    expect(unwrap(parseMeetingDueArgs({ rest }))).toEqual({
      home: "/tmp/h",
      json: true,
      nowMs: Date.parse("2026-10-08T23:00:00Z"),
    });
  });

  it("judges at the clock's now when --now is absent", () => {
    expect(unwrap(parseMeetingDueArgs({ rest: [] }))).toEqual({ home: undefined, json: false, nowMs: undefined });
  });

  it("refuses a --now that is not an instant, naming it", () => {
    const refused = unwrapErr(parseMeetingDueArgs({ rest: ["--now", "half past four"] }));
    expect(refused).toEqual(MeetingDueArgsErrors.nowInvalid({ now: "half past four" }));
    expect(refused.message).toContain("--now half past four is not an ISO instant");
  });

  it("refuses a flag the verb does not take", () => {
    const refused = unwrapErr(parseMeetingDueArgs({ rest: ["--soon"] }));
    expect(refused.code).toBe("MEETING_DUE_FLAGS_INVALID");
    expect(refused.message).toContain("--soon");
  });
});
