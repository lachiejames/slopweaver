/**
 * Whether the console takes a landing reading of its own now, over which reading, when it next decides again, and
 * what it says it is doing — the decisions the one runner (`../components/console/useLandingAutoRefresh.ts`) acts on.
 * Pure.
 *
 * **The console SHELL owns the Pull requests count's freshness and its failure recovery** — someone must keep the counts fresh,
 * detect that a reading failed and fix it. The supervisor tick's reading is one input, never the guarantee: it runs about hourly
 * and its press read has been killed at its 300-second budget (`LANDING_TIMEOUT_MS`, `tickCapture.ts`). So the shell
 * ({@link landingShellAskOf}), on every page, asks on a reading event — the reading shown is missing, left drafts out,
 * does not reconcile with GitHub's open list, or its census did not read — AND when the reading shown comes due against
 * the cadence — both only while the console is in view; a hidden one takes nothing until it is. It wakes at the instant its
 * next decision falls due ({@link landingShellWakeAtOf}) rather than on a free-running timer, and a failed run is
 * retried past the per-reading backoff the same way. What it is doing is said beside every withheld count
 * ({@link landingRefreshPlanOf}), so no sentence promises a refresh the state cannot back.
 *
 * Every ask is keyed by the reading it would replace and judged against one `asked` record, so nothing runs twice over
 * one reading inside the backoff (`syncFreshness.ts`); the sync route's claim backs that up across tabs.
 */

import type { SyncState } from "../components/live/LandingSync";
import type { LandingReading } from "../components/live/readLanding";
import {
  countAgedFromOf,
  LANDING_CADENCE_MINUTES,
  landingDueOf,
  type PopulationGap,
  REFRESH_HEADROOM_MINUTES,
  type RefreshReason,
  readingEventReasonOf,
} from "./landingFreshness";
import type { LiveState } from "./liveState";
import { liveVerbFor } from "./liveVerbs";
import { pullRequestPopulationOf } from "./pullRequestPopulation";
import type { ReasonWords } from "./quotedReason";
import { AUTO_RETRY_MINUTES, NO_READING_ID, nextPageAskAtOf, pageMayAsk, SYNC_NOW_BY } from "./syncFreshness";
import type { WorkContext } from "./workContext";
import type { WorkspacePlacer } from "./workspacePlacement";

/** One automatic run to ask for: why, and the reading it would replace, which the sync route claims once. */
export interface LandingAutoAsk {
  readonly reason: RefreshReason;
  readonly readingId: string;
}

/**
 * The ask, unless a run is going or this console already asked over that reading inside the backoff.
 *
 * @returns the ask, or `undefined`
 */
function admitted({
  ask,
  taking,
  asked,
  nowMs,
}: {
  ask: LandingAutoAsk | undefined;
  taking: boolean;
  asked: Readonly<Partial<Record<string, number>>>;
  nowMs: number;
}): LandingAutoAsk | undefined {
  if (taking || ask === undefined || !pageMayAsk({ asked, nowMs, readingId: ask.readingId })) {
    return undefined;
  }
  return ask;
}

/**
 * The shell's run to ask for now: a reading event first, else `due` once the reading shown comes due against the
 * cadence while the console is in view.
 *
 * @param state the landing reading as the shell polls it
 * @param context the context the console is being looked at in, which the population is counted over
 * @param placer the organisation's address readers
 * @param taking whether the console's own run is in flight
 * @param asked when the console last asked over each reading, keyed by reading id
 * @param nowMs the instant it is deciding at
 * @param visible whether the console's window is in view: a hidden one asks nothing, by event or by age
 * @returns the run to ask for, or `undefined`
 */
