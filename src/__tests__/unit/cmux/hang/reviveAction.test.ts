/*
 * The cmux hang judge's `reviveAction`: nothing for a responsive app, a wait inside the bound, and a hang past it
 * restarted when allowed or held when not.
 */
import { describe, expect, it } from "vitest";

import { reviveAction } from "../../../../cmux/hang.js";
import { instant } from "./harness.js";

describe("reviveAction", () => {
  const over = { appPid: 5088, kind: "unresponsive", overBound: true, sinceIso: instant({ clock: "18:58" }) } as const;

  it("does nothing for a responsive app", () => {
    expect(reviveAction({ allowance: { kind: "allowed" }, hang: { kind: "responsive" } })).toEqual({ kind: "none" });
  });

  it("waits inside the bound", () => {
    expect(reviveAction({ allowance: { kind: "allowed" }, hang: { ...over, overBound: false } })).toEqual({
      kind: "wait",
      sinceIso: instant({ clock: "18:58" }),
    });
  });

  it("restarts a hang past the bound when allowed", () => {
    expect(reviveAction({ allowance: { kind: "allowed" }, hang: over })).toEqual({
      appPid: 5088,
      kind: "restart",
      sinceIso: instant({ clock: "18:58" }),
    });
  });

  it("holds a hang past the bound when restarts are not allowed", () => {
    const allowance = { kind: "cooldown", untilIso: instant({ clock: "20:20" }) } as const;
    expect(reviveAction({ allowance, hang: over })).toEqual({
      allowance,
      kind: "held",
      sinceIso: instant({ clock: "18:58" }),
    });
  });
});
