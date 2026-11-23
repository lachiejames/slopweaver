/*
 * `hand surface`'s typed refusals: each factory's code is what a caller branches on and its message is what the
 * verb prints, so both are pinned exactly.
 */
import { describe, expect, it } from "vitest";

import { HandSurfaceArgsErrors } from "../../../../../cli/commands/hand/surfaceArgsErrors.js";

describe("HandSurfaceArgsErrors", () => {
  it("names every missing flag in one line", () => {
    expect(HandSurfaceArgsErrors.flagsMissing({ flags: ["--row", "--tried"] })).toEqual({
      code: "FLAGS_MISSING",
      flags: ["--row", "--tried"],
      message: "hand surface needs --row, --tried",
    });
  });

  it("joins the tokeniser's own lines", () => {
    expect(HandSurfaceArgsErrors.flagsRefused({ lines: ["--urgency requires a value", "unknown flag --x"] })).toEqual({
      code: "FLAGS_REFUSED",
      message: "--urgency requires a value; unknown flag --x",
    });
  });

  it("names the closed set beside an unknown urgency", () => {
    expect(HandSurfaceArgsErrors.urgencyUnknown({ kind: "soon", known: ["breaking", "none"] })).toEqual({
      code: "URGENCY_UNKNOWN",
      kind: "soon",
      message: "--urgency must be one of breaking|none, not soon",
    });
  });

  it("prefixes a companion refusal with its kind", () => {
    expect(HandSurfaceArgsErrors.urgencyCompanion({ kind: "close-call", why: "needs --if-silent" }).message).toBe(
      "--urgency close-call needs --if-silent",
    );
  });

  it("refuses a context outside the two a note may carry", () => {
    expect(HandSurfaceArgsErrors.contextInvalid({ stated: "home" }).code).toBe("CONTEXT_INVALID");
  });

  it("asks for the whole access triple", () => {
    expect(HandSurfaceArgsErrors.accessIncomplete().code).toBe("ACCESS_INCOMPLETE");
  });
});