export function landingShellAskOf({
  state,
  context,
  placer,
  taking,
  asked,
  nowMs,
  visible,
}: {
  state: LiveState<LandingReading>;
  context: WorkContext;
  placer: WorkspacePlacer;
  taking: boolean;
  asked: Readonly<Partial<Record<string, number>>>;
  nowMs: number;
  visible: boolean;
}): LandingAutoAsk | undefined {
  // A hidden console asks nothing at all, so "when this window is next in view" is true of every reason.
  if (!visible) {
    return undefined;
  }
  let ask: LandingAutoAsk | undefined;
  // No reading it can show — none recorded, or one it refuses — is established the same way, on the same backoff.
  if (state.phase === "not-measured") {
    ask = { readingId: NO_READING_ID, reason: "no-reading" };
  }
  if (state.phase === "ready") {
    const shown = state.value;
    const { census, selection } = shown.landing;
    const population = pullRequestPopulationOf({ context, nowMs, placer, reading: shown });
    let gap: PopulationGap | undefined;
    if (population.phase === "not-measured") {
      gap = population.gap;
    }
    const reason = readingEventReasonOf({
      by: shown.by,
      census,
      gap,
      nowMs,
      observedAtIso: countAgedFromOf({ census, observedAtIso: shown.observedAtIso }),
      selection,
    });
    if (reason !== undefined) {
      ask = { readingId: shown.readingId, reason };
    }
    const agedFrom = countAgedFromOf({ census, observedAtIso: shown.observedAtIso });
    if (ask === undefined && landingDueOf({ nowMs, observedAtIso: agedFrom })) {
      ask = { readingId: shown.readingId, reason: "due" };
    }
  }
  return admitted({ ask, asked, nowMs, taking });
}

/**
 * The next instant the shell's decision can change by time alone, so its runner wakes then rather than on a clock: the
 * reading shown coming due, a reading event on the console's own reading opening once its retry threshold passes
 * (`readingEventReasonOf`), or the backoff over the reading it last asked over lapsing. `undefined` when nothing is
 * ahead — a decision a new reading, a finished run or the window coming into view changes instead.
 *
 * @param state the landing reading as the shell polls it
 * @param context the context the population is counted over, which decides whether an event opens at the threshold
 * @param placer the organisation's address readers
 * @param asked when the console last asked over each reading, keyed by reading id
 * @param nowMs the instant it is deciding at
 * @returns the epoch-ms instant to decide again at, or `undefined`
 */
export function landingShellWakeAtOf({
  state,
  context,
  placer,
  asked,
  nowMs,
}: {
  state: LiveState<LandingReading>;
  context: WorkContext;
  placer: WorkspacePlacer;
  asked: Readonly<Partial<Record<string, number>>>;
  nowMs: number;
}): number | undefined {
  let readingId = NO_READING_ID;
  const ahead: number[] = [];
  if (state.phase === "ready") {
    const shown = state.value;
    readingId = shown.readingId;
    const agedFrom = countAgedFromOf({ census: shown.landing.census, observedAtIso: shown.observedAtIso });
    const agedFromMs = Date.parse(agedFrom);
    if (!Number.isNaN(agedFromMs)) {
      ahead.push(agedFromMs + (LANDING_CADENCE_MINUTES - REFRESH_HEADROOM_MINUTES) * 60_000 + 1);
    }
    // The console's own reading holds its events back until the retry threshold: named only when an
    // event is what the shell would ask over at that instant, judged by the very decision it will run then.
    const eventOpensAt = agedFromMs + AUTO_RETRY_MINUTES * 60_000;
    if (shown.by === SYNC_NOW_BY && !Number.isNaN(agedFromMs) && eventOpensAt > nowMs) {
      const then = landingShellAskOf({
        asked: {},
        context,
        nowMs: eventOpensAt,
        placer,
        state,
        taking: false,
        visible: true,
      });
      if (then !== undefined && then.reason !== "due") {
        ahead.push(eventOpensAt);
      }
    }
  }
  const retryAt = nextPageAskAtOf({ asked, readingId });
  let lifted = ahead;
  if (retryAt !== undefined) {
    // Nothing can be asked over this reading before its backoff lapses, so a deadline inside it waits for the lapse:
    // the instant named is one the admission decision will actually open at.
    lifted = [...ahead.map((at) => Math.max(at, retryAt)), retryAt];
  }
  const future = lifted.filter((at) => at > nowMs);
  if (future.length === 0) {
    return undefined;
  }
  return Math.min(...future);
}

