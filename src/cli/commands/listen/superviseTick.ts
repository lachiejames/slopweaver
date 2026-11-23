/**
 * One `slopweaver listen supervise` death-watch tick: reconcile, count the deaths, and answer carry on, hold,
 * arm, re-arm or escalate — then narrate that answer for the session.
 *
 * Split out of {@link ./supervise.js} when that file passed the size ratchet; the verb there parses its flags
 * and calls this. The shape is the one that file's header gives: this code decides, the visible session acts.
 * Nothing here starts a process — a returned plan carries a command, and the SESSION runs it.
 */
import { randomUUID } from "node:crypto";

import { readSupervisorEventsTail } from "../../../events/store.js";
import { logger } from "../../../lib/logger.js";
import { type ListenScope, UNSCOPED } from "../../../live/listen/scope.js";
import type { ListenerLiveness } from "../../../live/listen/supervise/liveness.js";
import {
  escalationStanding,
  type ListenerDeathReason,
  type RearmDecision,
  rearmDecision,
} from "../../../live/listen/supervise/rearm.js";
import { listenerGrade } from "../../../live/listen/supervise/report.js";
import {
  appendListenerArmEvent,
  clearListenerArm,
  readListenerArm,
  readListenerArmEvents,
} from "../../../live/listen/supervise/store.js";
import {
  listenerDegradedEvent,
  listenerResponseEvent,
  newestListenerKind,
} from "../../../live/listen/supervise/streamEvents.js";
import { type ArmPlan, armPlan } from "./armPlan.js";
import { reconcileTick } from "./listenReconcile.js";
import { deathOf, livenessLine, publish } from "./listenShared.js";

/** What one death-watch tick concluded, and what the session should do about it. */
export type SuperviseOutcome =
  | { readonly action: "none"; readonly liveness: ListenerLiveness }
  /** Nothing is running and nothing may be started automatically: an escalation is standing. */
  | { readonly action: "held"; readonly liveness: ListenerLiveness }
  | { readonly action: "arm"; readonly liveness: ListenerLiveness; readonly plan: ArmPlan }
  | {
      readonly action: "rearm";
      readonly liveness: ListenerLiveness;
      readonly plan: ArmPlan;
      readonly deathsInWindow: number;
    }
  | { readonly action: "escalate"; readonly liveness: ListenerLiveness; readonly why: string };

/**
 * Publish `heartbeat-degraded` when this tick is the FIRST to see a degraded listener.
 *
 * Edge-triggered against the stream's own tail rather than against a remembered value: the tick is a fresh
 * process every fifteen seconds and remembers nothing, so the only thing that can tell it whether the warning
 * already stands is what it already published.
 */
function publishDegraded({ home, liveness, nowMs }: { home: string; liveness: ListenerLiveness; nowMs: number }): void {
  const grade = listenerGrade({ liveness });
  if (grade !== "degraded") {
    return;
  }
  const tail = readSupervisorEventsTail({ home });
  const event = listenerDegradedEvent({
    armId: "armId" in liveness ? liveness.armId : undefined,
    atIso: new Date(nowMs).toISOString(),
    grade,
    pid: "pid" in liveness ? liveness.pid : undefined,
    previousKind: newestListenerKind({ events: tail.isOk() ? tail.value : [] }),
    why: livenessLine({ liveness }),
  });
  if (event !== undefined) {
    publish({ event, home });
  }
}

/**
 * Judge, journal, and decide. Never starts anything — the returned plan is for the session to run.
 *
 * Exported because this is the DECISION, and the command around it only prints what this returned: a test
 * that had to read the printed line back would be asserting on the renderer instead of on what was decided.
 * That division is this file's whole shape — this code decides, the visible session acts.
 *
 * @param home the Slopweaver home whose arm record, journal and heartbeat this tick reads
 * @param queuePath where a re-armed listener should durably append captured tags
 * @returns what the session should do about what this tick found
 */
