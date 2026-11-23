/**
 * The read side of the streamed progress model: what a heartbeat shows for a folded {@link ProgressState} — the
 * collapsed step, the source token, the ETA — and the stall watchdog's answer. Pure throughout: the fold that
 * produces the state is in `./progress.ts`, and the emitter that renders a snapshot is `./progressRichEmitter.ts`.
 */

import { PROGRESS_PHASE_SOURCES } from "../integrations/corpusProjections.js";
import { collapseProgressPhase, type ProgressCurrentItem, type ProgressState } from "./progress.js";

/** A rendered-ready snapshot of the current heartbeat state (collapsed step + monotonic % + EMA ETA). */
export interface ProgressSnapshot {
  readonly verb: string;
  readonly phase: string;
  readonly step: string;
  readonly source?: string;
  readonly done?: number;
  readonly total?: number;
  readonly percent?: number;
  readonly etaSeconds?: number;
  readonly elapsedMs: number;
  readonly currentItem?: ProgressCurrentItem;
  readonly metrics: Readonly<Record<string, number>>;
  readonly stalled: boolean;
}

/**
 * The sources whose phase strings (`slack.channel`, `github.repos`, …) carry a leading source token — derived from
 * each ingesting integration's `progressPhase` (`src/integrations/corpusProjections.ts`).
 */
const PHASE_SOURCES: ReadonlySet<string> = new Set(PROGRESS_PHASE_SOURCES);

/**
 * The source token a phase carries (`slack.channel` → `slack`), or undefined for a sourceless phase. Pure.
 *
 * @param phase the raw phase string
 * @returns the source token, or undefined when the head is not a known source — an unrecognised head is
 *   reported absent rather than passed through as if it were a source
 */
export function phaseSource({ phase }: { phase: string }): string | undefined {
  const head = phase.split(".")[0];
  return head !== undefined && PHASE_SOURCES.has(head) ? head : undefined;
}

/**
 * Seconds remaining at the current EMA rate, or undefined when the rate is unusable (unseeded/zero) or
 * nothing is left. Pure.
 *
 * @param rate the EMA throughput (items/sec)
 * @param remaining items left to process
 * @returns the ETA in seconds, or undefined
 */
export function etaSeconds({ rate, remaining }: { rate: number | undefined; remaining: number }): number | undefined {
  if (rate === undefined || rate <= 0 || remaining <= 0) {
    return undefined;
  }
  return Math.round(remaining / rate);
}

/** The items still to process (0 when unknown or complete). Pure. */
function remainingOf({ state }: { state: ProgressState }): number {
  if (state.done === undefined || state.total === undefined) {
    return 0;
  }
  return Math.max(0, state.total - state.done);
}

/**
 * Build the render-ready heartbeat snapshot from the state: collapse the phase to a human step, derive the
 * source token, and show the ETA only once at least two real deltas have been seen (no jittery early ETA).
 * Pure.
 *
 * @param state the current state
 * @param nowMs the injected clock (for elapsed)
 * @param stalled whether the stall watchdog fired
 * @returns the snapshot to render
 */
export function progressSnapshot({
  state,
  nowMs,
  stalled,
}: {
  state: ProgressState;
  nowMs: number;
  stalled: boolean;
}): ProgressSnapshot {
  const source = phaseSource({ phase: state.phase });
  const eta = state.realDeltas >= 2 ? etaSeconds({ rate: state.rate, remaining: remainingOf({ state }) }) : undefined;
  return {
    elapsedMs: nowMs - state.startMs,
    metrics: state.metrics,
    phase: state.phase,
    stalled,
    step: collapseProgressPhase({ phase: state.phase, verb: state.verb }),
    verb: state.verb,
    ...(source !== undefined ? { source } : {}),
    ...(state.done !== undefined ? { done: state.done } : {}),
    ...(state.total !== undefined ? { total: state.total } : {}),
    ...(state.percent !== undefined ? { percent: state.percent } : {}),
    ...(eta !== undefined ? { etaSeconds: eta } : {}),
    ...(state.currentItem !== undefined ? { currentItem: state.currentItem } : {}),
  };
}

/**
 * A stall snapshot when no update has landed for `stallAfterMs` (the "no updates for Ns" watchdog),
 * else undefined. Pure — the emitter decides whether to render it.
 *
 * @param state the current state
 * @param nowMs the injected clock
 * @param stallAfterMs the stall threshold
 * @returns a `stalled:true` snapshot, or undefined
 */
export function stalledSnapshot({
  state,
  nowMs,
  stallAfterMs,
}: {
  state: ProgressState;
  nowMs: number;
  stallAfterMs: number;
}): ProgressSnapshot | undefined {
  if (nowMs - state.lastUpdateMs < stallAfterMs) {
    return undefined;
  }
  return progressSnapshot({ nowMs, stalled: true, state });
}
