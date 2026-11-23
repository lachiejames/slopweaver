/**
 * "Did a stated reason say anything": an inclusion rule (a letter or a digit), so no invisible character an
 * exclusion list would miss reads as a reason.
 */
import { describe, expect, it } from "vitest";

import { statesAReason } from "../../../codex/statesAReason.js";

describe("statesAReason", () => {
  it("reads no reason as none", () => {
    expect(statesAReason({ reason: undefined })).toBe(false);
  });

  it("reads whitespace as none", () => {
    expect(statesAReason({ reason: "  \t " })).toBe(false);
  });

  it("reads a zero-width space as none", () => {
    expect(statesAReason({ reason: "​" })).toBe(false);
  });

  it("reads a Hangul filler, a letter that renders as nothing, as none", () => {
    expect(statesAReason({ reason: "ᅟㅤ" })).toBe(false);
  });

  it("reads a braille blank as none", () => {
    expect(statesAReason({ reason: "⠀" })).toBe(false);
  });

  it("reads one letter as a reason", () => {
    expect(statesAReason({ reason: "a" })).toBe(true);
  });

  it("reads one digit as a reason", () => {
    expect(statesAReason({ reason: "7" })).toBe(true);
  });
});