export function superviseTick({ home, queuePath }: { home: string; queuePath: string }): SuperviseOutcome {
  const nowMs = Date.now();
  // Read BEFORE anything clears it: a re-arm after this arm's death must stay inside the conversations it was
  // scoped to, and the record is the only place that scope survives the process.
  const recorded = readListenerArm({ home });
  const deadArmScope = recorded.isOk() && recorded.value !== undefined ? recorded.value.scope : UNSCOPED;
  // Carried for the same reason the scope is, and read from the same place: a re-arm that dropped these
  // would take thread-reply addressing away from the channels an operator switched it on for, and the only
  // symptom would be replies going unanswered. An older record carries none and reads as switched off.
  const deadArmThreadReplies =
    recorded.isOk() && recorded.value !== undefined ? recorded.value.threadReplyChannels : [];
  if (recorded.isErr()) {
    logger.error({
      msg: `listen supervise: the arm record is unreadable, so any arm command below is UNSCOPED and answers no thread replies — if that listener was scoped or had \`--thread-replies\` switched on, run \`listen arm\` yourself with those flags instead`,
    });
  }
  // RECONCILE FIRST, always — not only when this tick sees a death. A tick that judged only what is in front
  // of it right now is exactly what missed three reaps in a row: by the time anything ran again the
  // listener had been replaced, so the current arm looked healthy and the dead one was never accounted for.
  // Reconciling first means this tick counts those deaths even though it was not alive to watch them.
  const { liveness, problems } = reconcileTick({ home, nowMs });
  for (const problem of problems) {
    logger.error({ msg: `listen supervise: ${problem}` });
  }
  const death = deathOf({ liveness });
  if (death === undefined) {
    publishDegraded({ home, liveness, nowMs });
    return livingOutcome({ home, liveness, queuePath });
  }
  return deathOutcome({
    death,
    home,
    liveness,
    nowMs,
    queuePath,
    scope: deadArmScope,
    threadReplyChannels: deadArmThreadReplies,
  });
}

/**
 * What a tick concludes when nothing died — carry on, hold under a standing escalation, or hand back the
 * command for the arm that is not running.
 */
function livingOutcome({
  home,
  liveness,
  queuePath,
}: {
  home: string;
  liveness: ListenerLiveness;
  queuePath: string;
}): SuperviseOutcome {
  if (liveness.state !== "unarmed") {
    return { action: "none", liveness };
  }
  // An escalation STANDS until a person does something about it. Handing back an arm command here would
  // let the session re-arm on the very next tick and make the whole bounded-retry contract decoration —
  // measured live, which is exactly what the first implementation did.
  const standing = readListenerArmEvents({ home });
  if (standing.isOk() && escalationStanding({ events: standing.value })) {
    return { action: "held", liveness };
  }
  // Unarmed means no record, so there is no scope to inherit: this is the unscoped arm, and a session proving
  // the bot privately runs `listen arm --dm-only` itself rather than taking this line.
  return {
    action: "arm",
    liveness,
    plan: armPlan({ armId: randomUUID().slice(0, 8), home, queuePath, scope: UNSCOPED }),
  };
}

/**
 * Decide what to do about a death {@link reconcileTick} has already journalled and published.
 *
 * The journalling moved out of here and the reason is the whole point of this change: a tick
 * that only records what it personally witnesses records nothing at all when it is reaped alongside the thing
 * it watches. `reconcileTick` writes every death the journal implies, this decides what to do about the one
 * that is still current, and the two cannot disagree because only one of them writes.
 *
 * The journal is read FRESH — so it already carries every death reconcile just back-filled for earlier arms,
 * which is exactly what should count — and then this arm's own death is filtered back out. `rearmDecision`
 * counts the death being decided about itself, so leaving it in counts it twice; measured live
 * 2026, where the very first kill of a fresh home reported "death 2".
 *
 * @param death the death this tick is deciding about
 * @param home the Slopweaver home
 * @param nowMs the current instant, epoch milliseconds
 * @returns re-arm, or escalate with the sentence to record for the owner
 */
