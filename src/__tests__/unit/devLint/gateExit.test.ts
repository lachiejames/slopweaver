import { describe, expect, it } from "vitest";
import { gateDeathNote, gateProcessPassed } from "../../../devLint/gateExit.js";

describe("gateProcessPassed — a gate killed before its verdict line FAILS", () => {
  it("passes a gate that exited 0 by itself", () => {
    expect(gateProcessPassed({ end: { error: undefined, signal: null, status: 0 } })).toBe(true);
  });

  it("fails a gate V8 aborted out of memory (SIGABRT, no status)", () => {
    expect(gateProcessPassed({ end: { error: undefined, signal: "SIGABRT", status: null } })).toBe(false);
  });

  it("fails a gate whose launcher relayed the abort as 134", () => {
    expect(gateProcessPassed({ end: { error: undefined, signal: null, status: 134 } })).toBe(false);
  });

  it("fails a gate the per-gate ceiling killed", () => {
    const timedOut = Object.assign(new Error("spawnSync tsx ETIMEDOUT"), { code: "ETIMEDOUT" });
    expect(gateProcessPassed({ end: { error: timedOut, signal: "SIGKILL", status: null } })).toBe(false);
  });

  it("fails a status 0 that arrived beside a spawn error", () => {
    expect(gateProcessPassed({ end: { error: new Error("spawn EPIPE"), signal: null, status: 0 } })).toBe(false);
  });

  it("fails a gate with a signal even when a status is present", () => {
    expect(gateProcessPassed({ end: { error: undefined, signal: "SIGTERM", status: 0 } })).toBe(false);
  });
});

describe("gateDeathNote", () => {
  it("names the signal a gate died of", () => {
    expect(gateDeathNote({ end: { error: undefined, signal: "SIGABRT", status: null } })).toBe(
      "dev lint: this gate was killed by SIGABRT before it exited, so it FAILS — an out-of-memory abort is SIGABRT, the per-gate ceiling is SIGKILL",
    );
  });

  it("says nothing for a gate that exited by itself, pass or fail", () => {
    expect(gateDeathNote({ end: { error: undefined, signal: null, status: 1 } })).toBe(undefined);
  });

  it("names a missing status with no signal", () => {
    expect(gateDeathNote({ end: { error: undefined, signal: null, status: null } })).toBe(
      "dev lint: this gate ended with no exit status, so it FAILS",
    );
  });
});
