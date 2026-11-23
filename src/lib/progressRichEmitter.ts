/**
 * The rich, three-lane progress emitter and its per-lane throttle: one human line and one machine JSON line per
 * emitted event, both off stdout, fire-and-forget. The state fold it drives is in `./progress.ts` and the snapshot
 * it renders is in `./progressSnapshot.ts`.
 */

import {
  DEFAULT_PROGRESS_CONFIG,
  initialProgressState,
  nextProgressState,
  type ProgressConfig,
  type ProgressLane,
  type ProgressSink,
  type ProgressState,
  type RichProgressEvent,
} from "./progress.js";
import { type RenderableProgressEvent, renderProgressEvent } from "./progressRender.js";
import { type ProgressSnapshot, progressSnapshot, stalledSnapshot } from "./progressSnapshot.js";

/**
 * Record that a `lane` line was emitted at `nowMs` (resets that lane's throttle window). Pure.
 *
 * @param state the state to advance
 * @param lane which lane just emitted — throttling is per lane, so a busy lane cannot mute a quiet one
 * @param nowMs the emit time, injected
 * @returns a new state; the input is not mutated
 */
function markEmitted({
  state,
  lane,
  nowMs,
}: {
  state: ProgressState;
  lane: ProgressLane;
  nowMs: number;
}): ProgressState {
  return { ...state, lastEmitMs: { ...state.lastEmitMs, [lane]: nowMs } };
}

/** The throttle interval (ms) for a lane. Pure. */
function laneIntervalMs({ lane, config }: { lane: ProgressLane; config: ProgressConfig }): number {
  if (lane === "content_preview") {
    return config.previewMs;
  }
  if (lane === "knowledge_extracted") {
    return config.learningMs;
  }
  return config.heartbeatMs;
}

/**
 * Whether a lane's line should be emitted now: a `final` line always flushes (past the throttle); the
 * first line of a lane always emits; otherwise the lane's interval must have elapsed since its last emit.
 * Pure.
 *
 * @param state the current state (holds the per-lane last-emit clock)
 * @param lane the lane about to emit
 * @param nowMs the injected clock
 * @param final whether this is the forced final line
 * @param config the cadence policy (the per-lane intervals)
 * @returns true to emit
 */
export function shouldEmitProgress({
  state,
  lane,
  nowMs,
  final,
  config,
}: {
  state: ProgressState;
  lane: ProgressLane;
  nowMs: number;
  final: boolean;
  config: ProgressConfig;
}): boolean {
  if (final) {
    return true;
  }
  const last = state.lastEmitMs[lane];
  return last === undefined || nowMs - last >= laneIntervalMs({ config, lane });
}

/** The default rich sinks write to STDERR — stdout stays pristine for `--json` data output. */
const stderrSink: ProgressSink = (line) => {
  process.stderr.write(line);
};

/**
 * A rich, three-lane progress emitter bound to one verb — the effectful edge over the pure model in `./progress.ts`.
 *
 * An emitter built with a `stallTimer` OWNS an interval, and the verb that built it must `close()` it when its
 * run ends: the watchdog re-fires on the SAME silence every `stallMs` for as long as the interval lives, and one
 * process can run several verbs one after another (`automation run-due`'s collected legs, a test file). MEASURED
 * when run-due ran every row's verb in run-due's own process: a fathom refresh printed
 * `refresh · Mapping structure · calendar · 100% · (stalled)` — the calendar refresh that ran before it in the
 * same tick, whose emitter had finished its work and kept its watchdog.
 */
export interface RichProgressEmitter {
  /** Emit an event if its lane's throttle allows (the first line of each lane always emits). Non-blocking. */
  emit(event: RichProgressEvent): void;
  /** Emit a final event unconditionally (past every throttle) — the run's last, complete line. Non-blocking. */
  finish(event: RichProgressEvent): void;
  /** Emit a `(stalled)` heartbeat iff no update has landed for the stall threshold. Best-effort; non-blocking. */
  noteStall(): void;
  /** Stop the watchdog for good: the interval is cleared and a tick already in flight prints nothing. Idempotent. */
  close(): void;
}

/** The renderable form of an event given its heartbeat snapshot (preview/learning fall back to heartbeat). */
function toRenderable({
  event,
  snapshot,
}: {
  event: RichProgressEvent;
  snapshot: ProgressSnapshot;
}): RenderableProgressEvent {
  if (event.lane === "content_preview" && event.preview !== undefined) {
    return { lane: "content_preview", preview: event.preview };
  }
  if (event.lane === "knowledge_extracted" && event.learning !== undefined) {
    return { lane: "knowledge_extracted", learning: event.learning };
  }
  return { lane: "heartbeat", snapshot };
}

/** The machine `slopweaver.progress` JSON line for one event (the programmatic relay lane, off stdout). */
function machineLine({
  verb,
  event,
  snapshot,
}: {
  verb: string;
  event: RichProgressEvent;
  snapshot: ProgressSnapshot;
}): string {
  const line: Record<string, unknown> = {
    elapsedMs: snapshot.elapsedMs,
    lane: event.lane,
    phase: event.phase,
    type: "slopweaver.progress",
    verb,
    ...(snapshot.done !== undefined ? { done: snapshot.done } : {}),
    ...(snapshot.total !== undefined ? { total: snapshot.total } : {}),
    ...(snapshot.percent !== undefined ? { percent: snapshot.percent } : {}),
    ...(snapshot.etaSeconds !== undefined ? { etaSeconds: snapshot.etaSeconds } : {}),
    ...(Object.keys(snapshot.metrics).length > 0 ? { metrics: snapshot.metrics } : {}),
    ...(snapshot.currentItem !== undefined ? { currentItem: snapshot.currentItem } : {}),
    ...(event.preview !== undefined ? { preview: event.preview } : {}),
    ...(event.learning !== undefined ? { learning: event.learning } : {}),
  };
  return `${JSON.stringify(line)}\n`;
}

