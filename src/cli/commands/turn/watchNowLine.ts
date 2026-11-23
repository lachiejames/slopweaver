/*
 * The live card's `now:` line for one tick — the reviewer round while one is open, the worker's own last tool
 * call otherwise. Split from `./watch.ts` because that file sits at its line ratchet, and because this is the
 * one read the ticker makes of the review files.
 */
import type { AskIdentity } from "../../../live/ask/identity.js";
import { activityWindowStart, nowLine, turnClockLead, type WorkerActivity } from "../../../live/turn/progressCard.js";
import { readReviewRecord, readVerdictFile } from "../../../live/turn/reviewStore.js";
import { reviewNowLine } from "../../../live/turn/reviewThroughput.js";
import { latestWorkerActivity } from "../../../live/turn/workerLog.js";
import { ORPHAN_SILENCE_MS } from "./tickerOwner.js";

/**
 * One tick's read: the worker's own activity since this turn began (`activityWindowStart`), and the `now:`
 * line it yields.
 *
 * @param firstStageIso the card's first stage, when the turn has declared one
 * @param nowIso the tick's instant
 * @param watch the resolved watch's ask, home and worker session
 * @returns the activity read (the reap wants its last instant) and the line
 */
export function tickReading({
  firstStageIso,
  nowIso,
  watch,
}: {
  firstStageIso: string | undefined;
  nowIso: string;
  watch: {
    readonly askIdentity: AskIdentity;
    readonly home: string;
    readonly sessionId: string;
    readonly workerCwd: string;
  };
}): { readonly activity: ReturnType<typeof latestWorkerActivity>; readonly detail: string } {
  const sinceIso = activityWindowStart({ askTs: watch.askIdentity.messageTs, firstStageIso, nowIso });
  const activity = latestWorkerActivity({ cwd: watch.workerCwd, sessionId: watch.sessionId, sinceIso });
  return { activity, detail: tickNowLine({ activity, askIdentity: watch.askIdentity, home: watch.home, nowIso }) };
}

/**
 * What the running step says this tick, led by how long the reader has waited (`turnClockLead`) — which
 * stops saying `still working` at the same silence the reap judges a death by, so the last line a reaped
 * ticker leaves standing does not claim a dead turn is working.
 *
 * A round is OPEN while its record is unreleased and its own reviewer has not written a verdict — the window
 * measured at 5.7 to 23.2 minutes a round, during which the worker's own log only shows it
 * polling, so the worker's line would read "getting a second opinion" with no sense of how long.
 *
 * @param activity the worker's own command log, as `latestWorkerActivity` read it
 * @param askIdentity the ask the card belongs to
 * @param home the resolved state home
 * @param nowIso the tick's instant
 * @returns the clamped `now:` line
 */
export function tickNowLine({
  activity,
  askIdentity,
  home,
  nowIso,
}: {
  activity: { readonly callsSoFar: number; readonly latest: WorkerActivity | undefined };
  askIdentity: AskIdentity;
  home: string;
  nowIso: string;
}): string {
  const turnClock = turnClockLead({
    askTs: askIdentity.messageTs,
    latestIso: activity.latest?.tsIso,
    nowIso,
    quietAfterMs: ORPHAN_SILENCE_MS,
  });
  const record = readReviewRecord({ askIdentity, home });
  if (record !== undefined && record.releasedAt === undefined && readVerdictFile({ record }).kind !== "present") {
    return reviewNowLine({ nowIso, record, turnClock });
  }
  return nowLine({ callsSoFar: activity.callsSoFar, latest: activity.latest, nowIso, turnClock });
}
