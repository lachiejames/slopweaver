/**
 * The caller state homes a run-due parent hands its verb child, through one environment variable.
 */
import { describe, expect, it } from "vitest";

import { decodeCallerGateHomes, encodeCallerGateHomes } from "../../../cli/callerGateHomesEnv.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("encodeCallerGateHomes / decodeCallerGateHomes", () => {
  it("round-trips homes holding spaces, quotes and non-ASCII, each once in first-seen order", () => {
    const homes = ["/tmp/a home", '/tmp/"quoted"', "/tmp/naïve-ホーム", "/tmp/a home"];
    const value = encodeCallerGateHomes({ homes });
    expect(unwrap(decodeCallerGateHomes({ value }))).toEqual(["/tmp/a home", '/tmp/"quoted"', "/tmp/naïve-ホーム"]);
  });

  it("reads an unset variable as no homes", () => {
    expect(unwrap(decodeCallerGateHomes({ value: undefined }))).toEqual([]);
  });

  it("refuses a value that is not JSON, rather than dropping the homes it meant to carry", () => {
    expect(unwrapErr(decodeCallerGateHomes({ value: "/tmp/home" }))[0]).toContain(
      "SLOPWEAVER_CALLER_GATE_HOMES is set but unreadable (",
    );
  });

  it("refuses JSON that is not an array of strings", () => {
    expect(unwrapErr(decodeCallerGateHomes({ value: '["/tmp/a", 3]' }))).toEqual([
      "SLOPWEAVER_CALLER_GATE_HOMES is set but unreadable (not an array of strings); automation run-due sets it on " +
        "the verbs it runs, so a value from anywhere else is a mistake: unset it",
    ]);
  });
});
