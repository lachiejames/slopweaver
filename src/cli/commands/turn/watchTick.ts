/*
 * One `turn watch` tick: read both logs, rewrite the card, and record the write if it landed. Split from
 * `./watch.ts` because that file sits at its line ratchet, and because the tick is where two of the card's
 * honesty rules live — a turn blocked on the owner keeps the hourglass `turn block` wrote, and the instant the
 * line is rendered at is handed back so the reap judges the very same silence.
 */
import type { AskIdentity } from "../../../live/ask/identity.js";
import { checkpointCardLine } from "../../../live/turn/checkpointStore.js";
import { progressChecklistSteps } from "../../../live/turn/progressCard.js";
import { appendProgressLogEvent, readProgressLog } from "../../../live/turn/progressLog.js";
import { turnTaskLabel } from "../../../live/turn/taskLabel.js";
import { budgetWarned } from "./dispatchBudget.js";
import { attemptChecklistAdvance, type LiveChecklistUpdatePlan } from "./sweepCard.js";
import { tickReading } from "./watchNowLine.js";

/** What one tick reports: the line it has to say for itself, and when the worker last made a tool call. */
export interface WatchTickOutcome {
  readonly latestActivityIso: string | undefined;
  readonly line: string;
  readonly ok: boolean;
}

/**
 * One tick, at `nowIso`.
 *
 * While the ask is blocked on the owner the tick writes NOTHING: `turn block` already put the hourglass step on the
 * card, `progressChecklistSteps` drops the `now:` line from a blocked step on purpose, and a running line
 * over it would tell the thread the turn is working when it is waiting on the owner. The worker's last activity
 * comes back out with the line because the reap needs it and the transcript is a whole-file read — and is
 * withheld after a failed write, which keeps the reap from firing over a card this tick could not correct.
 *
 * @param blockedOnHuman the ask is waiting on the owner, so the card is left as `turn block` wrote it
 * @param nowIso the tick's one instant — the line is rendered at it, and the caller's reap judges it too
 * @param watch the resolved watch's card, ask, home, worker session and card writer
 * @returns the tick's line, whether the card write landed, and the worker's last tool-call instant
 */
export async function watchTick({
  blockedOnHuman,
  nowIso,
  watch,
}: {
  blockedOnHuman: boolean;
  nowIso: string;
  watch: {
    readonly advancer: { readonly advanceWorking: (plan: LiveChecklistUpdatePlan) => Promise<void> };
    readonly askIdentity: AskIdentity;
    readonly home: string;
    readonly question: string;
    readonly sessionId: string;
    readonly workerCwd: string;
    readonly workingTs: string;
  };
}): Promise<WatchTickOutcome> {
  if (blockedOnHuman) {
    return { latestActivityIso: undefined, line: "blocked on the owner — the card keeps its hourglass", ok: true };
  }
  const { stages, timeline } = readProgressLog({ askIdentity: watch.askIdentity, home: watch.home });
  const { activity, detail } = tickReading({ firstStageIso: stages[0]?.tsIso, nowIso, watch });
  const outcome = await attemptChecklistAdvance({
    advanceWorking: (plan) => watch.advancer.advanceWorking(plan),
    plan: {
      posted: { channel: watch.askIdentity.channel, ts: watch.workingTs },
      steps: progressChecklistSteps({
        finished: false,
        nowDetail: detail,
        question: watch.question,
        // Read every tick for the same reason the warn is: a ticker a fresh session started over a dead
        // one's work outlives the moment its first inherited draft is read back.
        resuming: checkpointCardLine({ askIdentity: watch.askIdentity, home: watch.home }),
        timeline,
        // Read every tick, never once at start: a ticker outlives the moment the sweep raises the warn.
        warned: budgetWarned({ askIdentity: watch.askIdentity, home: watch.home, nowIso }),
      }),
      task: turnTaskLabel({ question: watch.question }),
    },
  });
  if (outcome.kind === "failed") {
    // No activity instant, so the caller's reap cannot fire: the card still holds the previous tick's line,
    // which may say working, and only a write that landed may be the last one a reaped ticker leaves.
    return {
      latestActivityIso: undefined,
      line: `could not advance the card — ${outcome.reason}`,
      ok: false,
    };
  }
  appendProgressLogEvent({
    askIdentity: watch.askIdentity,
    event: { detail, kind: "card-write", stageCount: stages.length, tsIso: nowIso },
    home: watch.home,
  });
  return { latestActivityIso: activity.latest?.tsIso, line: detail, ok: true };
}
