/**
 * A bounded drain of cmux's event stream that RESUMES when cmux hangs up mid-replay, and always ends in one
 * outcome a caller can report — never a clean end that read nothing and said nothing.
 *
 * MEASURED on cmux 0.65.2: a subscription resuming from a stored cursor is acked with its
 * `replay_count`, and cmux then sometimes CLOSES THE SOCKET CLEANLY partway through the replay — 267 of a
 * ~1400-event replay reached `session watch` before the close, while a lighter probe reading the same replay
 * got all of it and stayed open. `session watch`'s old drain treated that clean close as the end of the work
 * and exited 0 before its quiet timer ever flushed, so it printed nothing, never advanced its cursor, and
 * failed the same way on every later call: four of one chair's five ticks recorded a
 * zero-byte watch. Repro: `slopweaver session watch --json-report --since 0 --home "$(mktemp -d)" | wc -c`
 * on the build before this module.
 *
 * So a round that closed short of the replay it was promised re-subscribes AFTER the highest seq it folded —
 * the drain's own cursor, never `latest`, so nothing between is skipped — and the drain stops on a quiet
 * window (caught up), its deadline, a round that made no progress, or its round cap. The last two are a
 * TRUNCATED drain, and the caller says so rather than passing it off as complete.
 */
import { deferred } from "../lib/deferred.js";
import { type CmuxError } from "./errors.js";
import { type CmuxEventSubscription, openCmuxEventStream } from "./eventStream.js";
import { type CmuxEvent, type CmuxEventAck } from "./events.js";

/** How one subscription round stopped. */
type DrainRoundEnd = "quiet" | "deadline" | "closed";

/** What one round of a resuming drain read. */
export interface DrainRound {
  readonly kind: "round";
  readonly end: DrainRoundEnd;
  /** The ack cmux opened the round with; undefined when it hung up before acking. */
  readonly ack: CmuxEventAck | undefined;
  readonly events: readonly CmuxEvent[];
}

/** What a round tells the drain to do next. */
export type DrainStep = { readonly step: "resubscribe" } | { readonly step: "stop"; readonly truncated: boolean };

/**
 * The pure decision after one round: resubscribe from the drain's own cursor, or stop — and whether stopping
 * leaves the batch short of what cmux said it held.
 *
 * A quiet window or the deadline is a drain that read up to the live edge, or as far as its bound allowed, and
 * is never truncated. A close before any ack is the unanswered drain, which its caller words separately. A close
 * after the whole promised replay arrived read everything cmux held. Only a close SHORT of the replay
 * resubscribes, and only while the round made progress and the cap allows another — otherwise it would loop
 * on a stream that delivers nothing.
 *
 * @param round what the round just ended read
 * @param rounds how many rounds have run, this one included
 * @param maxRounds the most rounds one drain may open
 * @returns the next step
 */
export function nextDrainStep({
  round,
  rounds,
  maxRounds,
}: {
  round: DrainRound;
  rounds: number;
  maxRounds: number;
}): DrainStep {
  if (round.end !== "closed" || round.ack === undefined) {
    return { step: "stop", truncated: false };
  }
  if (round.events.length >= round.ack.replayCount) {
    return { step: "stop", truncated: false };
  }
  if (round.events.length === 0 || rounds >= maxRounds) {
    return { step: "stop", truncated: true };
  }
  return { step: "resubscribe" };
}

/** A drain that ended with something to report. */
export interface DrainedEvents {
  readonly kind: "drained";
  readonly events: readonly CmuxEvent[];
  /** The highest seq folded — the cursor to record; the starting seq (or zero) when no event arrived. */
  readonly highestSeq: number;
  /** Whether cmux said the starting cursor had already aged out of its buffer. */
  readonly gap: boolean;
  /** Whether cmux said ANYTHING — an ack or an event — in any round. */
  readonly answered: boolean;
  /** Whether cmux hung up short of a replay the drain could not finish resuming. */
  readonly truncated: boolean;
  readonly rounds: number;
}

/** A drain whose socket failed. */
export interface FailedDrain {
  readonly kind: "failed";
  readonly error: CmuxError;
}

/** The bounds and seams of one round. */
interface RoundOptions {
  readonly afterSeq: number | undefined;
  readonly names: readonly string[];
  readonly quietMs: number;
  readonly remainingMs: number;
  readonly openStream: typeof openCmuxEventStream;
}

