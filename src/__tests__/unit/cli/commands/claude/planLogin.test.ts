/**
 * The binding `claude reset` and `claude spend` both open with, over injected effects: the exit each missing piece
 * ends on, and that a good binding hands back the proven login with its account and enrollment.
 */
import { describe, expect, it } from "vitest";

import { ok } from "#lib/result.js";

import type { ClaudeIdentityAssertion } from "../../../../../claude/identityAssertions.js";
import { bindPlanLogin, type PlanLoginDeps } from "../../../../../cli/commands/claude/planLogin.js";
import { EXIT_EXPECTED_EMPTY, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

const ORG = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
const NOW = "2026-11-04T10:00:00.000Z";

const ASSERTION: ClaudeIdentityAssertion = {
  alias: "plan-six",
  assertedAtIso: "2026-11-01T00:00:00.000Z",
  email: "six@example.test",
  organizationId: ORG,
};

/** Deps over one configured plan whose sign-in the probe proves to be `probedOrg`. */
function depsOf({
  assertions = [ASSERTION],
  probedOrg = ORG,
}: {
  assertions?: readonly ClaudeIdentityAssertion[];
  probedOrg?: string;
}): PlanLoginDeps {
  return {
    login: {
      probe: async () => ({ organizationId: probedOrg, status: 200 }),
      read: ({ storeDir }) =>
        storeDir === undefined
          ? {
              claudeAiOauth: {
                accessToken: "fake-access",
                expiresAt: Date.parse("2026-11-04T16:00:00Z"),
                scopes: ["user:profile"],
              },
            }
          : undefined,
    },
    nowIso: () => NOW,
    readAccounts: async () => ok([{ alias: "plan-six", storeDir: "/fixture/store-six" }]),
    readAssertions: () => assertions,
  };
}

describe("bindPlanLogin", () => {
  it("binds a plan to the sign-in its probe proves", async () => {
    const bound = await bindPlanLogin({ alias: "plan-six", deps: depsOf({}), home: "/fixture", verb: "claude spend" });
    expect(bound).toEqual({
      account: { alias: "plan-six", storeDir: "/fixture/store-six" },
      assertion: ASSERTION,
      login: expect.objectContaining({ source: "default-slot" }),
    });
  });

  it("refuses a plan the register does not name as a caller mistake", async () => {
    const bound = await bindPlanLogin({ alias: "plan-nine", deps: depsOf({}), home: "/fixture", verb: "claude spend" });
    expect(bound).toBe(EXIT_USAGE);
  });

  it("ends on expected-empty for a plan no enrollment binds", async () => {
    const bound = await bindPlanLogin({
      alias: "plan-six",
      deps: depsOf({ assertions: [] }),
      home: "/fixture",
      verb: "claude reset",
    });
    expect(bound).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("ends on expected-empty when the only sign-in proves to be another organisation's", async () => {
    const bound = await bindPlanLogin({
      alias: "plan-six",
      deps: depsOf({ probedOrg: "a0000075-0000-4000-8000-000000000081" }),
      home: "/fixture",
      verb: "claude spend",
    });
    expect(bound).toBe(EXIT_EXPECTED_EMPTY);
  });
});
