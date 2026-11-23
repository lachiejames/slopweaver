/**
 * Which of one asker's asks are still IN FLIGHT — the fact a judging session needs, and all that is left of
 * what used to be a queue.
 *
 * ## There is no burst queue any more, and that is the design
 *
 * A second tag from the same asker while an earlier ask of theirs was running used to be parked here:
 * durably queued, acknowledged with an `:hourglass_flowing_sand:`, never judged, and surfaced only once the
 * ask it sat behind reached a releasing event. Measured, that queue held 34 rows behind targets
 * that had already ended — nothing was ever going to release them — and one of them was a real question the
 * owner had asked the day before.
 *
 * The rule: answer the first tag, JUDGE each later one, answer it when it needs an answer,
 * and otherwise put it on the exclusion registry so it never comes up again. So every tag now takes the
 * ordinary capture-and-judge path, and `../turn/judgement.ts`'s `no-response` arm carries an `exclude` flag
 * for the second half of that sentence.
 *
 * ## What the queue was really protecting, and where that property lives now
 *
 * Two workers composing on one thread. Measured: an ask whose pickup send was unwitnessed was
 * recorded `dispatch-failed` while its worker was alive and already composing, so the same asker's follow-up
 * was admitted with nothing queued, and the second worker — unable to see the first — composed "the first
 * attempt never got going, nothing ran", which was false and was caught only by review.
 *
 * That property is now the BRIEF's. {@link activeAsks} is read by `../../cli/commands/turn/briefAskContext.ts`, which
 * puts the asker's own in-flight asks in the brief as `otherActiveAsks`, so the judging session can fold the
 * follow-up into the ask already running, answer it separately, or decline it. A judge that can see the
 * holder does not need a queue to be stopped from double-working it.
 *
 * ## What still counts as in flight
 *
 * `lease-expired` is ACTIVE: there is genuinely unfinished business behind it, just overdue for a fresh
 * judgement. Both dispatch-doubt kinds are active too, for the reason above — a worker whose pickup
 * merely went unwitnessed is real concurrency. So is `first-answered`: the plan is posted and the same
 * worker is still building it, so a later tag from the same asker queues behind the final answer rather than
 * starting a second worker beside the first.
 *
 * An ask BLOCKED ON THE OWNER is deliberately absent: the worker stood down and gave back its lease, and
 * that state has no time bound at all ("might be one minute, might be one week"), so counting it would hide
 * every later tag from the same asker behind a wait nobody is serving.
 *
 * A permanently-ignored ask is never active either, whatever its lifecycle state. `slopweaver turn ignore`
 * writes no lifecycle event by design (see `./ignore.ts`), so without this an ignored ask stuck at
 * `captured` would read as live work forever — measured on a chain of 14 of them.
 *
 * And an ask NO SESSION EVER ROUTED stops counting at the sweep's own bound. `captured`/`checklist-posted`
 * with no dispatch is a session's work to pick up, but past `UNDISPATCHED_ABANDON_AFTER_MINUTES` nobody is
 * coming: `turn dispatch --sweep` would already call it over, and it only runs inside a visible loop. Asking
 * the sweep's own predicate here means the two can never disagree about which asks are dead.
 */
import { undispatchedSweepAction } from "../turn/undispatchedSweep.js";
import type { AskIdentity } from "./identity.js";
import { type IgnoredAsk, isIgnoredAsk } from "./ignore.js";
import { type IgnoredConversation, isIgnoredConversation } from "./ignoredConversation.js";
import { type AskLifecycle, type AskLifecycleEvent, foldAskLifecycle } from "./lifecycle.js";

/** States meaning an ask is still genuinely being worked. Everything else is finished, abandoned or dead. */
const ACTIVE_STATES: ReadonlySet<AskLifecycle["state"]> = new Set([
  "captured",
  "checklist-posted",
  "dispatched",
  "dispatch-unwitnessed",
  "dispatch-witnessed",
  "first-answered",
  "lease-expired",
]);

/** One currently-active ask, with the asker who owns it and the lifecycle state that made it active. */
export interface ActiveAsk extends AskIdentity {
  readonly userId: string;
  /** Why this ask is active — the state a brief shows the judging session. */
  readonly state: AskLifecycle["state"];
}

/**
 * Every currently-active ask — derived fresh from the raw ask-lifecycle log every time, never cached, so a
 * reader always sees the true current picture rather than one that might already have resolved. An ask in
 * `ignored` is excluded regardless of its own lifecycle state, and so is an ask no session routed within the
 * sweep's own bound — see this module's own header for both.
 *
 * @param events the parsed ask-lifecycle log
 * @param ignored the current permanent-ignore registry; omit to not filter against it at all
 * @param ignoredConversations the current permanent conversation-ignore registry; omit to not filter
 *   against it at all
 * @param nowIso the instant an unrouted ask's age is judged against; required, because a caller that
 *   omitted it would silently bring back the dead ask counting as live work forever
 * @returns one entry per active, non-ignored ask
 */
export function activeAsks({
  events,
  ignored,
  ignoredConversations,
  nowIso,
}: {
  events: readonly AskLifecycleEvent[];
  ignored?: ReadonlyMap<string, IgnoredAsk>;
  ignoredConversations?: ReadonlyMap<string, IgnoredConversation>;
  nowIso: string;
}): readonly ActiveAsk[] {
  const folded = foldAskLifecycle({ events });
  const active: ActiveAsk[] = [];
  for (const lifecycle of folded.values()) {
    if (!ACTIVE_STATES.has(lifecycle.state)) {
      continue;
    }
    if (undispatchedSweepAction({ ask: lifecycle, nowIso }) !== undefined) {
      continue;
    }
    if (ignored !== undefined && isIgnoredAsk({ askIdentity: lifecycle, ignored })) {
      continue;
    }
    if (
      ignoredConversations !== undefined &&
      isIgnoredConversation({ channel: lifecycle.channel, ignored: ignoredConversations })
    ) {
      continue;
    }
    active.push({
      channel: lifecycle.channel,
      messageTs: lifecycle.messageTs,
      state: lifecycle.state,
      threadTs: lifecycle.threadTs,
      userId: lifecycle.userId,
    });
  }
  return active;
}
