import { describe, expect, it } from "vitest";
import { NO_FLAG_VALUE, parseLintLane } from "../../../../devLint/devLint.js";

describe("parseLintLane", () => {
  it("defaults to the full lane when --lane is absent", () => {
    expect(parseLintLane({ rest: [] })).toEqual({ lane: "full", unknown: undefined });
  });

  it("reads --lane local", () => {
    expect(parseLintLane({ rest: ["--lane", "local"] })).toEqual({ lane: "local", unknown: undefined });
  });

  it("reads --lane full", () => {
    expect(parseLintLane({ rest: ["--lane", "full"] })).toEqual({ lane: "full", unknown: undefined });
  });

  it("reads the seat lane", () => {
    expect(parseLintLane({ rest: ["--lane", "seat"] })).toEqual({ lane: "seat", unknown: undefined });
  });

  it("reports an unrecognised lane rather than defaulting one, so the caller can refuse it", () => {
    expect(parseLintLane({ rest: ["--lane", "quick"] })).toEqual({ lane: "full", unknown: "quick" });
  });

  it("reports a named placeholder when --lane ends the tail with no value", () => {
    expect(parseLintLane({ rest: ["--lane"] })).toEqual({ lane: "full", unknown: NO_FLAG_VALUE });
    expect(NO_FLAG_VALUE).toBe("(no value)");
  });
});
