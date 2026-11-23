/**
 * Wiring the `fresh-visible-session` tier's abstract launch seam (`tier.ts`'s `TierDeps.launchVisibleSession`)
 * to the REAL spawn primitive — the same `bootCmuxWorkspace`/`deliverPickupCommand`/`VisibleSessionPlan`
 * every handover spawn already uses. No second spawning primitive.
 *
 * Deciding the actual `VisibleSessionPlan` for one Slack ask — which worktree, which branch, which pickup
 * text a booted session should receive — is deliberately left to whichever visible host wires this into the
 * live turn path (the host-integration handover that follows this one): that decision needs real production
 * data this handover has no basis for (does an ask-driven session get its own dedicated worktree? reuse the
 * main checkout? something else entirely?). What this module proves is narrower and testable now: given an
 * already-decided plan, the SAME dispatch primitives every other visible-session launch uses open a real,
 * verified surface and report back through `tier.ts`'s own host-neutral contract.
 *
 * ## Boot and pickup delivery are two separate calls, deliberately
 *
 * `launchFreshVisibleSession` only BOOTS the workspace — it sends no pickup command. A fast fresh agent that
 * could otherwise read a screen already reporting a booted host and act before its own dispatch record
 * exists is a real race `turn dispatch` closes by writing the durable record right after this call returns,
 * and only then calling {@link deliverFreshSessionPickup} to send the actual pickup text. Collapsing the two
 * back into one call would reopen exactly that window.
 */

import { deliverPickupCommand } from "../../cmux/pickupDelivery.js";
import type { VisibleSessionPlan } from "../../cmux/plan.js";
import { bootCmuxWorkspace, type PickupDelivery, type SpawnDeps, type SpawnFailureDetail } from "../../cmux/spawn.js";
import { type Result } from "../../lib/result.js";
import type { FreshVisibleSessionRef, VisibleSessionLaunchOutcome } from "./tier.js";

/**
 * Boot a fresh visible session from an already-decided plan — the real spawn primitive, boot half only. No
 * pickup command is sent; see this module's header for why that is deliberate.
 *
 * @param plan which worktree/workspace to open
 * @param deps the spawn effects — a plain fake in every test, `productionSpawnDeps()` from `sessionHarness/recordedSpawn.js` for real
 * @returns the opened session's opaque identity, or why it could not be booted
 */
export async function launchFreshVisibleSession({
  plan,
  deps,
}: {
  plan: VisibleSessionPlan;
  deps: SpawnDeps;
}): Promise<VisibleSessionLaunchOutcome> {
  const outcome = await bootCmuxWorkspace({ deps, plan });
  if (outcome.isErr()) {
    return { reason: outcome.error.reason };
  }
  const opened = outcome.value;
  return {
    session: {
      cwd: plan.cwd,
      host: plan.host,
      sessionName: plan.sessionName,
      surfaceId: opened.surfaceId,
      surfaceRef: opened.surfaceRef,
      workspaceId: opened.workspaceId,
      workspaceRef: opened.workspaceRef,
    },
  };
}

/**
 * Deliver an already-booted session's pickup command and report how far its arrival could be confirmed — the
 * second half, called only once the caller has durably recorded the session {@link launchFreshVisibleSession}
 * opened.
 *
 * The `unwitnessed` arm is passed straight through rather than collapsed into the error: the two carry
 * opposite instructions for the caller, and collapsing them is what recorded a live worker `dispatch-failed`
 * (`../ask/lifecycle.ts`'s `DispatchUnwitnessedEvent`).
 *
 * @param plan the plan naming the pickup text to send
 * @param deps the spawn effects
 * @param session the already-booted session to send into
 * @returns how delivery ended — witnessed, or `unwitnessed`, which is NOT a failure — or the reason the line
 *   could not be SENT at all, or is still TYPED in the composer after its Enter budget (a seat running nothing)
 */
export async function deliverFreshSessionPickup({
  plan,
  deps,
  session,
}: {
  plan: VisibleSessionPlan;
  deps: SpawnDeps;
  session: FreshVisibleSessionRef;
}): Promise<Result<PickupDelivery, SpawnFailureDetail>> {
  const outcome = await deliverPickupCommand({
    deps,
    plan,
    workspace: {
      surfaceId: session.surfaceId,
      surfaceRef: session.surfaceRef,
      workspaceId: session.workspaceId,
      workspaceRef: session.workspaceRef,
    },
  });
  return outcome.map(({ delivery }) => delivery);
}
