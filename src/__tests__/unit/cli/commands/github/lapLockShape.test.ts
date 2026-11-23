import { describe, expect, it } from "vitest";

import { decodeLapLock, lapLockPhaseWords } from "../../../../../cli/commands/github/lapLockShape.js";

describe("decodeLapLock", () => {
  const body = { nonce: "n", pid: 42, startedIso: "2026-11-10T03:00:00.000Z", subject: "o/r#1" };

  it("reads a preflight lock as preflight, and a lock with no phase as running", () => {
    expect(decodeLapLock({ value: { ...body, phase: "preflight" } })!.phase).toBe("preflight");
    expect(decodeLapLock({ value: body })!.phase).toBe("running");
  });

  it("refuses a phase it does not know, rather than guessing one", () => {
    expect(decodeLapLock({ value: { ...body, phase: "landing" } })).toBe(undefined);
  });

  it("refuses a value missing its pid, subject or nonce", () => {
    expect(decodeLapLock({ value: { ...body, nonce: 7 } })).toBe(undefined);
    expect(decodeLapLock({ value: "lock" })).toBe(undefined);
  });
});

describe("lapLockPhaseWords", () => {
  it("names a preflight holder as before its lanes, and a running one as in its lanes or landing", () => {
    expect(lapLockPhaseWords({ phase: "preflight" })).toBe("still in its preflight, before its lanes");
    expect(lapLockPhaseWords({ phase: "running" })).toBe("running its lanes or landing");
  });
});
