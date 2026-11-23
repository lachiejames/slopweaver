import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "#lib/result.js";
import { POLLY_MODES, parsePollyMode, pollyModeOrThrow } from "../../pollyMode.js";

describe("parsePollyMode", () => {
  it("lists exactly the three modes the setup file documents", () => {
    expect(POLLY_MODES).toEqual(["record", "replay", "passthrough"]);
  });

  it("defaults an unset variable to replay", () => {
    expect(unwrap(parsePollyMode({ raw: undefined }))).toBe("replay");
  });

  it.each(POLLY_MODES)("accepts %s", (mode) => {
    expect(unwrap(parsePollyMode({ raw: mode }))).toBe(mode);
  });

  it("refuses a typo of record instead of falling back to replay, naming the valid modes", () => {
    const result = parsePollyMode({ raw: "recrod" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual([
      'POLLY_MODE="recrod" is not a mode; valid modes are record, replay, passthrough',
    ]);
  });

  it("refuses an empty string, which is set but names no mode", () => {
    expect(unwrapErr(parsePollyMode({ raw: "" }))).toEqual([
      'POLLY_MODE="" is not a mode; valid modes are record, replay, passthrough',
    ]);
  });

  it("is case sensitive", () => {
    expect(unwrapErr(parsePollyMode({ raw: "Record" }))).toEqual([
      'POLLY_MODE="Record" is not a mode; valid modes are record, replay, passthrough',
    ]);
  });
});

describe("pollyModeOrThrow", () => {
  it("returns replay for an unset variable", () => {
    expect(pollyModeOrThrow({ raw: undefined })).toBe("replay");
  });

  it("throws the parse error for a typo, so the setup file fails at load", () => {
    expect(() => pollyModeOrThrow({ raw: "recrod" })).toThrow(
      'POLLY_MODE="recrod" is not a mode; valid modes are record, replay, passthrough',
    );
  });
});
