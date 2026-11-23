/**
 * What `talk quarantine` accepts: exactly one call id and a reason that says something, refused before any lock.
 */
import { describe, expect, it } from "vitest";

import {
  parseQuarantineArgs,
  QuarantineArgsErrors,
  TALK_QUARANTINE_FLAG_NAMES,
} from "../../../../../cli/commands/talk/quarantineArgs.js";
import { unwrap } from "../../../../../lib/result.js";

const CALL = "f1edcbb1-553c-4a21-a21b-a1bb8a62b630";

describe("parseQuarantineArgs", () => {
  it("reads one call id, its reason, a home and --json", () => {
    expect(
      unwrap(parseQuarantineArgs({ rest: [CALL, "--reason", "removed by hand", "--home", "/h", "--json"] })),
    ).toEqual({ callId: CALL, home: "/h", json: true, reason: "removed by hand" });
  });

  it("defaults to the ambient home and a text receipt", () => {
    expect(unwrap(parseQuarantineArgs({ rest: ["--reason", "gone", CALL] }))).toEqual({
      callId: CALL,
      home: undefined,
      json: false,
      reason: "gone",
    });
  });

  it.each([
    ["no call id", ["--reason", "gone"], 0],
    ["two call ids", [CALL, CALL, "--reason", "gone"], 2],
  ])("refuses %s", (_label, rest, given) => {
    expect(parseQuarantineArgs({ rest })._unsafeUnwrapErr()).toEqual(QuarantineArgsErrors.callCount({ given }));
  });

  it("refuses a positional that is not a call id", () => {
    expect(parseQuarantineArgs({ rest: ["../x", "--reason", "gone"] })._unsafeUnwrapErr()).toEqual(
      QuarantineArgsErrors.callId({ callId: "../x" }),
    );
  });

  it.each([
    ["no reason", [CALL]],
    ["a blank reason", [CALL, "--reason", "   "]],
  ])("refuses %s", (_label, rest) => {
    expect(parseQuarantineArgs({ rest })._unsafeUnwrapErr()).toEqual(QuarantineArgsErrors.reason());
  });

  it("refuses a flag it does not know", () => {
    expect(parseQuarantineArgs({ rest: [CALL, "--reason", "gone", "--force"] })._unsafeUnwrapErr().code).toBe(
      "QUARANTINE_FLAGS_INVALID",
    );
  });

  it("declares exactly the flags it parses", () => {
    expect(TALK_QUARANTINE_FLAG_NAMES.toSorted()).toEqual(["--home", "--json", "--reason"]);
  });
});
