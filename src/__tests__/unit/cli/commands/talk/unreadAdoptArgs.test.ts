/** What `talk unread-adopt` accepts and refuses before anything is read. */
import { describe, expect, it } from "vitest";

import { parseUnreadAdoptArgs } from "../../../../../cli/commands/talk/unreadAdoptArgs.js";
import { unwrap } from "../../../../../lib/result.js";

const CLOCK = "2026-11-17T08:00:00.000Z";
const BASE = ["--before", "2026-11-17T06:00:00.000Z", "--why", "read on another machine"];

const refusal = ({ rest }: { rest: readonly string[] }): string =>
  parseUnreadAdoptArgs({ clockIso: CLOCK, rest })._unsafeUnwrapErr().code;

describe("parseUnreadAdoptArgs", () => {
  it("reads a preview with the supervisor cursor and the clock as now", () => {
    expect(unwrap(parseUnreadAdoptArgs({ clockIso: CLOCK, rest: BASE }))).toEqual({
      approve: undefined,
      before: "2026-11-17T06:00:00.000Z",
      cursor: "supervisor",
      home: undefined,
      json: false,
      nowIso: CLOCK,
      why: "read on another machine",
    });
  });

  it("writes an instant with a zone offset back in the canonical form the digest binds", () => {
    const args = unwrap(
      parseUnreadAdoptArgs({ clockIso: CLOCK, rest: ["--before", "2026-11-17T16:00:00+10:00", "--why", "x"] }),
    );

    expect(args.before).toBe("2026-11-17T06:00:00.000Z");
  });

  it.each([
    ["no --before", ["--why", "x"], "UNREAD_ADOPT_BEFORE_INVALID"],
    ["a date with no time", ["--before", "2026-11-17", "--why", "x"], "UNREAD_ADOPT_BEFORE_INVALID"],
    ["a cutoff after now", ["--before", "2026-11-17T09:00:00.000Z", "--why", "x"], "UNREAD_ADOPT_BEFORE_FUTURE"],
    ["no --why", ["--before", "2026-11-17T06:00:00.000Z"], "UNREAD_ADOPT_WHY_MISSING"],
    ["a blank --why", ["--before", "2026-11-17T06:00:00.000Z", "--why", "  "], "UNREAD_ADOPT_WHY_MISSING"],
    ["an approval no preview prints", [...BASE, "--approve", "sha256:abc"], "UNREAD_ADOPT_APPROVE_INVALID"],
    ["a --now that is no instant", [...BASE, "--now", "soon"], "UNREAD_NOW_INVALID"],
    ["an unknown flag", [...BASE, "--all"], "UNREAD_FLAGS_INVALID"],
  ])("refuses %s", (_label, rest, code) => {
    expect(refusal({ rest })).toBe(code);
  });

  it("judges the cutoff against --now when one is given", () => {
    const args = unwrap(
      parseUnreadAdoptArgs({ clockIso: "2026-11-01T00:00:00.000Z", rest: [...BASE, "--now", CLOCK] }),
    );

    expect(args.nowIso).toBe(CLOCK);
  });
});
