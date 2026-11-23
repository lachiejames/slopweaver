/**
 * {@link resolveRequestedClaudePlan} — the plan `cmux spawn --plan` / `cmux reseat --plan` names, resolved against
 * the register. MEASURED: six `--plan plan-one` spawns booted on plan-four because the flag was
 * dropped on the claude driver.
 */
import { describe, expect, it } from "vitest";

import type { ClaudeAccount } from "../../../claude/contracts.js";
import { resolveRequestedClaudePlan } from "../../../claude/requestedPlan.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const ACCOUNTS: readonly ClaudeAccount[] = [
  { alias: "plan-one", storeDir: "/stores/plan-one" },
  {
    alias: "plan-two",
    paused: { reason: "chair seat at 80% week", sinceIso: "2026-10-09T07:13:00.000Z" },
    storeDir: "/stores/plan-two",
  },
  { alias: "plan-three", storeDir: "/stores/plan-three" },
];

describe("resolveRequestedClaudePlan", () => {
  it("returns the named plan's store", () => {
    const resolved = resolveRequestedClaudePlan({ accounts: ACCOUNTS, alias: "plan-three" });

    expect(resolved.isOk()).toBe(true);
    expect(unwrap(resolved).storeDir).toBe("/stores/plan-three");
  });

  it("refuses an alias the register does not carry, listing the ones it does", () => {
    const error = unwrapErr(resolveRequestedClaudePlan({ accounts: ACCOUNTS, alias: "codex-two" }));

    expect(error.code).toBe("REQUESTED_PLAN_UNKNOWN");
    expect(error.message).toBe(
      "--plan codex-two is not a Claude plan; the registered ones are plan-one, plan-two, plan-three",
    );
  });

  it("refuses a PAUSED plan and names the verb that resumes it, so the pause binds a named seat too", () => {
    const error = unwrapErr(resolveRequestedClaudePlan({ accounts: ACCOUNTS, alias: "plan-two" }));

    expect(error.code).toBe("REQUESTED_PLAN_PAUSED");
    expect(error.message).toContain("`slopweaver plans resume --provider claude --plan plan-two`");
  });

  it("says the install registers no Claude plan when the list is empty", () => {
    const error = unwrapErr(resolveRequestedClaudePlan({ accounts: [], alias: "plan-one" }));

    expect(error.code).toBe("REQUESTED_PLAN_UNKNOWN");
    expect(error.message).toBe("--plan plan-one names no Claude plan — this install registers none");
  });
});
