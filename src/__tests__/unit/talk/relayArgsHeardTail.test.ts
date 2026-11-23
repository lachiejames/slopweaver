/*
 * `talk relay --heard-tail`: whether the call words a relay carries ended before the owner did.
 * Absent stays unknown, so a verb behind an old page never records words it never checked as whole.
 */
import { describe, expect, it } from "vitest";

import { parseRelayArgs } from "../../../cli/commands/talk/relayArgs.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const TURN = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

describe("parseRelayArgs — --heard-tail", () => {
  it("reads --heard-tail cut and whole, and leaves it unknown when the page stated neither", () => {
    const tail = (...extra: string[]) =>
      unwrap(parseRelayArgs({ rest: ["--turn", TURN, "--say", "x", "--heard-stdin", ...extra] })).heardTailCut;
    expect([tail("--heard-tail", "cut"), tail("--heard-tail", "whole"), tail()]).toEqual([true, false, undefined]);
  });

  it("refuses a --heard-tail that is neither cut nor whole", () => {
    expect(unwrapErr(parseRelayArgs({ rest: ["--turn", TURN, "--say", "x", "--heard-tail", "open"] }))).toEqual([
      "--heard-tail must be cut or whole, got open",
    ]);
  });
});
