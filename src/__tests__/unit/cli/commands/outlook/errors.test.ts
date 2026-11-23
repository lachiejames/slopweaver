/**
 * The `outlook` argv-parse failures in `cli/commands/outlook/errors.ts`: each factory's code, message and carried
 * fields, and `outlookArgsErrorLines`, which prints the tokeniser's list as that list and every other refusal as
 * its one message.
 */
import { describe, expect, it } from "vitest";

import { OutlookArgsErrors, outlookArgsErrorLines } from "../../../../../cli/commands/outlook/errors.js";

const USAGE = "usage: slopweaver outlook read <message-id> [--thread]";

describe("OutlookArgsErrors", () => {
  it("names a missing positional and carries the usage", () => {
    expect(OutlookArgsErrors.argumentMissing({ name: "<message-id>", usage: USAGE })).toEqual({
      code: "ARGUMENT_MISSING",
      message: "missing <message-id>",
      name: "<message-id>",
      usage: USAGE,
    });
  });

  it("carries a missing flag with the caller's own message", () => {
    expect(OutlookArgsErrors.flagMissing({ flag: "--form", message: "--form is required", usage: USAGE })).toEqual({
      code: "FLAG_MISSING",
      flag: "--form",
      message: "--form is required",
      usage: USAGE,
    });
  });

  it("joins the tokeniser's reasons into the message and keeps the list", () => {
    expect(
      OutlookArgsErrors.flagsInvalid({ reasons: ["unknown flag --nope", "--limit needs a value"], usage: USAGE }),
    ).toEqual({
      code: "FLAGS_INVALID",
      message: "unknown flag --nope\n--limit needs a value",
      reasons: ["unknown flag --nope", "--limit needs a value"],
      usage: USAGE,
    });
  });

  it("carries the flag and the value it was refused", () => {
    expect(
      OutlookArgsErrors.invalidValue({ flag: "--limit", got: "500", message: "--limit must be 1..100", usage: USAGE }),
    ).toEqual({
      code: "INVALID_FLAG_VALUE",
      flag: "--limit",
      got: "500",
      message: "--limit must be 1..100",
      usage: USAGE,
    });
  });

  it("names the conflicting flags in the message", () => {
    expect(OutlookArgsErrors.modesConflict({ flags: ["--read", "--unread"], usage: USAGE })).toEqual({
      code: "MODES_CONFLICT",
      flags: ["--read", "--unread"],
      message: "--read and --unread select different modes — give at most one",
      usage: USAGE,
    });
  });

  it("carries the caller's message for a change verb with nothing to change", () => {
    expect(OutlookArgsErrors.nothingToChange({ message: "give --add or --remove", usage: USAGE })).toEqual({
      code: "NOTHING_TO_CHANGE",
      message: "give --add or --remove",
      usage: USAGE,
    });
  });
});

describe("outlookArgsErrorLines", () => {
  it("prints the tokeniser's reasons one per line", () => {
    const error = OutlookArgsErrors.flagsInvalid({
      reasons: ["unknown flag --nope", "--limit needs a value"],
      usage: USAGE,
    });

    expect(outlookArgsErrorLines({ error })).toEqual(["unknown flag --nope", "--limit needs a value"]);
  });

  it("prints every other refusal as its one message", () => {
    const error = OutlookArgsErrors.argumentMissing({ name: "<message-id>", usage: USAGE });

    expect(outlookArgsErrorLines({ error })).toEqual(["missing <message-id>"]);
  });

  it("prints a mode conflict as its one message", () => {
    const error = OutlookArgsErrors.modesConflict({ flags: ["--read", "--unread"], usage: USAGE });

    expect(outlookArgsErrorLines({ error })).toEqual(["--read and --unread select different modes — give at most one"]);
  });
});
