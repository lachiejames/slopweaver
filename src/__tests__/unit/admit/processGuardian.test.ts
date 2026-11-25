/**
 * The guardian a sandboxed verb carries: read strictly from the two environment fields the desktop's Codex worker
 * sets, and vouching only while its pid is still the process that handed its stamp down.
 */
import { describe, expect, it } from "vitest";

import {
  GUARDIAN_PID_ENV,
  GUARDIAN_START_ENV,
  guardianFromEnvironment,
  guardianVouches,
} from "../../../admit/processGuardian.js";
import type { StartOf } from "../../../talk/relayLease.js";

const STAMP = "Wed Nov  5 09:01:02 2026";

describe("guardianFromEnvironment", () => {
  it("reads both fields into a guardian, the double-spaced day byte for byte", () => {
    expect(
      guardianFromEnvironment({
        env: { [GUARDIAN_PID_ENV]: "5151", [GUARDIAN_START_ENV]: STAMP, PATH: "/usr/bin" },
      }),
    ).toEqual({ pid: 5151, start: STAMP });
  });

  it("names the two fields exactly as the desktop worker sets them, and neither reads as an override", () => {
    expect([GUARDIAN_PID_ENV, GUARDIAN_START_ENV]).toEqual([
      "SLOPWEAVER_SESSION_GUARDIAN_PID",
      "SLOPWEAVER_SESSION_GUARDIAN_START",
    ]);
    expect([GUARDIAN_PID_ENV, GUARDIAN_START_ENV].filter((name) => /ALLOW|OVERRIDE/u.test(name))).toEqual([]);
  });

  it("is no guardian with no fields at all", () => {
    expect(guardianFromEnvironment({ env: { PATH: "/usr/bin" } })).toBeUndefined();
  });

  it("is no guardian with only the pid", () => {
    expect(guardianFromEnvironment({ env: { [GUARDIAN_PID_ENV]: "5151" } })).toBeUndefined();
  });

  it("is no guardian with only the stamp", () => {
    expect(guardianFromEnvironment({ env: { [GUARDIAN_START_ENV]: STAMP } })).toBeUndefined();
  });

  it.each([
    ["zero", "0"],
    ["negative", "-5151"],
    ["signed", "+5151"],
    ["zero-padded", "05151"],
    ["space-padded", " 5151"],
    ["fractional", "51.5"],
    ["hexadecimal", "0x141f"],
    ["empty", ""],
    ["past the safe integers", "99999999999999999999"],
  ])("is no guardian for a %s pid", (_label, pid) => {
    expect(guardianFromEnvironment({ env: { [GUARDIAN_PID_ENV]: pid, [GUARDIAN_START_ENV]: STAMP } })).toBeUndefined();
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
  ])("is no guardian for an %s stamp", (_label, start) => {
    expect(
      guardianFromEnvironment({ env: { [GUARDIAN_PID_ENV]: "5151", [GUARDIAN_START_ENV]: start } }),
    ).toBeUndefined();
  });
});

describe("guardianVouches", () => {
  const GUARDIAN = { pid: 5151, start: STAMP };

  it("vouches while the guardian's pid runs with the exact stamp it recorded", () => {
    const startOf: StartOf = () => ({ running: true, start: STAMP });
    expect(guardianVouches({ guardian: GUARDIAN, startOf })).toBe(true);
  });

  it("does not vouch once the pid's stamp differs: a recycled pid", () => {
    const startOf: StartOf = () => ({ running: true, start: "Wed Nov  5 09:01:03 2026" });
    expect(guardianVouches({ guardian: GUARDIAN, startOf })).toBe(false);
  });

  it("does not vouch once the guardian is gone", () => {
    const startOf: StartOf = () => ({ running: false, start: undefined });
    expect(guardianVouches({ guardian: GUARDIAN, startOf })).toBe(false);
  });

  it("leaves an unreadable stamp to the pid, as every holder check does, so a sandboxed reader errs toward held", () => {
    const startOf: StartOf = () => ({ running: true, start: undefined });
    expect(guardianVouches({ guardian: GUARDIAN, startOf })).toBe(true);
  });

  it("never vouches with no guardian", () => {
    const startOf: StartOf = () => ({ running: true, start: STAMP });
    expect(guardianVouches({ guardian: undefined, startOf })).toBe(false);
  });

  it("probes the guardian's own pid", () => {
    const asked: number[] = [];
    const startOf: StartOf = (candidate) => {
      asked.push(candidate);
      return { running: true, start: STAMP };
    };
    guardianVouches({ guardian: GUARDIAN, startOf });
    expect(asked).toEqual([5151]);
  });
});
