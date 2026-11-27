/** The plan choice an app launch captures off its Claude credential gate (`src/sessionHarness/appLaunchChoice.ts`). */
import { describe, expect, it } from "vitest";

import { err, ok, unwrapErr } from "#lib/result.js";
import type { AppLaunchDeps } from "../../../sessionHarness/appLaunch.js";
import { carryingGateChoice, gateChoiceCapture } from "../../../sessionHarness/appLaunchChoice.js";
import { planFromLaunchSpec } from "../../../sessionHarness/cmuxLaunch.js";
import type { HarnessOpenedSession } from "../../../sessionHarness/launch.js";
import { SPEC } from "./recordingLedgerFixtures.js";

const CHOICE = {
  alias: "plan-two",
  alternative: "--plan <alias>",
  basis: "routed",
  kind: "named",
  readings: [{ alias: "plan-two", reading: "all-models week 30%", state: "chosen" }],
  reason: "ranked first of 1 eligible plan(s) for a all-models spawn",
  vendor: "claude",
} as const;

const OPENED: HarnessOpenedSession = {
  bootEvidence: { by: "event", confirmed: true },
  delivery: { kind: "witnessed", witness: { by: "event", confirmed: true } },
  endpointHandle: "app-session-1",
  endpointId: "a0000001",
  handle: "app-session-1",
  initialMessage: "pick up a-doc",
  sessionId: "a0000001",
};

/** Deps whose Claude gate answers `gated`, and whose other effects are never reached by these cases. */
function depsGating({ gated }: { gated: Awaited<ReturnType<AppLaunchDeps["gateClaudeCredential"]>> }): AppLaunchDeps {
  return {
    codexBrowserDoorAt: () => () => ok(undefined),
    ensureWorktree: () => undefined,
    gateClaudeCredential: async () => gated,
    resolvePluginDir: () => undefined,
  };
}

describe("gateChoiceCapture", () => {
  it("keeps the choice the gate set on the plan it allowed", async () => {
    const plan = planFromLaunchSpec({ spec: SPEC });
    const capture = gateChoiceCapture({ deps: depsGating({ gated: ok({ ...plan, planChoice: CHOICE }) }) });
    expect(capture.choice()).toBe(undefined);
    await capture.deps.gateClaudeCredential({ plan });
    expect(capture.choice()).toStrictEqual(CHOICE);
  });

  it("keeps nothing when the gate refused", async () => {
    const plan = planFromLaunchSpec({ spec: SPEC });
    const capture = gateChoiceCapture({ deps: depsGating({ gated: err("every plan is spent this week") }) });
    const answered = await capture.deps.gateClaudeCredential({ plan });
    expect(unwrapErr(answered)).toBe("every plan is spent this week");
    expect(capture.choice()).toBe(undefined);
  });
});

describe("carryingGateChoice", () => {
  it("sets the captured choice beside the opened session", () => {
    expect(carryingGateChoice({ choice: CHOICE, opened: OPENED })).toStrictEqual({ ...OPENED, planChoice: CHOICE });
  });

  it("returns the opened session unchanged when the gate set no choice", () => {
    expect(carryingGateChoice({ choice: undefined, opened: OPENED })).toStrictEqual(OPENED);
  });
});
