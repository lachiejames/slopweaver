/**
 * `remove` takes exactly one row off the register — every other row kept byte for byte and in order — and records
 * its alias and store, so a later `add` may bring that alias back only at that same store. A pinned row, a paused
 * row and a provider's last row all remove, because each leaves a register every reader already takes as valid.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { prepareRegisterChange } from "../../../plans/mutate.js";
import { parsePlanRegister, pinnedPlanFor } from "../../../plans/register.js";
import { removedPlans } from "../../../plans/removed.js";
import type { PlanMutation, PlanRegisterSnapshot, RegisteredPlan } from "../../../plans/types.js";

const AT = "2026-11-06T02:00:00.000Z";

const registered = ({ rows }: { rows: readonly Readonly<Record<string, unknown>>[] }): PlanRegisterSnapshot => ({
  ...unwrap(parsePlanRegister({ value: { rows, version: 1 } })),
  source: "registered",
});

const BASE_ROWS: readonly Readonly<Record<string, unknown>>[] = [
  { alias: "plan-one", note: "kept by an older writer", pinned: null, provider: "claude", storeDir: "/c1" },
  { alias: "plan-two", pinned: true, provider: "claude", storeDir: "/c2" },
  { alias: "codex-ambient", provider: "codex", storeDir: "/x0" },
  { alias: "codex-one", provider: "codex", storeDir: "/x1" },
];

const remove = ({ alias, provider }: { alias: string; provider: "claude" | "codex" }): PlanMutation => ({
  alias,
  kind: "remove",
  provider,
  removedAtIso: AT,
});

const added = (over: Partial<RegisteredPlan>): PlanMutation => ({
  kind: "add",
  row: {
    alias: "codex-ambient",
    allowance: { kind: "weekly-window" },
    provider: "codex",
    storeDir: "/x0",
    usageLimitPercent: 100,
    ...over,
  },
});

describe("prepareRegisterChange — remove", () => {
  it("drops only the named row, keeps every other raw row exactly, and records the alias with its store", () => {
    const changed = unwrap(
      prepareRegisterChange({
        mutation: remove({ alias: "codex-ambient", provider: "codex" }),
        snapshot: registered({ rows: BASE_ROWS }),
      }),
    );

    expect(changed.document.rows).toStrictEqual([BASE_ROWS[0], BASE_ROWS[1], BASE_ROWS[3]]);
    expect(removedPlans({ document: changed.document })).toStrictEqual([
      { alias: "codex-ambient", provider: "codex", removedAtIso: AT, storeDir: "/x0" },
    ]);
  });

  it("removes the pinned Claude row, leaving no pin rather than moving it", () => {
    const changed = unwrap(
      prepareRegisterChange({
        mutation: remove({ alias: "plan-two", provider: "claude" }),
        snapshot: registered({ rows: BASE_ROWS }),
      }),
    );

    expect(changed.plans.map((plan) => plan.alias)).toStrictEqual(["plan-one", "codex-ambient", "codex-one"]);
    expect(pinnedPlanFor({ plans: changed.plans, provider: "claude" })).toBeUndefined();
  });

  it("removes a provider's last row, leaving a register with none of that provider", () => {
    const one = unwrap(
      prepareRegisterChange({
        mutation: remove({ alias: "plan-one", provider: "claude" }),
        snapshot: registered({ rows: BASE_ROWS }),
      }),
    );
    const none = unwrap(
      prepareRegisterChange({ mutation: remove({ alias: "plan-two", provider: "claude" }), snapshot: one }),
    );

    expect(none.plans.map((plan) => `${plan.provider}:${plan.alias}`)).toStrictEqual([
      "codex:codex-ambient",
      "codex:codex-one",
    ]);
  });

  it("removes a paused row", () => {
    const rows = [{ ...BASE_ROWS[0], paused: { reason: "lapsed", sinceIso: "2026-11-01T00:00:00.000Z" } }];
    const changed = unwrap(
      prepareRegisterChange({
        mutation: remove({ alias: "plan-one", provider: "claude" }),
        snapshot: registered({ rows }),
      }),
    );

    expect(changed.document.rows).toStrictEqual([]);
  });

  it("refuses an alias the named provider does not carry, even when the other provider does", () => {
    const refused = unwrapErr(
      prepareRegisterChange({
        mutation: remove({ alias: "plan-one", provider: "codex" }),
        snapshot: registered({ rows: BASE_ROWS }),
      }),
    );

    expect(refused.code).toBe("UNKNOWN_DESTINATION");
  });

  it("refuses on an install that has adopted nothing, so a removal never adopts as a side effect", () => {
    const refused = unwrapErr(
      prepareRegisterChange({
        mutation: remove({ alias: "plan-one", provider: "claude" }),
        snapshot: { ...registered({ rows: BASE_ROWS }), source: "derived" },
      }),
    );

    expect(refused.code).toBe("MUTATION_CONFLICT");
    expect(refused.message).toContain("slopweaver plans adopt");
  });
});

describe("prepareRegisterChange — add after remove", () => {
  const removed = (): PlanRegisterSnapshot =>
    unwrap(
      prepareRegisterChange({
        mutation: remove({ alias: "codex-ambient", provider: "codex" }),
        snapshot: registered({ rows: BASE_ROWS }),
      }),
    );

  it("refuses the removed alias at a DIFFERENT store, naming the store it may come back at", () => {
    const refused = unwrapErr(prepareRegisterChange({ mutation: added({ storeDir: "/x9" }), snapshot: removed() }));

    expect(refused.code).toBe("MUTATION_CONFLICT");
    expect(refused.message).toBe(
      "that change cannot be applied to the register as it stands: the codex plan `codex-ambient` was removed at 2026-11-06T02:00:00.000Z " +
        "while it named /x0; its usage snapshots, quota cache, identity assertion and rotation holds are keyed by " +
        "that alias, so a different store takes a new alias — or re-add `codex-ambient` at /x0 to restore it",
    );
  });

  it("restores the removed alias at its own store and forgets the removal", () => {
    const restored = unwrap(prepareRegisterChange({ mutation: added({}), snapshot: removed() }));

    expect(restored.plans.map((plan) => `${plan.provider}:${plan.alias}`)).toStrictEqual([
      "claude:plan-one",
      "claude:plan-two",
      "codex:codex-one",
      "codex:codex-ambient",
    ]);
    expect(removedPlans({ document: restored.document })).toStrictEqual([]);
    expect(Object.keys(restored.document)).not.toContain("removed");
  });

  it("lets the same alias under the OTHER provider through, since aliases are unique per provider", () => {
    const other = unwrap(
      prepareRegisterChange({ mutation: added({ provider: "claude", storeDir: "/c9" }), snapshot: removed() }),
    );

    expect(other.plans.filter((plan) => plan.alias === "codex-ambient").map((plan) => plan.provider)).toStrictEqual([
      "claude",
    ]);
  });
});
