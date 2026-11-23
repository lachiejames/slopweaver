/**
 * Whether a console call that ended reconnects on its own, and how long the console keeps trying. A call that hits the
 * console's 90-minute limit must reconnect automatically, with visual and audio feedback that it is happening, or the
 * new one cannot see the owner's screen for two minutes. Quitting the app mid-call is the exception: it waits for the owner
 * to press start call.
 *
 * So a reconnect follows exactly the ends the drop cue sounds for (`./callDropCue.ts`): a call that had gone live,
 * ending on a reason the owner did not ask for. Their hang-up, the page being left, reloaded or quit, and a start that
 * never went live do not reconnect, and nothing about a reconnect outlives the page — a console opened again waits for
 * the owner's press. A reconnect never gives up, repeating until it succeeds. The
 * waits back off to {@link RECONNECT_DELAYS_MS}'s last and hold there until the call is back or the owner ends it, and
 * an attempt is never spent while the browser is offline — it waits for the network instead ({@link reconnectGo}).
 *
 * Every step is written onto the dropped call's own record — each attempt scheduled, failed with its exact reason, and
 * gone live as which call — so `slopweaver talk calls` says why a reconnect has not come back. Measured, after
 * one that did not, the owner was told it tried to but did not succeed, and nothing on disk said why.
 *
 * A long call the page rolls over in a pause (`./callRollover.ts`) is not a reconnect, and a successor that goes live
 * never touches this module. Only one that fails to open enters it, as the first failed attempt of a chain for the
 * call it replaced.
 *
 * Pure; the timers, the microphone and the mint are `site/components/voice/VoiceProvider.tsx`'s, and whether an end
 * is a drop is `CallDropCue.ended`'s answer — one definition, never a second.
 */

import type { LinkSchedule } from "./callLink";
import type { ReconnectEvent } from "./talkTranscript";

/**
 * The wait before each attempt, in order: the first at once, the rest backing off, and every attempt past the last
 * waiting as long as the last. A judgement, not a measurement; the 90-minute limit, the case that motivated it,
 * reconnects on the first, and a network that comes back cuts any wait short ({@link reconnectGo}).
 */
export const RECONNECT_DELAYS_MS = [0, 2_000, 5_000, 15_000, 30_000] as const;

/** The next attempt after a drop or a failed one: which, and after how long. There is always a next. */
export interface ReconnectStep {
  readonly attempt: number;
  readonly delayMs: number;
}

/**
 * The next step of a reconnect, from how many attempts have failed so far.
 *
 * @param failed attempts already made that did not reach live — 0 straight after the drop
 * @returns the next attempt, numbered from 1, and its wait — the last declared wait once the backoff is spent
 */
export function reconnectStep({ failed }: { failed: number }): ReconnectStep {
  const at = Math.min(Math.max(failed, 0), RECONNECT_DELAYS_MS.length - 1);
  return { attempt: Math.max(failed, 0) + 1, delayMs: RECONNECT_DELAYS_MS[at] };
}

/**
 * Whether an attempt that is due goes now. Offline, it waits for the network: an attempt made with no network can only
 * fail, and the wait after it would only grow.
 *
 * @param online whether the browser says it has a network
 * @returns `attempt` to make it now, `await-network` to make it when the network is back
 */
export function reconnectGo({ online }: { online: boolean }): "attempt" | "await-network" {
  if (online) {
    return "attempt";
  }
  return "await-network";
}

/**
 * The wait before one reconnect attempt: counted down, then made — or, with the browser offline when it falls due,
 * parked until the network is back ({@link reconnectGo}). The network coming back makes a waiting attempt at once,
 * whether it was parked or still counting down. At most one attempt waits; every call ending clears it first.
 */
export class ReconnectWait {
  private cancel: (() => void) | undefined = undefined;
  private pending: number | undefined = undefined;
  private readonly attempt: (due: { attempt: number }) => void;
  private readonly online: () => boolean;
  private readonly parked: () => void;
  private readonly schedule: LinkSchedule;

