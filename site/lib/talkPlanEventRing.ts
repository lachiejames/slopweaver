/**
 * The replay rings of one plan call's event stream, and who is listening: every event `PlanCall` (`./talkPlanCall.ts`)
 * emits is numbered, kept for a late or reconnecting stream to replay, and told to each listener. Split from that
 * file, which sits at its 300-line cap.
 */
import { PLAN_CALL_LIMITS, type PlanCallEvent, type SequencedEvent } from "./planCallContract";

/** One event a plan call emits onto its ring. */
export interface PlanEmit {
  readonly event: PlanCallEvent;
  /** Kept in the usage ring, apart from the events a reconnecting page must replay. */
  readonly telemetry?: boolean;
  /** What a reconnecting stream replays in its place, measured at replay (`PlanEventRing.push`). */
  readonly replayAs?: () => PlanCallEvent;
}

/** One call's numbered events, the last {@link PLAN_CALL_LIMITS.replayRing} of each ring, and its listeners. */
export class PlanEventRing {
  private readonly ring: SequencedEvent[] = [];
  private readonly usageRing: SequencedEvent[] = [];
  private nextSeq = 1;
  /** Every stream listening now. */
  private readonly listeners = new Set<(event: SequencedEvent) => void>();

  /**
   * Whether any stream listens now.
   *
   * @returns true while one does
   */
  listening(): boolean {
    return this.listeners.size > 0;
  }

  /**
   * Listen for events after `after`, replaying what the rings still hold.
   *
   * @param after the last sequence number the stream saw, `0` for none
   * @param listener told each event
   * @param onEmpty run when the last listener stops
   * @returns the replay, and the function that stops listening
   */
  listen({
    after,
    listener,
    onEmpty,
  }: {
    after: number;
    listener: (event: SequencedEvent) => void;
    onEmpty: () => void;
  }): {
    readonly replay: readonly SequencedEvent[];
    readonly unsubscribe: () => void;
  } {
    this.listeners.add(listener);
    return {
      replay: this.replayAfter({ after }),
      unsubscribe: () => {
        this.listeners.delete(listener);
        if (this.listeners.size === 0) {
          onEmpty();
        }
      },
    };
  }

  /**
   * Number one event, keep it, and tell every listener.
   *
   * @param telemetry kept in a ring of its own, so a long call's usage can only ever evict older usage — never a tool
   *   call a reconnecting page still has to replay, nor the close
   * @param replayAs what a reconnecting stream replays in its place, measured at replay; `undefined` replays it as sent
   */
  push({
    event,
    telemetry,
    replayAs,
  }: {
    event: PlanCallEvent;
    telemetry: boolean;
    replayAs?: (() => PlanCallEvent) | undefined;
  }): void {
    const entry = this.numbered({ event });
    const ring = telemetry ? this.usageRing : this.ring;
    ring.push(entry);
    if (replayAs !== undefined) {
      this.remeasured.set(entry.seq, replayAs);
    }
    if (ring.length > PLAN_CALL_LIMITS.replayRing) {
      const evicted = ring.shift();
      if (evicted !== undefined) {
        this.remeasured.delete(evicted.seq);
      }
    }
    this.tell({ entry });
  }

  /**
   * Events whose replay is measured again as it is replayed, by sequence number: a rollover ask names the time left,
   * and a stream that reconnects after it must hear the time left NOW, not as it was when the ask went out (a last-stage
   * ask replayed 10s late would otherwise hold work past the cut).
   */
  private readonly remeasured = new Map<number, () => PlanCallEvent>();

  /**
   * Number a herald's chime and tell every listener, holding it for a stream that reconnects only until `release`: it
   * means something just before its line, so a page back inside the lead still rings it, and one back after the line
   * would ring over nothing.
   *
   * @param event the announce
   * @returns the function that ends its replay, called once its line is written or has failed
   */
  herald({ event }: { event: PlanCallEvent }): () => void {
    const entry = this.numbered({ event });
    this.heralds.add(entry);
    this.tell({ entry });
    return () => {
      this.heralds.delete(entry);
    };
  }

  /** Heralds whose lead is still running, replayed to a stream that reconnects meanwhile. */
  private readonly heralds = new Set<SequencedEvent>();

  /**
   * The next sequence number, on one event.
   *
   * @param event the event to number
   * @returns the numbered entry
   */
  private numbered({ event }: { event: PlanCallEvent }): SequencedEvent {
    const entry = { event, seq: this.nextSeq };
    this.nextSeq += 1;
    return entry;
  }

  /**
   * Tell every stream listening now.
   *
   * @param entry the numbered event
   */
  private tell({ entry }: { entry: SequencedEvent }): void {
    for (const listener of this.listeners) {
      listener(entry);
    }
  }

  /**
   * What a stream that last saw `after` replays, in order, from both rings and the heralds still leading their line.
   *
   * @param after the last sequence number the stream saw, `0` for none
   * @returns every kept event after it
   */
  private replayAfter({ after }: { after: number }): readonly SequencedEvent[] {
    return [...this.ring, ...this.usageRing, ...this.heralds]
      .filter((entry) => entry.seq > after)
      .toSorted((a, b) => a.seq - b.seq)
      .map((entry) => {
        const replayAs = this.remeasured.get(entry.seq);
        if (replayAs === undefined) {
          return entry;
        }
        return { event: replayAs(), seq: entry.seq };
      });
  }
}
