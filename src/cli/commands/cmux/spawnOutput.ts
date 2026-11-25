/**
 * What a successful `cmux spawn` prints: by default one receipt line naming the slug and the workspace it opened,
 * and with `--full` the worktree line and the boot-and-pickup detail line it always printed before.
 *
 * MEASURED over 81 supervisor passes (`slopweaver transcripts draw --session <id>` per chair, page
 * `$SLOPWEAVER_HOME/pages/chair-token-waste/index.html`): 3.0 spawns a pass returning a mean 214 tokens, about
 * 24,300 tokens carried a pass, because every later model call that pass reads them again. The supervisor uses
 * the workspace it got; the worktree path and the pickup text are in the session ledger already.
 *
 * A pickup that was resubmitted or never witnessed is a WARNING, not a receipt, so it prints the full detail
 * line whatever the flag says. Pure: the plan and the spawn's outcome in, lines out.
 */
import type { SpawnPlan } from "../../../cmux/plan.js";
import type { PickupDelivery, SpawnedSession } from "../../../cmux/spawn.js";
import type { AppContinuationPlan } from "../../../sessionHarness/appContinuation.js";

/**
 * The one line a spawn prints when an open app session will NOT be continued because the plan it opened on cannot
 * take the seat now: it names the session, the `$CODEX_HOME` it opened on and why, and says the loss plainly — a new
 * session opens and that transcript does not continue. Undefined for every other continuation: a resume says so on
 * the seat line itself (`./codexSeat.ts`'s `reportCodexSeat`, whose `why` names the session), and none says nothing.
 *
 * @param continuation what the spawn decided about the slug's open app session
 * @returns the warning line, or undefined when there is nothing to announce
 */
export function appContinuationLine({ continuation }: { continuation: AppContinuationPlan }): string | undefined {
  if (continuation.kind !== "fresh") {
    return undefined;
  }
  return (
    `cmux spawn: app session ${continuation.previousSessionId} opened on CODEX_HOME=${continuation.previousCodexHome}, ` +
    `which cannot take the seat now (${continuation.reason}) — opening a FRESH session on a newly routed plan, so ` +
    `that session's transcript does not continue here; its ledger row is left open`
  );
}

/**
 * The line printed before a spawn opens its workspace, naming the worktree it creates or reuses.
 *
 * @param plan what the spawn was planned to do
 * @returns the worktree line, which only `--full` prints
 */
export function spawnWorktreeLine({ plan }: { plan: SpawnPlan }): string {
  if (plan.worktreeExists) {
    return `cmux spawn: reusing worktree at ${plan.cwd} (on ${plan.branch})`;
  }
  return `cmux spawn: creating worktree at ${plan.cwd}`;
}

/**
 * How a spawn's detail line reports the pickup's delivery.
 *
 * An unwitnessed delivery is reported plainly and WITHOUT an instruction to resend: the line was accepted by
 * cmux, so a hand-resend is the same duplicate pickup the automatic retry was removed for (`sendPickupOnceThenWitness`,
 * `cmux/pickupWitnessWindow.ts`). What a reader should do instead is look at the workspace — and by the time
 * this line prints, the composer has already been submitted again on the reader's behalf, so the one remedy
 * a hand would reach for is spent too.
 *
 * @param delivery how the spawn reported the pickup landing
 * @returns the clause the detail line ends on
 */
function pickupDeliveryLine({ delivery }: { delivery: PickupDelivery }): string {
  if (delivery.kind === "witnessed") {
    return `witnessed by ${delivery.witness.by}`;
  }
  if (delivery.kind === "resubmitted") {
    return `witnessed by ${delivery.witness.by}, after its composer was submitted again — the line was typed once`;
  }
  return "UNWITNESSED — typed once, its composer submitted again, and never re-typed; it may be queued in that session's input, so read the workspace rather than sending it again";
}

/**
 * The line(s) a successful spawn prints.
 *
 * The detail line names the worktree because the spawn's own output was once the only place the parent saw
 * WHERE it stood the child up; the session ledger now records it too, so it rides `--full`.
 *
 * @param full whether `--full` was passed
 * @param plan what the spawn was planned to do, for the slug, the driver and the worktree
 * @param spawned what it actually opened, including the pickup line and how the delivery ended
 * @returns the one receipt line for an ordinary witnessed spawn, else the detail line
 */
export function spawnSuccessLines({
  full,
  plan,
  spawned,
}: {
  full: boolean;
  plan: SpawnPlan;
  spawned: SpawnedSession;
}): readonly string[] {
  if (!full && spawned.delivery.kind === "witnessed") {
    return [`cmux spawn: ${plan.slug} -> ${spawned.workspaceRef} (${spawned.workspaceId})`];
  }
  return [
    `cmux spawn: ${spawned.workspaceRef} booted ${plan.driver} in ${plan.cwd} and sent "${spawned.pickupCommand}" ` +
      `(boot witnessed by ${spawned.bootWitness.by}, pickup ${pickupDeliveryLine({ delivery: spawned.delivery })})`,
  ];
}