  constructor({
    attempt,
    online,
    parked,
    schedule,
  }: {
    attempt: (due: { attempt: number }) => void;
    online: () => boolean;
    parked: () => void;
    schedule: LinkSchedule;
  }) {
    this.attempt = attempt;
    this.online = online;
    this.parked = parked;
    this.schedule = schedule;
  }

  /**
   * Wait for the next attempt, replacing any attempt already waiting.
   *
   * @param attempt the attempt, numbered from 1
   * @param delayMs how long to count down before it falls due
   */
  wait({ attempt, delayMs }: { attempt: number; delayMs: number }): void {
    this.clear();
    this.pending = attempt;
    this.cancel = this.schedule({
      ms: delayMs,
      run: () => {
        this.cancel = undefined;
        if (reconnectGo({ online: this.online() }) === "await-network") {
          this.parked();
          return;
        }
        this.make();
      },
    });
  }

  /** The network is back: make the waiting attempt now, parked or counting down; nothing when none is waiting. */
  networkBack(): void {
    if (this.pending === undefined) {
      return;
    }
    this.cancel?.();
    this.cancel = undefined;
    this.make();
  }

  /** Forget the waiting attempt: the call ended, or a fresh one was pressed. */
  clear(): void {
    this.cancel?.();
    this.cancel = undefined;
    this.pending = undefined;
  }

  /** Make the waiting attempt, once. */
  private make(): void {
    const attempt = this.pending;
    this.pending = undefined;
    if (attempt !== undefined) {
      this.attempt({ attempt });
    }
  }
}

/**
 * A reconnect in progress: which call dropped — every step is written onto it — how many attempts have failed, and,
 * once one reached live, when, so a call that drops again straight away continues the count instead of starting a
 * fresh one.
 */
export interface ReconnectChain {
  readonly droppedCallId: string | undefined;
  readonly failed: number;
  readonly liveAtMs: number | undefined;
}

/** The most characters of a reason a reconnect step carries — the verb's own bound (`RECONNECT_WHY_CHARS`). */
const RECONNECT_WHY_MAX = 2_000;

/** The steps a call ending writes onto the call the reconnect is for: an attempt that failed, then the next scheduled. */
export interface ReconnectJournal {
  readonly callId: string;
  readonly events: readonly ReconnectEvent[];
}

/**
 * A reconnected call that drops again within this long of going live counts as one more failed attempt, so a call that
 * keeps coming up and falling straight over keeps backing off rather than retrying at once. A judgement: long enough to
 * see a call settle.
 */
export const RECONNECT_SETTLE_MS = 60_000;

/**
 * What a call ending now leads to: another attempt after a wait, or the end of the call, with why or none — and, when
 * the end is a step of a reconnect, the steps to write onto the call it is for. A reconnect only ever retries; only the owner's
 * end, the page's, or a call that was never live stops.
 */
export type CallEndOutcome =
  | {
      readonly kind: "retry";
      readonly chain: ReconnectChain;
      readonly attempt: number;
      readonly delayMs: number;
      readonly journal: ReconnectJournal | undefined;
    }
  | { readonly kind: "stop"; readonly why: string | undefined; readonly journal: ReconnectJournal | undefined };

/**
 * What a call ending now leads to. A live call dropping starts a reconnect; an attempt that never reached live is one
 * more failure of the reconnect it belongs to, and so is a reconnected call dropping again before it settled; everything
 * else — the owner's hang-up, the page leaving, a pressed start that failed — ends the call as it always did. Each failure is
 * journalled onto the call the reconnect is for, then the next attempt scheduled, so a reconnect that has not come back
 * says why on disk — and one cut off by the page going away shows a scheduled attempt and nothing after.
 *
 * @param chain the reconnect in progress, `undefined` when there is none
 * @param callId the call ending — the one a fresh reconnect is for — or `undefined` when none was ever begun
 * @param dropped whether the call ending is a live one dropping on a reason the owner did not ask for — `CallDropCue.ended`
 * @param why the reason it is ending, `undefined` for an end the owner or the page asked for
 * @param nowMs a monotonic clock, the one `chain.liveAtMs` was read on
 * @returns the next attempt, or the end and its reason, each with the steps to journal
 */