/**
 * Open one subscription and collect until it goes quiet, its share of the deadline runs out, or cmux ends it.
 * Settles BEFORE closing, for the reason `drainUntil` does: `close()` fires `onEnd` synchronously.
 *
 * @returns what the round read, or the socket's failure
 */
async function drainRound({
  afterSeq,
  names,
  quietMs,
  remainingMs,
  openStream,
}: RoundOptions): Promise<DrainRound | FailedDrain> {
  const settlement = deferred<DrainRound | FailedDrain>();
  const events: CmuxEvent[] = [];
  let ack: CmuxEventAck | undefined;
  let quiet: ReturnType<typeof setTimeout> | undefined;
  let stream: { close: () => void } | undefined;
  const finish = ({ outcome }: { outcome: DrainRound | FailedDrain }): void => {
    if (settlement.settled()) {
      return;
    }
    settlement.settle({ value: outcome });
    clearTimeout(quiet);
    clearTimeout(deadline);
    stream?.close();
  };
  const end = ({ kind }: { kind: DrainRoundEnd }): void => {
    finish({ outcome: { ack, end: kind, events, kind: "round" } });
  };
  const arm = (): void => {
    clearTimeout(quiet);
    quiet = setTimeout(() => {
      end({ kind: "quiet" });
    }, quietMs);
  };
  const deadline = setTimeout(() => {
    end({ kind: "deadline" });
  }, remainingMs);
  stream = openStream({
    handlers: {
      onAck: ({ ack: acked }) => {
        ack = acked;
        arm();
      },
      onEnd: ({ error }) => {
        finish({
          outcome: error === undefined ? { ack, end: "closed", events, kind: "round" } : { error, kind: "failed" },
        });
      },
      onEvent: ({ event }) => {
        if (settlement.settled()) {
          return;
        }
        events.push(event);
        arm();
      },
    },
    subscription: { ...(afterSeq === undefined ? {} : { afterSeq }), names } satisfies CmuxEventSubscription,
  });
  if (settlement.settled()) {
    stream.close();
  }
  return settlement.promise;
}

/**
 * Drain cmux's event stream from `afterSeq` to its live edge, resuming after a mid-replay hang-up.
 *
 * @param afterSeq resume strictly after this seq; undefined replays cmux's whole retained buffer
 * @param names only these event names
 * @param quietMs how long with no frame before the drain counts as caught up
 * @param deadlineMs the hard bound on the whole drain, every round included
 * @param maxRounds the most subscriptions one drain opens
 * @param nowMs the clock the deadline is shared across rounds by
 * @param openStream the subscription opener; a unit test passes a scripted fake
 * @returns the events drained and how the drain ended, or the socket's failure
 */
export async function drainResuming({
  afterSeq,
  names,
  quietMs,
  deadlineMs,
  maxRounds,
  nowMs = Date.now,
  openStream = openCmuxEventStream,
}: {
  afterSeq: number | undefined;
  names: readonly string[];
  quietMs: number;
  deadlineMs: number;
  maxRounds: number;
  nowMs?: () => number;
  openStream?: typeof openCmuxEventStream;
}): Promise<DrainedEvents | FailedDrain> {
  const deadlineAt = nowMs() + deadlineMs;
  const events: CmuxEvent[] = [];
  // No starting cursor replays the whole buffer, and a drain that then reads nothing reports seq zero.
  let highestSeq = 0;
  if (afterSeq !== undefined) {
    highestSeq = afterSeq;
  }
  let cursor = afterSeq;
  let gap = false;
  let answered = false;
  for (let rounds = 1; ; rounds += 1) {
    const round = await drainRound({
      afterSeq: cursor,
      names,
      openStream,
      quietMs,
      remainingMs: Math.max(0, deadlineAt - nowMs()),
    });
    if (round.kind === "failed") {
      return round;
    }
    events.push(...round.events);
    highestSeq = round.events.reduce((highest, event) => Math.max(highest, event.seq), highestSeq);
    // A later round resumes from a seq it just read, so a gap there is events lost between rounds — still a gap.
    gap = gap || round.ack?.gap === true;
    answered = answered || round.ack !== undefined || round.events.length > 0;
    const next = nextDrainStep({ maxRounds, round, rounds });
    if (next.step === "stop") {
      return { answered, events, gap, highestSeq, kind: "drained", rounds, truncated: next.truncated };
    }
    cursor = highestSeq;
  }
}
