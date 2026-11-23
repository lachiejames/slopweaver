/**
 * The relaunch half of a `cmux reseat` pass, once a seat is planned: route its credential, pace, clear what runs in
 * the surface, type the line and read it back — and the COLD entry that plans a bare-shell seat straight into it.
 *
 * The order, and why a process that outlives its stop gets nothing typed, is `./reseatPass.ts`'s header; reading a
 * tab cold is `./reseatCold.ts`.
 *
 * A relaunch is confirmed only on a LIVE session inside this tab at a Claude composer — the read-back is
 * `./reseatReadback.ts`'s, over `../../../sessions/reseatConfirmation.ts`; a resume that prints `No conversation found`
 * is relaunched fresh ONCE, and a fresh seat is reported `fresh-seated`, never `reseated` (`./reseatPass.ts`'s header).
 */
import { err, ok, type Result } from "#lib/result.js";

import type { CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { type ReseatLaunch, reseatLine } from "../../../cmux/reseatLine.js";
import { isPinnedSupervisorWorkspace } from "../../../cmux/supervisorWorkspace.js";
import { ttyLineOverflow } from "../../../cmux/ttyLineLimit.js";
import type { ReseatPlan } from "../../../sessions/reseat.js";
import { planColdReseat } from "../../../sessions/reseatCold.js";
import type { ReseatConfirmation } from "../../../sessions/reseatConfirmation.js";
import { type ReseatError, ReseatErrors } from "../../../sessions/reseatErrors.js";
import type { ReseatOutcome } from "../../../sessions/reseatOutcome.js";
import { coldWhy, judgeWorkspaceAtPrompt, judgeWorkspaceCold } from "./reseatCold.js";
import type { ReseatDeps } from "./reseatPass.js";
import { awaitPromptAfterFailedResume, RESEAT_CONFIRM_SECONDS, typeAndConfirm } from "./reseatReadback.js";

/** How long the old `claude` gets to exit after SIGTERM before the relaunch is abandoned. */
export const RESEAT_STOP_SECONDS = 15;

/**
 * Whether a workspace is the chair, by the recorded pin or by cmux's own pin and title.
 *
 * @param deps the pass's effects, carrying the recorded pin's workspace
 * @param workspace the workspace to judge
 * @returns true for the supervisor's workspace
 */
export function isChair({ deps, workspace }: { deps: ReseatDeps; workspace: CmuxWorkspaceSummary }): boolean {
  if (workspace.workspaceId === deps.chairWorkspaceId) {
    return true;
  }
  return isPinnedSupervisorWorkspace({ pinned: workspace.pinned, title: workspace.title });
}

/**
 * Make the surface ready to type into: stop a live prior, wait for it to go and read that its shell is what is left, or
 * re-check a cold tab is STILL a bare shell. Answers the pids already carrying the session id, which the read-back must
 * not mistake for the relaunch.
 *
 * RESIDUE, stated: this read and the `sendLine` that follows it are two calls, and
 * cmux offers no "type only if still at a prompt". A program the owner starts in the instant between them receives the line,
 * and a shell a same-owner helper stops with a signal in that instant holds the line queued on its pty, state `T`,
 * which the read-back after the send reports as a timeout. No process read closes that
 * window, whatever changes inside it; what narrows it is that nothing deliberate runs between the read and the send,
 * and what would close it is a typed send cmux refuses when the surface's foreground changed since a given read.
 */
async function clearPrior({
  deps,
  plan,
}: {
  deps: ReseatDeps;
  plan: ReseatPlan;
}): Promise<Result<ReadonlySet<number>, ReseatError>> {
  if (plan.prior.kind === "live") {
    if (!(await deps.stop({ pid: plan.prior.pid }))) {
      return err(ReseatErrors.killTimeout({ pid: plan.prior.pid, seconds: RESEAT_STOP_SECONDS }));
    }
    // The stop left the shell is what the typed line assumes; read that it did.
    const prompt = await judgeWorkspaceAtPrompt({ deps, workspace: plan.workspace });
    if (prompt.isErr()) {
      return err(prompt.error);
    }
    if (prompt.value.kind !== "at-prompt") {
      return err(
        ReseatErrors.notAtPrompt({
          pid: plan.prior.pid,
          why: prompt.value.why,
          workspaceRef: plan.workspace.workspaceRef,
        }),
      );
    }
    return ok(new Set([plan.prior.pid]));
  }
  // The registry is read BEFORE the cold judgement, so the tab's tree is the last read before the send.
  const registry = deps.readRegistry();
  if (registry.isErr()) {
    return err(ReseatErrors.cmuxReadFailed({ cause: registry.error, what: "Claude Code's session registry" }));
  }
  const prior = new Set(
    registry.value.filter((record) => record.sessionId === plan.sessionId).map((record) => record.pid),
  );
  const still = await judgeWorkspaceCold({ deps, pinnedSessionId: plan.sessionId, workspace: plan.workspace });
  if (still.isErr()) {
    return err(still.error);
  }
  if (still.value.kind !== "cold") {
    return err(
      ReseatErrors.notCold({ why: coldWhy({ verdict: still.value }), workspaceRef: plan.workspace.workspaceRef }),
    );
  }
  return ok(prior);
}

/**
 * The relaunch line for one seat, refused when it would overflow the tty's line limit.
 *
 * @param plan the seat's relaunch
 * @param credential where the routed plan's store and token live
 * @returns the line, or the `RELAUNCH_FAILED` refusal naming the way back
 */
function composeLine({
  plan,
  launch,
  credential,
}: {
  plan: ReseatPlan;
  launch: ReseatLaunch;
  credential: { readonly storeDir?: string; readonly tokenPath?: string };
}): Result<string, ReseatError> {
  const line = reseatLine({
    input: {
      effort: plan.effort,
      envPrefix: plan.envPrefix,
      launch,
      model: plan.model,
      pluginDir: plan.pluginDir,
      storeDir: credential.storeDir,
      templateSuffix: plan.templateSuffix,
      tokenPath: credential.tokenPath,
    },
  });
  const overflow = ttyLineOverflow({ line });
  return overflow === null
    ? ok(line)
    : err(
        ReseatErrors.relaunchFailed({
          afterStop: false,
          cause: overflow,
          step: "composing the relaunch line",
          workspaceRef: plan.workspace.workspaceRef,
        }),
      );
}

/**
 * Route, wait, stop, send and confirm one planned seat.
 *
 * @param deps the pass's effects
 * @param plan the seat's relaunch, every piece decided
 * @returns what happened
 */
export async function relaunch({ deps, plan }: { deps: ReseatDeps; plan: ReseatPlan }): Promise<ReseatOutcome> {
  const workspaceRef = plan.workspace.workspaceRef;
  const credential = await deps.routeCredential({ plan });
  if (credential.isErr()) {
    return { error: credential.error, kind: "refused", workspaceRef };
  }
  const composed = composeLine({ credential: credential.value, launch: plan.launch, plan });
  if (composed.isErr()) {
    return { error: composed.error, kind: "refused", workspaceRef };
  }
  if (deps.dryRun) {
    return { kind: "would-reseat", line: composed.value, plan };
  }
  // A worker paces on the boots in flight and then goes; the chair never waits at all.
  if (!plan.chair) {
    await deps.awaitBootSlot();
  }
  const cleared = await clearPrior({ deps, plan });
  if (cleared.isErr()) {
    return { error: cleared.error, kind: "refused", workspaceRef };
  }
  const first = await typeAndConfirm({
    afterStop: plan.prior.kind === "live",
    deps,
    launch: plan.launch,
    line: composed.value,
    plan,
    priorPids: cleared.value,
  });
  if (first.isErr()) {
    return { error: first.error, kind: "refused", workspaceRef };
  }
  if (first.value.kind !== "missing-conversation") {
    return confirmedOutcome({ deps, plan, verdict: first.value, why: "no-transcript" });
  }
  return retryFresh({ credential: credential.value, deps, plan, priorPids: cleared.value });
}

/**
 * The resume printed `No conversation found`: once the tab is back at its prompt, type the same line minus
 * `--resume` ONCE, and report what came of it. A second missing-conversation line is not retried again.
 *
 * @returns the fresh-seated outcome, or the refusal
 */
async function retryFresh({
  deps,
  plan,
  credential,
  priorPids,
}: {
  deps: ReseatDeps;
  plan: ReseatPlan;
  credential: { readonly storeDir?: string; readonly tokenPath?: string };
  priorPids: ReadonlySet<number>;
}): Promise<ReseatOutcome> {
  const workspaceRef = plan.workspace.workspaceRef;
  const launch: ReseatLaunch = { kind: "fresh" };
  const composed = composeLine({ credential, launch, plan });
  if (composed.isErr()) {
    return { error: composed.error, kind: "refused", workspaceRef };
  }
  const atPrompt = await awaitPromptAfterFailedResume({ deps, plan });
  if (atPrompt.isErr()) {
    return { error: atPrompt.error, kind: "refused", workspaceRef };
  }
  const second = await typeAndConfirm({ afterStop: true, deps, launch, line: composed.value, plan, priorPids });
  if (second.isErr()) {
    return { error: second.error, kind: "refused", workspaceRef };
  }
  if (second.value.kind === "missing-conversation") {
    const error = ReseatErrors.unconfirmed({
      seconds: RESEAT_CONFIRM_SECONDS,
      sessionId: "a fresh session",
      workspaceRef,
    });
    return { error, kind: "refused", workspaceRef };
  }
  return confirmedOutcome({ deps, plan, verdict: second.value, why: "missing-conversation" });
}

/** A confirmed read-back as the outcome it is: `reseated` for a resumed id, `fresh-seated` for a new one. */
async function confirmedOutcome({
  deps,
  plan,
  verdict,
  why,
}: {
  deps: ReseatDeps;
  plan: ReseatPlan;
  verdict: Extract<ReseatConfirmation, { readonly kind: "resumed" | "fresh" }>;
  why: "no-transcript" | "missing-conversation";
}): Promise<ReseatOutcome> {
  const seat = await deps.seatLine({ sessionId: verdict.sessionId });
  if (verdict.kind === "resumed") {
    return { kind: "reseated", plan, seat };
  }
  return {
    freshSessionId: verdict.sessionId,
    kind: "fresh-seated",
    plan,
    seat,
    why,
  };
}

/**
 * Resume a COLD workspace — a bare shell with a saved session — on the fleet's own line: routed credential, the
 * session's own model, nothing to stop. Re-judged here, so a tab that warmed up since the caller looked is refused.
 * The caller holds the workspace's reseat lock (`./reseatOperation.ts`): `reseatWorkspace` and `fleet resume` both do.
 *
 * @param deps the pass's effects
 * @param workspace the workspace to relaunch in
 * @param pinnedSessionId the supervisor pin's session id, for the chair's tab only
 * @returns what happened
 */
export async function coldResumeWorkspace({
  deps,
  workspace,
  pinnedSessionId,
}: {
  deps: ReseatDeps;
  workspace: CmuxWorkspaceSummary;
  pinnedSessionId: string | undefined;
}): Promise<ReseatOutcome> {
  const workspaceRef = workspace.workspaceRef;
  if (workspace.workspaceId === deps.ownWorkspaceId) {
    return { error: ReseatErrors.ownWorkspace({ workspaceRef }), kind: "refused", workspaceRef };
  }
  const judged = await judgeWorkspaceCold({ deps, pinnedSessionId, workspace });
  if (judged.isErr()) {
    return { error: judged.error, kind: "refused", workspaceRef };
  }
  const verdict = judged.value;
  if (verdict.kind === "unresumable") {
    const error = ReseatErrors.noResumableSession({ cwd: verdict.cwd, sessionId: verdict.sessionId, workspaceRef });
    return { error, kind: "refused", workspaceRef };
  }
  if (verdict.kind === "not-cold") {
    return { error: ReseatErrors.notCold({ why: verdict.why, workspaceRef }), kind: "refused", workspaceRef };
  }
  const planned = planColdReseat({
    argv: verdict.argv,
    // A pinned id is passed for the chair's tab alone, so it marks the chair even where cmux renumbered the tab.
    chair: pinnedSessionId !== undefined || isChair({ deps, workspace }),
    cwd: verdict.cwd,
    defaults: deps.spawnDefaults({ cwd: verdict.cwd }),
    env: deps.env,
    flagModel: deps.flagModel,
    ledgerModel: deps.ledgerModels.get(workspace.workspaceId),
    ownWorkspaceId: deps.ownWorkspaceId,
    sessionId: verdict.sessionId,
    workspace,
  });
  if (planned.isErr()) {
    return { error: planned.error, kind: "refused", workspaceRef };
  }
  return relaunch({ deps, plan: planned.value });
}
