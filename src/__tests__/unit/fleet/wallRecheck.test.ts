/**
 * {@link wallRecheckVerdict} — a post-relaunch wall watch is clear only when its LAST read read and showed no wall.
 */
import { describe, expect, it } from "vitest";

import { CmuxErrors } from "../../../cmux/errors.js";
import { wallRecheckVerdict } from "../../../fleet/wallRecheck.js";
import { err, ok } from "../../../lib/result.js";

const LOGGED_OUT = "│ > │\n  Not logged in · Please run /login";
const HEALTHY = "⏺ Reading a file\n│ > │";
const unreadable = ({ detail }: { detail: string }) =>
  err(CmuxErrors.terminalTextUnreadable({ detail, method: "surface.read_text" }));

describe("wallRecheckVerdict", () => {
  it("is unreadable when every read failed, naming the last failure", () => {
    const verdict = wallRecheckVerdict({ readings: [unreadable({ detail: "first" }), unreadable({ detail: "last" })] });

    expect(verdict.kind).toBe("unreadable");
    expect(verdict).toEqual({ cause: unreadable({ detail: "last" }).error.message, kind: "unreadable" });
  });

  it("is unreadable when an early read was clear but the last one failed", () => {
    expect(wallRecheckVerdict({ readings: [ok(HEALTHY), unreadable({ detail: "late" })] }).kind).toBe("unreadable");
  });

  it("is clear when the last read read and showed no wall, whatever failed before it", () => {
    expect(wallRecheckVerdict({ readings: [unreadable({ detail: "early" }), ok(HEALTHY)] })).toEqual({ kind: "clear" });
  });

  it("is walled on any read that showed a wall, even with later reads failing", () => {
    expect(wallRecheckVerdict({ readings: [ok(LOGGED_OUT), unreadable({ detail: "late" })] })).toEqual({
      kind: "walled",
      wall: { kind: "logged-out" },
    });
  });

  it("is unreadable, saying so, when no read was attempted", () => {
    expect(wallRecheckVerdict({ readings: [] })).toEqual({ cause: "no screen read was attempted", kind: "unreadable" });
  });
});