export function callEndOutcome({
  chain,
  callId,
  dropped,
  why,
  nowMs,
}: {
  chain: ReconnectChain | undefined;
  callId: string | undefined;
  dropped: boolean;
  why: string | undefined;
  nowMs: number;
}): CallEndOutcome {
  if (why === undefined) {
    return { journal: undefined, kind: "stop", why: undefined };
  }
  let next: ReconnectChain;
  let failedAttempt: number | undefined;
  if (dropped) {
    const unsettled = chain?.liveAtMs !== undefined && nowMs - chain.liveAtMs < RECONNECT_SETTLE_MS;
    if (unsettled) {
      next = { droppedCallId: chain.droppedCallId, failed: chain.failed + 1, liveAtMs: undefined };
      failedAttempt = next.failed;
    } else {
      next = { droppedCallId: callId, failed: 0, liveAtMs: undefined };
    }
  } else if (chain !== undefined && chain.liveAtMs === undefined) {
    next = { ...chain, failed: chain.failed + 1 };
    failedAttempt = next.failed;
  } else {
    return { journal: undefined, kind: "stop", why };
  }
  const events: ReconnectEvent[] = [];
  if (failedAttempt !== undefined) {
    events.push({ attempt: failedAttempt, kind: "failed", why: bounded({ why }) });
  }
  const step = reconnectStep({ failed: next.failed });
  events.push({ attempt: step.attempt, delayMs: step.delayMs, kind: "scheduled" });
  return {
    attempt: step.attempt,
    chain: next,
    delayMs: step.delayMs,
    journal: journalOf({ callId: next.droppedCallId, events }),
    kind: "retry",
  };
}

/**
 * The steps to write, or none: there were none, or the drop came before a call was ever begun, so no file holds it.
 *
 * @param callId the call the reconnect is for
 * @param events the steps this end produced
 * @returns the journal, or `undefined` when there is nothing to write or nowhere to write it
 */
function journalOf({
  callId,
  events,
}: {
  callId: string | undefined;
  events: readonly ReconnectEvent[];
}): ReconnectJournal | undefined {
  if (callId === undefined || events.length === 0) {
    return undefined;
  }
  return { callId, events };
}

/**
 * A reason cut at the verb's bound, so one long stop message never pushes a batch past a keepalive body.
 *
 * @param why the reason whole
 * @returns its first `RECONNECT_WHY_MAX` characters
 */
function bounded({ why }: { why: string }): string {
  return why.slice(0, RECONNECT_WHY_MAX);
}

/**
 * The step written when an attempt reached live — the chain's next, since every one before it failed — naming the call
 * it went live as, whose own file carries the conversation from there.
 *
 * @param chain the reconnect the attempt belongs to, before it is marked live
 * @param newCallId the reconnected call's own id
 * @returns the journal, or `undefined` when the drop came before a call was ever begun
 */
export function reconnectLiveJournal({
  chain,
  newCallId,
}: {
  chain: ReconnectChain;
  newCallId: string;
}): ReconnectJournal | undefined {
  const live: ReconnectEvent = { attempt: chain.failed + 1, kind: "live", newCallId };
  return journalOf({ callId: chain.droppedCallId, events: [live] });
}

/** The line the orb shows from the moment the link is lost until the call is ended and the first attempt waited on. */
export const LINK_LOST_WORDS = "connection lost, reconnecting";

/** The line the orb shows while an attempt is due but the browser has no network to make it on. */
export const NETWORK_WAIT_WORDS = "connection lost, waiting for the network";

/**
 * The line the orb shows while an attempt is waited for or made.
 *
 * @param attempt the attempt, numbered from 1
 * @returns the step's words
 */
export function reconnectStepWords({ attempt }: { attempt: number }): string {
  return `connection lost, reconnecting, attempt ${String(attempt)}`;
}