/**
 * Starts a repeating stall check (the watchdog) and answers how to stop it. Given the interval + a tick
 * callback, it arranges for the callback to fire roughly every `intervalMs` — production uses a NON-BLOCKING
 * unref'd timer; a test injects a fake that captures the tick and drives it manually. Absent ⇒ no watchdog
 * (the default). The returned function is what {@link RichProgressEmitter.close} calls.
 */
export type StallTimer = (args: { intervalMs: number; onTick: () => void }) => () => void;

/**
 * The production stall watchdog: a `setInterval` that's `unref`'d so it NEVER keeps the process alive or
 * blocks exit — it just nudges the emitter to print a `(stalled)` line if the crawl has gone quiet. Unref'd
 * is not stopped: the interval keeps firing until the process exits or the returned stop clears it.
 *
 * @param intervalMs how often to check
 * @param onTick the stall check to run
 * @returns the stop that clears the interval
 */
export const unrefIntervalStallTimer: StallTimer = ({ intervalMs, onTick }) => {
  const handle = setInterval(onTick, intervalMs);
  if (typeof handle.unref === "function") {
    handle.unref();
  }
  return () => {
    clearInterval(handle);
  };
};

/** Fire-and-forget: a broken/absent sink is swallowed so the crawl always runs on (the realigned hard rule). */
function fireLine({ sink, line }: { sink: ProgressSink; line: string }): void {
  try {
    sink(line);
  } catch {
    /* progress is best-effort */
  }
}

/** The two-lane writer one emitter renders every event through: one human line, one machine JSON line. */
function eventRenderer({
  humanSink,
  machineSink,
  verb,
}: {
  humanSink: ProgressSink;
  machineSink: ProgressSink;
  verb: string;
}): (args: { event: RichProgressEvent; snapshot: ProgressSnapshot }) => void {
  return ({ event, snapshot }) => {
    fireLine({ line: `${renderProgressEvent({ event: toRenderable({ event, snapshot }) })}\n`, sink: humanSink });
    fireLine({ line: machineLine({ event, snapshot, verb }), sink: machineSink });
  };
}

/**
 * Build a rich progress emitter for one verb. Each emitted event writes ONE human line (through `humanSink`)
 * and ONE machine JSON line (through `machineSink`) — both default to STDERR so stdout stays clean for
 * `--json`. Emits are throttled per lane by {@link shouldEmitProgress} (the first line of each lane and
 * every `finish` bypass the throttle). Fire-and-forget: a throwing sink is swallowed so a broken relay can
 * NEVER abort or corrupt the crawl. The clock is injected, so the whole thing is deterministic in tests.
 * When a `stallTimer` is given, a watchdog prints a `(stalled)` heartbeat if no update lands for `stallMs`.
 *
 * @param verb the verb name stamped on every line
 * @param now injected monotonic clock in ms (defaults to `Date.now`)
 * @param humanSink where human lines go (defaults to stderr)
 * @param machineSink where machine JSON lines go (defaults to stderr)
 * @param config the cadence/EMA policy (defaults to {@link DEFAULT_PROGRESS_CONFIG})
 * @param stallTimer starts the stall watchdog (production: {@link unrefIntervalStallTimer}; omit ⇒ no watchdog)
 * @returns the rich emitter
 */
export function createRichProgressEmitter({
  verb,
  now = Date.now,
  humanSink = stderrSink,
  machineSink = stderrSink,
  config = DEFAULT_PROGRESS_CONFIG,
  stallTimer,
}: {
  verb: string;
  now?: () => number;
  humanSink?: ProgressSink;
  machineSink?: ProgressSink;
  config?: ProgressConfig;
  stallTimer?: StallTimer;
}): RichProgressEmitter {
  let state = initialProgressState({ startMs: now(), verb });
  const render = eventRenderer({ humanSink, machineSink, verb });
  const write = ({ event, final }: { event: RichProgressEvent; final: boolean }): void => {
    const nowMs = now();
    const next = nextProgressState({ config, event, nowMs, state });
    if (!shouldEmitProgress({ config, final, lane: event.lane, nowMs, state: next })) {
      state = next; // fold the content, but stay silent until the lane's window opens
      return;
    }
    render({ event, snapshot: progressSnapshot({ nowMs, stalled: false, state: next }) });
    state = markEmitted({ lane: event.lane, nowMs, state: next });
  };
  // Emit a `(stalled)` heartbeat iff no update has landed for the stall threshold (best-effort; non-blocking).
  // A closed emitter prints nothing: `clearInterval` cannot recall a tick the event loop already dequeued.
  let closed = false;
  const checkStall = (): void => {
    if (closed) {
      return;
    }
    const nowMs = now();
    const snapshot = stalledSnapshot({ nowMs, stallAfterMs: config.stallMs, state });
    if (snapshot !== undefined) {
      render({ event: { lane: "heartbeat", phase: state.phase }, snapshot });
      state = markEmitted({ lane: "heartbeat", nowMs, state });
    }
  };
  // Start the watchdog when one is provided, and keep its stop for `close`.
  const stopWatchdog = stallTimer?.({ intervalMs: config.stallMs, onTick: checkStall });
  return {
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      stopWatchdog?.();
    },
    emit: (event) => {
      write({ event, final: false });
    },
    finish: (event) => {
      write({ event, final: true });
    },
    noteStall: checkStall,
  };
}