/**
 * What the console is doing about a count it withholds, in its own words, off the refresh's real state — never off the
 * reading's age, which proves nothing is running (a claim that the console is taking a fresh one by itself must be true).
 *
 * @param sync where the console's own landing refresh stands for the reading shown
 * @param visible whether the console's window is in view, the one condition every automatic ask waits on
 * @param nextAtWords when the runner next decides by time alone, as the owner reads a clock (`today h:mm pm`), or
 *   `undefined` when nothing is ahead
 * @returns the clause, e.g. `the console takes a fresh one today h:mm pm`
 */
export function landingRefreshPlanOf({
  sync,
  visible,
  nextAtWords,
}: {
  sync: SyncState;
  visible: boolean;
  nextAtWords: string | undefined;
}): string {
  if (sync.phase === "taking") {
    return "the console is taking a fresh one now";
  }
  let act = "takes a fresh one";
  if (sync.phase === "failed") {
    act = "tries again";
  }
  if (!visible && nextAtWords !== undefined) {
    // The instant is what the backoff or the cadence holds it to, in view or not.
    return `the console ${act} when this window is in view, not before ${nextAtWords}`;
  }
  if (!visible) {
    return `the console ${act} when this window is next in view`;
  }
  if (nextAtWords !== undefined) {
    return `the console ${act} ${nextAtWords}`;
  }
  return `the console ${act} now`;
}

/**
 * How the live route words `landing-reading` exiting 3, which `reading last` does for `NO_READING` and nothing else
 * (`./spawnVerb.ts` `closedReason`): the row declares no expected-empty exit, because every other reader of the slug
 * draws that sentence as it stands.
 */
const NOT_RECORDED_PREFIX = `${liveVerbFor({ slug: "landing-reading" })!.title} exited 3`;

/**
 * Why the badge withholds its count when no landing reading has ever been recorded — an absence, never a failed read,
 * so a fresh install's hidden console does not say "could not be read" — or `undefined` for any other
 * state, a ledger that genuinely failed to read included.
 *
 * @param state the landing reading as the shell polls it
 * @param sync where the console's own landing refresh stands
 * @returns the reason to withhold the count with, quoting the console's failed run when there was one, or `undefined`
 */
export function landingNotRecordedWhyOf({
  state,
  sync,
}: {
  state: LiveState<LandingReading>;
  sync: SyncState;
}): ReasonWords | undefined {
  if (state.phase !== "not-measured" || !state.why.startsWith(NOT_RECORDED_PREFIX)) {
    return undefined;
  }
  if (sync.phase === "failed") {
    return [
      {
        lead: "no reading of your pull requests is recorded yet, and the console's run to take one failed",
        why: sync.why,
      },
    ];
  }
  return "no reading of your pull requests is recorded yet";
}

/**
 * The refresh's state as the badge and the page read it: a failure is about the reading it was asked over, so once
 * another reading is shown — a later successful run's, or the tick's — it no longer withholds anything and reads idle.
 *
 * @param sync where the runner's last run got to
 * @param syncOver the reading id that run was asked over
 * @param state the landing reading shown now
 * @returns the state to report
 */
export function syncShownOf({
  sync,
  syncOver,
  state,
}: {
  sync: SyncState;
  syncOver: string | undefined;
  state: LiveState<LandingReading>;
}): SyncState {
  let shownId = NO_READING_ID;
  if (state.phase === "ready") {
    shownId = state.value.readingId;
  }
  if (sync.phase === "failed" && syncOver !== shownId) {
    return { phase: "idle" };
  }
  return sync;
}
