/*
 * A keep-alive touch counts only when the store's own expiry advanced, runs a refresh only when the CLI would
 * act on one, and a watch tick repairs every store it may before the sign-in note reads the probe.
 */
import { describe, expect, it } from "vitest";

import type { ClaudeAccount } from "../../../claude/contracts.js";
import type { StoreLife } from "../../../claude/credentialRepair.js";
import { CLI_REFRESH_WINDOW_MINUTES, touchVerdict } from "../../../claude/keepAlive.js";
import { type KeepAliveTouchDeps, touchOneStore, touchProblemLine } from "../../../claude/keepAliveTouch.js";
import type { WatchTickPlan } from "../../../claude/watchTick.js";
import { storesClearedForRepair, touchesHeldByBothDecisions } from "../../../claude/watchTouchGuard.js";

const NOW = "2026-11-11T12:00:00.000Z";
const ACCOUNT: ClaudeAccount = { alias: "plan-five", storeDir: "/stores/five" };
const GRANT_LIVE = "2026-12-01T00:00:00.000Z";

/**
 * A store reading whose access token expires at the given instant, behind a live refresh grant.
 *
 * @param expiresAtIso when the access token expires
 * @returns the reading
 */
function lifeExpiring({ expiresAtIso }: { expiresAtIso: string }): StoreLife {
  return {
    alias: "plan-five",
    expiresAtIso,
    hasCredential: true,
    hasRefreshToken: true,
    refreshExpiresAtIso: GRANT_LIVE,
  };
}

/**
 * Seams that hand back the readings in order and record each refresh, so the sequence is assertable.
 *
 * @param lives the readings `readLife` returns, one per call
 * @param refreshProblem what the refresh command reports, undefined for a clean exit
 * @returns the seams and the list of stores a refresh ran under
 */
function seams({ lives, refreshProblem }: { lives: readonly StoreLife[]; refreshProblem?: string }): {
  deps: KeepAliveTouchDeps;
  refreshed: string[];
} {
  const queue = [...lives];
  const refreshed: string[] = [];
  return {
    deps: {
      nowIso: () => NOW,
      readLife: () => queue.shift()!,
      refresh: ({ storeDir }) => {
        refreshed.push(storeDir);
        return refreshProblem;
      },
    },
    refreshed,
  };
}

describe("touchVerdict", () => {
  it("pins the CLI's own five-minute refresh window", () => {
    expect(CLI_REFRESH_WINDOW_MINUTES).toBe(5);
  });

  it("runs nothing for a token with more life than the window, which a refresh would leave untouched", () => {
    expect(touchVerdict({ life: lifeExpiring({ expiresAtIso: "2026-11-11T12:06:00.000Z" }), nowIso: NOW })).toEqual({
      expiresAtIso: "2026-11-11T12:06:00.000Z",
      kind: "live",
    });
  });

  it("refreshes a token inside the window", () => {
    expect(touchVerdict({ life: lifeExpiring({ expiresAtIso: "2026-11-11T12:04:00.000Z" }), nowIso: NOW })).toEqual({
      kind: "refresh",
    });
  });

  it("refreshes an already expired token behind a live grant, the case that raised the sign-in note", () => {
    expect(touchVerdict({ life: lifeExpiring({ expiresAtIso: "2026-11-11T04:39:00.000Z" }), nowIso: NOW })).toEqual({
      kind: "refresh",
    });
  });

  it.each([
    [{ alias: "plan-five", hasCredential: false, hasRefreshToken: false, unreadable: true }, "unreadable-store"],
    [{ alias: "plan-five", hasCredential: false, hasRefreshToken: true }, "no-credential"],
    [{ alias: "plan-five", hasCredential: true, hasRefreshToken: true }, "unknown-access-expiry"],
    [{ ...lifeExpiring({ expiresAtIso: NOW }), hasRefreshToken: false }, "no-refresh-token"],
    [{ alias: "plan-five", expiresAtIso: NOW, hasCredential: true, hasRefreshToken: true }, "unknown-refresh-expiry"],
    [{ ...lifeExpiring({ expiresAtIso: NOW }), refreshExpiresAtIso: "2026-11-10T00:00:00.000Z" }, "refresh-expired"],
  ] satisfies [StoreLife, string][])("holds a store a refresh cannot repair: %o is %s", (life, reason) => {
    expect(touchVerdict({ life, nowIso: NOW })).toEqual({ kind: "hold", reason });
  });

  it("holds on an unparseable clock rather than judging against it", () => {
    expect(touchVerdict({ life: lifeExpiring({ expiresAtIso: NOW }), nowIso: "not-a-time" })).toEqual({
      kind: "hold",
      reason: "invalid-now",
    });
  });
});

