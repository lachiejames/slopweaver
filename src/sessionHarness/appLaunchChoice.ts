/**
 * The plan choice an app launch carries to its ledger row (`./appLaunch.ts`): the Claude credential gate sets it on
 * the plan it allowed, and the opened session reports it beside its address, so the row records the plan that
 * actually booted (`./recordingHarness.ts`). The app's wire spec never carries it (`./appLaunchSpec.ts` builds that
 * field by field), which is why it is captured off the gate rather than read back from the app.
 */
import type { SessionPlanChoice } from "../sessions/planChoice.js";
import type { AppLaunchDeps } from "./appLaunch.js";
import type { HarnessOpenedSession } from "./launch.js";

/**
 * The launch's deps with the Claude gate wrapped so the plan choice it set on the plan it allowed is kept — the
 * choice of the plan that actually boots.
 *
 * @param deps the launch's own deps
 * @returns the wrapped deps, and a reader of the choice the gate set, undefined until it allowed a plan carrying one
 */
export function gateChoiceCapture({ deps }: { deps: AppLaunchDeps }): {
  deps: AppLaunchDeps;
  choice: () => SessionPlanChoice | undefined;
} {
  let choice: SessionPlanChoice | undefined;
  const wrapped: AppLaunchDeps = {
    ...deps,
    gateClaudeCredential: async ({ plan }) => {
      const allowed = await deps.gateClaudeCredential({ plan });
      if (allowed.isOk()) {
        choice = allowed.value.planChoice;
      }
      return allowed;
    },
  };
  return { choice: () => choice, deps: wrapped };
}

/**
 * An opened session carrying the gate's plan choice, when the gate set one.
 *
 * @param choice the captured choice
 * @param opened the session the app opened
 * @returns the session, with the choice beside it
 */
export function carryingGateChoice({
  choice,
  opened,
}: {
  choice: SessionPlanChoice | undefined;
  opened: HarnessOpenedSession;
}): HarnessOpenedSession {
  if (choice === undefined) {
    return opened;
  }
  return { ...opened, planChoice: choice };
}