function decideAfterDeath({
  death,
  home,
  nowMs,
}: {
  death: { readonly reason: ListenerDeathReason; readonly armId: string; readonly pid: number };
  home: string;
  nowMs: number;
}): RearmDecision {
  const journalled = readListenerArmEvents({ home });
  const priorDeaths = (journalled.isOk() ? journalled.value : []).filter(
    (event) => !(event.kind === "died" && event.armId === death.armId),
  );
  return rearmDecision({ events: priorDeaths, nowMs });
}

/** Publish the tick's RESPONSE to a death, and decide between a re-arm and an escalation. */
function deathOutcome({
  death,
  home,
  liveness,
  nowMs,
  queuePath,
  scope,
  threadReplyChannels,
}: {
  death: { readonly reason: ListenerDeathReason; readonly armId: string; readonly pid: number };
  home: string;
  liveness: ListenerLiveness;
  nowMs: number;
  queuePath: string;
  scope: ListenScope;
  threadReplyChannels: readonly string[];
}): SuperviseOutcome {
  const atIso = new Date(nowMs).toISOString();
  const decision = decideAfterDeath({ death, home, nowMs });
  const escalatedWhy = decision.action === "escalate" ? decision.why : undefined;
  // The `died` event is already on the stream — `reconcileTick` published it when it journalled the death.
  // Publishing it again here would double-count every outage for a supervisor filtering on `alert`.
  publish({ event: listenerResponseEvent({ armId: death.armId, atIso, escalatedWhy, pid: death.pid }), home });
  if (escalatedWhy !== undefined) {
    appendListenerArmEvent({ event: { armId: death.armId, atIso, kind: "escalated", why: escalatedWhy }, home });
    clearListenerArm({ home });
    return { action: "escalate", liveness, why: escalatedWhy };
  }
  clearListenerArm({ home });
  return {
    action: "rearm",
    deathsInWindow: decision.deathsInWindow,
    liveness,
    plan: armPlan({ armId: randomUUID().slice(0, 8), home, queuePath, scope, threadReplyChannels }),
  };
}

/** Narrate the tick to stderr and put the one thing the session must ACT on — a command — on stdout. */
export function printOutcome({ json, outcome }: { json: boolean; outcome: SuperviseOutcome }): void {
  if (json) {
    logger.out({ line: JSON.stringify(outcome) });
    return;
  }
  logger.error({ msg: `listen supervise: ${livenessLine({ liveness: outcome.liveness })}` });
  switch (outcome.action) {
    case "none":
      return;
    case "held":
      logger.error({
        msg:
          "listen supervise: HELD — an escalation is standing and the bot is deliberately DOWN. Nothing will " +
          "be armed automatically; `slopweaver listen arm` is the deliberate way to start one again.",
      });
      return;
    case "arm":
      // An unarmed home has no record, so there is nothing to inherit either flag from. Say which two,
      // rather than letting a session that had scoped its listener or switched thread replies on discover
      // the loss by watching replies go unanswered.
      logger.error({
        msg:
          "listen supervise: nothing is running — arm it with the command on stdout. There is no arm record " +
          "to inherit from, so that line is UNSCOPED and answers no thread replies: if either was switched " +
          "on, run `listen arm` yourself with `--channels`/`--dm-only` and `--thread-replies`.",
      });
      logger.out({ line: outcome.plan.command });
      return;
    case "rearm":
      logger.error({
        msg: `listen supervise: death ${String(outcome.deathsInWindow)} in the window — re-arm with the command on stdout`,
      });
      logger.out({ line: outcome.plan.command });
      return;
    case "escalate":
      logger.error({ msg: "listen supervise: ESCALATE — the bot is deliberately left DOWN" });
      logger.out({
        line: `slopweaver handover ask <slug> --question "${outcome.why}"`,
      });
      return;
  }
}
