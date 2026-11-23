import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type PlanEmail, planSignInGap, planSignInGapLine, readPlanEmailsOver } from "../../../hand/planSignIn.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../planRegisterFixture.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** A throwaway home whose `plans.json` registers one Claude plan with a cached address. */
function homeWithOnePlan(): string {
  const home = mkdtempSync(join(tmpdir(), "plan-sign-in-"));
  homes.push(home);
  const path = stateHomePaths({ home }).plansJson;
  mkdirSync(dirname(path), { recursive: true });
  const row = { alias: "plan-a", email: "plan-a@acme.example", provider: "claude", storeDir: join(home, "plan-a") };
  writeFileSync(path, JSON.stringify({ rows: [row], version: 1 }), "utf8");
  return home;
}

describe("readPlanEmailsOver", () => {
  it("reads each registered plan's alias and cached address through the port", async () => {
    const plans = await readPlanEmailsOver({ home: homeWithOnePlan(), port: memoryPlanRegisterPort() });
    expect(plans.filter((plan) => plan.alias === "plan-a")).toEqual([
      { alias: "plan-a", email: "plan-a@acme.example" },
    ]);
  });

  it("answers no plans, never a refusal, when the register store cannot be read", async () => {
    expect(await readPlanEmailsOver({ home: homeWithOnePlan(), port: unavailablePlanRegisterPort() })).toEqual([]);
  });
});

/** The register as `slopweaver plans list` printed it, three rows of it. */
const PLANS: readonly PlanEmail[] = [
  { alias: "plan-three", email: "plan-three@acme.x.test" },
  { alias: "plan-five", email: "claude-five@slopweaver.ai" },
  { alias: "codex-three", email: "ada-owner-codex-3@slopweaver.ai" },
];

describe("planSignInGap", () => {
  it("passes a sign-in that names the plan by its address", () => {
    expect(
      planSignInGap({ plans: PLANS, text: "Sign in to plan-five (claude-five@slopweaver.ai) with claude login" }),
    ).toBeUndefined();
  });

  it("names the address a sign-in naming only the alias is missing", () => {
    expect(planSignInGap({ plans: PLANS, text: "Sign in to plan-three so its reset can be claimed" })).toEqual({
      alias: "plan-three",
      email: "plan-three@acme.x.test",
      kind: "alias-without-email",
    });
  });

  it("reads the alias the way the owner says it — Plan 3 — as the same plan", () => {
    expect(planSignInGap({ plans: PLANS, text: "Log into Plan 3 please" })).toEqual({
      alias: "plan-three",
      email: "plan-three@acme.x.test",
      kind: "alias-without-email",
    });
  });

  it("does not read an alias out of another plan's address", () => {
    expect(
      planSignInGap({ plans: PLANS, text: "Sign in as ada-owner-codex-3@slopweaver.ai on Codex (codex-three)" }),
    ).toBeUndefined();
  });

  it("asks which plan when a Claude plan sign-in names none", () => {
    expect(planSignInGap({ plans: PLANS, text: "Will you sign in one plan with a normal claude login?" })).toEqual({
      emails: ["plan-three@acme.x.test", "claude-five@slopweaver.ai", "ada-owner-codex-3@slopweaver.ai"],
      kind: "plan-unnamed",
    });
  });

  it("asks which plan when the sign-in's object is a Codex plan", () => {
    expect(planSignInGap({ plans: PLANS, text: "Sign in to the Codex plan again" })).toEqual({
      emails: ["plan-three@acme.x.test", "claude-five@slopweaver.ai", "ada-owner-codex-3@slopweaver.ai"],
      kind: "plan-unnamed",
    });
  });

  it("does not read another provider's sign-in as a plan's because a plan is mentioned beside it", () => {
    expect(
      planSignInGap({ plans: PLANS, text: "Sign in to Typeform — the Claude plan resync waits on it" }),
    ).toBeUndefined();
  });

  it("does not read an alias in another sentence as the object of a sign-in", () => {
    expect(planSignInGap({ plans: PLANS, text: "Sign in to Typeform; plan-three is at 86%" })).toBeUndefined();
  });

  it("reads an alias in the same sentence as the sign-in as the plan to sign into", () => {
    expect(planSignInGap({ plans: PLANS, text: "Plan-three is signed out, so sign in again." })).toEqual({
      alias: "plan-three",
      email: "plan-three@acme.x.test",
      kind: "alias-without-email",
    });
  });

  it("reads the split form — sign the plan back in — as a sign-in of the alias it names", () => {
    expect(
      planSignInGap({ plans: PLANS, text: "Sign Codex plan codex-three back in.\nThe new sign-in clears it" }),
    ).toEqual({ alias: "codex-three", email: "ada-owner-codex-3@slopweaver.ai", kind: "alias-without-email" });
  });

  it("judges nothing that is not a sign-in, even when it names an alias", () => {
    expect(planSignInGap({ plans: PLANS, text: "Move the spawns off plan-three onto plan-one" })).toBeUndefined();
  });

  it("does not read logging a plan's usage in somewhere as a sign-in", () => {
    expect(planSignInGap({ plans: PLANS, text: "Log plan-three usage in the journal" })).toBeUndefined();
  });

  it("asks for nothing on an alias whose row caches no address", () => {
    expect(
      planSignInGap({ plans: [{ alias: "plan-six", email: undefined }], text: "Sign in to plan-six" }),
    ).toBeUndefined();
  });

  it("says the address to add in the refusal", () => {
    expect(
      planSignInGapLine({
        gap: { alias: "plan-three", email: "plan-three@acme.x.test", kind: "alias-without-email" },
      }),
    ).toContain("add plan-three@acme.x.test");
  });
});
