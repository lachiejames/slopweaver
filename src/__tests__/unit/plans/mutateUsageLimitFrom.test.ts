/**
 * `set-usage-limit --from`: the compare-and-swap the Fleet page's raise rides, judged against the row read inside
 * the write, so a press off a stale page moves nothing.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { applyPlanMutation } from "../../../plans/mutate.js";
import { findRegisteredPlan, parsePlanRegister } from "../../../plans/register.js";
import type { PlanRegisterSnapshot } from "../../../plans/types.js";

const base = (): PlanRegisterSnapshot =>
  unwrap(
    parsePlanRegister({
      value: {
        rows: [
          { alias: "plan-one", note: "kept by an older writer", pinned: null, provider: "claude", storeDir: "/c1" },
          { alias: "plan-two", provider: "claude", storeDir: "/c2" },
          { alias: "codex-spare", provider: "codex", storeDir: "/x2" },
        ],
        version: 1,
      },
    }),
  );

describe("applyPlanMutation set-usage-limit --from", () => {
  it("applies a change whose --from matches the row's limit", () => {
    const raised = unwrap(
      applyPlanMutation({
        mutation: {
          alias: "plan-two",
          allowance: { kind: "weekly-window" },
          fromUsageLimitPercent: 100,
          kind: "set-usage-limit",
          provider: "claude",
          usageLimitPercent: 40,
        },
        snapshot: base(),
      }),
    );
    expect(findRegisteredPlan({ alias: "plan-two", plans: raised.plans, provider: "claude" })!.usageLimitPercent).toBe(
      40,
    );
  });

  it("refuses a change whose --from the row no longer carries, naming both limits, so a stale press moves nothing", () => {
    const error = unwrapErr(
      applyPlanMutation({
        mutation: {
          alias: "plan-two",
          allowance: { kind: "weekly-window" },
          fromUsageLimitPercent: 30,
          kind: "set-usage-limit",
          provider: "claude",
          usageLimitPercent: 40,
        },
        snapshot: base(),
      }),
    );
    expect(error.code).toBe("MUTATION_CONFLICT");
    expect(error.message).toContain(
      "`plan-two`'s usage limit is now 100%, not the 30% this change was read as moving from — read the plan again before changing it",
    );
  });

  it("refuses a --from change read off a weekly row since moved to a monthly spend, so it cannot turn it back", () => {
    const monthly = unwrap(
      applyPlanMutation({
        mutation: {
          alias: "codex-spare",
          allowance: { kind: "monthly-spend" },
          kind: "set-usage-limit",
          provider: "codex",
          usageLimitPercent: 30,
        },
        snapshot: base(),
      }),
    );
    const error = unwrapErr(
      applyPlanMutation({
        mutation: {
          alias: "codex-spare",
          allowance: { kind: "weekly-window" },
          fromUsageLimitPercent: 30,
          kind: "set-usage-limit",
          provider: "codex",
          usageLimitPercent: 40,
        },
        snapshot: monthly,
      }),
    );
    expect(error.code).toBe("MUTATION_CONFLICT");
    expect(error.message).toContain(
      "`codex-spare`'s usage limit is now of its monthly-spend allowance, not the weekly-window one this change was read from — read the plan again before changing it",
    );
  });
});
