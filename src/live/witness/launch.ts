/**
 * Booting a witness worker AND writing its session-ledger row — the boot half of `./session.ts`'s step 4.
 *
 * A witness worker boots in two halves (`../turn/freshSession.ts`: the boot, then the pickup once the witness
 * journal's own `dispatched` row exists), so no launcher runs to record it on the way past. The row is written the
 * moment the session stands, BEFORE that `dispatched` row, through the same writer `turn dispatch` uses
 * (`../turn/sessionLedger.ts`'s `registerDispatchedSession`, over `recordBootedSession`): keyed by the plan's
 * `sessionName`, the name `claude --name` gave the worker, and never fatal. Every close of it goes through
 * `./close.ts`, so the row is closed by the same act.
 */
import type { VisibleSessionPlan } from "../../cmux/plan.js";
import { registerDispatchedSession } from "../turn/sessionLedger.js";
import type { VisibleSessionLaunchOutcome } from "../turn/tier.js";

/**
 * Boot one witness worker and register the session it opened; a boot that failed writes nothing.
 *
 * @param boot the boot itself — `launchFreshVisibleSession` over `productionSpawnDeps()` for real
 * @param home the state home whose session ledger records the row
 * @param plan the plan the session boots from, whose `sessionName` keys the row
 * @returns the boot's own outcome, unchanged
 */
export async function launchWitnessSession({
  boot,
  home,
  plan,
}: {
  boot: (options: { plan: VisibleSessionPlan }) => Promise<VisibleSessionLaunchOutcome>;
  home: string;
  plan: VisibleSessionPlan;
}): Promise<VisibleSessionLaunchOutcome> {
  const launched = await boot({ plan });
  if ("session" in launched) {
    const { session } = launched;
    registerDispatchedSession({
      home,
      plan,
      surfaceRef: session.surfaceRef,
      workspaceId: session.workspaceId,
      workspaceRef: session.workspaceRef,
    });
  }
  return launched;
}