describe("touchOneStore", () => {
  it("counts a touch only when the expiry moved forward across the refresh", () => {
    const { deps, refreshed } = seams({
      lives: [
        lifeExpiring({ expiresAtIso: "2026-11-11T11:58:00.000Z" }),
        lifeExpiring({ expiresAtIso: "2026-11-11T20:00:00.000Z" }),
      ],
    });

    expect(touchOneStore({ account: ACCOUNT, deps })).toEqual({
      afterExpiresAtIso: "2026-11-11T20:00:00.000Z",
      alias: "plan-five",
      kind: "refreshed",
    });
    expect(refreshed).toEqual(["/stores/five"]);
  });

  it("reports a refresh that exited cleanly but left the expiry where it was, and records no touch", () => {
    const stuck = lifeExpiring({ expiresAtIso: "2026-11-11T11:58:00.000Z" });
    const { deps } = seams({ lives: [stuck, stuck] });
    const result = touchOneStore({ account: ACCOUNT, deps });

    expect(result.kind).toBe("failed");
    expect(touchProblemLine({ result })).toContain("plan-five: refresh did not advance the expiry — ");
  });

  it("runs NO command for a store with life left beyond the window, so no process starts for nothing", () => {
    const { deps, refreshed } = seams({ lives: [lifeExpiring({ expiresAtIso: "2026-11-11T15:00:00.000Z" })] });
    const result = touchOneStore({ account: ACCOUNT, deps });

    expect(result).toEqual({ alias: "plan-five", expiresAtIso: "2026-11-11T15:00:00.000Z", kind: "live" });
    expect(refreshed).toEqual([]);
    expect(touchProblemLine({ result })).toBeUndefined();
  });

  it("runs NO command for a signed-out store, and says so", () => {
    const { deps, refreshed } = seams({
      lives: [{ alias: "plan-five", hasCredential: false, hasRefreshToken: false }],
    });
    const result = touchOneStore({ account: ACCOUNT, deps });

    expect(refreshed).toEqual([]);
    expect(touchProblemLine({ result })).toBe("plan-five: not refreshed — no-credential");
  });
});

describe("storesClearedForRepair", () => {
  const PROBED = ["plan-one", "plan-two", "plan-five"] as const;

  it("clears every store but the resolved active plan and the one holding the slot's credential", () => {
    const cleared = storesClearedForRepair({
      active: "plan-one",
      activeFrom: "identified",
      probed: PROBED,
      sharesActiveCredential: ["plan-two"],
    });

    expect(cleared).toEqual(["plan-five"]);
  });

  it("holds the active plan back even once its bytes no longer match the slot, which the byte check alone missed", () => {
    const cleared = storesClearedForRepair({
      active: "plan-five",
      activeFrom: "identified",
      probed: PROBED,
      sharesActiveCredential: [],
    });

    expect(cleared).toEqual(["plan-one", "plan-two"]);
  });

  // A deduced active plan is overturned when a repaired store's re-probe names the slot's
  // organisation, after that store's refresh already ran. An inferred answer clears no repair at all.
  it.each(["deduced", "recorded"] as const)("clears nothing when the active plan was only %s", (activeFrom) => {
    const cleared = storesClearedForRepair({
      active: "plan-one",
      activeFrom,
      probed: PROBED,
      sharesActiveCredential: [],
    });

    expect(cleared).toEqual([]);
  });

  it("clears nothing when no plan could be named active, since any store could be the live one", () => {
    const cleared = storesClearedForRepair({ activeFrom: "unknown", probed: PROBED, sharesActiveCredential: [] });

    expect(cleared).toEqual([]);
  });

  it("holds the store this process is booted against", () => {
    const cleared = storesClearedForRepair({
      active: "plan-two",
      activeFrom: "pinned",
      probed: PROBED,
      sharesActiveCredential: [],
    });

    expect(cleared).toEqual(["plan-one", "plan-five"]);
  });

  it("clears every unshared store when the slot holds no live credential", () => {
    const cleared = storesClearedForRepair({
      activeFrom: "none",
      probed: PROBED,
      sharesActiveCredential: ["plan-one"],
    });

    expect(cleared).toEqual(["plan-two", "plan-five"]);
  });
});

describe("touchesHeldByBothDecisions", () => {
  const planWith = ({ active, touch }: { active: string; touch: readonly string[] }): WatchTickPlan => ({
    active,
    activeFrom: "identified",
    held: [],
    outcome: { act: "hold", why: "nothing to do" },
    rotationScope: "default-slot",
    touch,
    touchSkipped: [],
    why: "a tick",
  });

  // The first probes deduce plan-one active; a repaired plan-two then identifies as the slot's
  // account, and the second decision would touch plan-one, which the first held back.
  it("holds a store the first decision protected even when the re-decided plan would touch it", () => {
    const plan = touchesHeldByBothDecisions({
      first: planWith({ active: "plan-one", touch: ["plan-three"] }),
      second: planWith({ active: "plan-two", touch: ["plan-one", "plan-three"] }),
    });

    expect(plan.touch).toEqual(["plan-three"]);
    expect(plan.active).toBe("plan-two");
    expect(plan.touchSkipped).toHaveLength(1);
    expect(plan.touchSkipped[0]).toContain(
      "plan-one is not being touched because this tick's first probes held it back",
    );
  });

  it("returns the re-decided plan unchanged when both decisions agree", () => {
    const second = planWith({ active: "plan-two", touch: ["plan-three"] });

    expect(touchesHeldByBothDecisions({ first: planWith({ active: "plan-two", touch: ["plan-three"] }), second })).toBe(
      second,
    );
  });
});
