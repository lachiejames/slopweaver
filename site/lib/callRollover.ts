/*
 * A call rolled over in a pause: the page's half of the console's ninety-minute limit, so the limit never cuts the owner
 * off mid-sentence (it did so three times in one day).
 *
 * The server tells the page, past `PLAN_CALL_LIMITS.rolloverFromMs`, that the call should roll over, and tells it again
 * with the time left once the cut is near (`site/lib/talkPlanRolloverAsk.ts`). The page then releases the call ON PURPOSE and opens a
 * silent successor, with no drop cue, no "back" line and no reconnect journal: the successor is a new call in the same
 * conversation, not a dropped one coming back. Only a successor that FAILS to open enters the ordinary visible
 * reconnect loop (`site/lib/callReconnect.ts`), because then the invisibility has failed and the owner must not believe the
 * call is listening.
 *
 * Sequential, never two calls at once: every browser-side owner of a call is singular, and OpenAI documents one
 * Voice conversation at a time. This module decides; `VoiceProvider` performs. No React, clock, fetch or audio here.
 *
 * The server's ask is held, not acted on at once: it goes ahead on the first meter sample whose floor holds nothing
 * (`pageRolloverHold`, `./callRolloverFloor.ts`), judged at the stage the remaining lifetime puts it in
 * ({@link rolloverUrgency}), or `urgent` once the thread's context is nearly full ({@link askStage}), and every change of what holds it is journalled onto the call
 * ({@link QuietRollover.observed}).
 */

import { PLAN_CALL_LIMITS } from "./planCallContract";

/**
 * Why the page is opening a call: the owner pressing start, a dropped call coming back, or a long call rolled over in a
 * pause. One field rather than two flags, so "a reconnect that is also a rollover" cannot be said; the mint carries it
 * to `slopweaver talk offer`, which tells the voice what to do with it (`src/talk/mintOpener.ts`).
 */
export type CallOpenMode = "fresh" | "reconnect" | "rollover";

/**
 * Read the mode off a mint's body, refusing anything else rather than reading it as a fresh press.
 *
 * @param value the body's `mode` field, whatever it holds
 * @returns the mode, or `undefined` when it is absent or not one of the three
 */
export function callOpenModeOf({ value }: { value: unknown }): CallOpenMode | undefined {
  if (value === "fresh" || value === "reconnect" || value === "rollover") {
    return value;
  }
  return undefined;
}

/** Whether a rollover is under way, and the call it is replacing. */
export type RolloverState =
  | { readonly kind: "idle" }
  | { readonly kind: "opening"; readonly previousCallId: string | undefined; readonly reason: string };

/** What happened to the call or its successor. */
export type RolloverInput =
  | {
      readonly kind: "requested";
      /** the call the server's rollover event arrived on */
      readonly callId: string | undefined;
      readonly reason: string;
      /** whether that call is still the page's own, rather than one already replaced */
      readonly current: boolean;
      /** whether the owner has hung up on it */
      readonly closing: boolean;
    }
  | { readonly kind: "opened" }
  | { readonly kind: "failed"; readonly why: string }
  | { readonly kind: "cancelled" };

/** What the page does next. */
export type RolloverEffect =
  | { readonly kind: "none" }
  | { readonly kind: "replace"; readonly reason: string }
  | { readonly kind: "retry"; readonly previousCallId: string | undefined; readonly why: string }
  | { readonly kind: "settled" };

/** No rollover under way. */
export const ROLLOVER_IDLE: RolloverState = { kind: "idle" };

/**
 * Step the rollover on one input.
 *
 * Only the page's own live call, idle and not hung up on, starts one: a replayed or duplicate event while the
 * successor opens, or one reaching a call already replaced, does nothing. A successor that opens settles it quietly;
 * one that fails hands the old call's id to the reconnect loop. The owner's hang-up or leaving the page cancels it, never
 * retrying.
 *
 * @returns the next state and the one effect for the page to perform
 */
export function rolloverTransition({ state, input }: { state: RolloverState; input: RolloverInput }): {
  readonly state: RolloverState;
  readonly effect: RolloverEffect;
} {
  const unchanged = { effect: { kind: "none" }, state } as const;
  if (input.kind === "cancelled") {
    return { effect: { kind: "none" }, state: ROLLOVER_IDLE };
  }
  if (input.kind === "requested") {
    const accepted = state.kind === "idle" && input.current && !input.closing;
    if (!accepted) {
      return unchanged;
    }
    return {
      effect: { kind: "replace", reason: input.reason },
      state: { kind: "opening", previousCallId: input.callId, reason: input.reason },
    };
  }
  if (state.kind === "idle") {
    return unchanged;
  }
  if (input.kind === "opened") {
    return { effect: { kind: "settled" }, state: ROLLOVER_IDLE };
  }
  return {
    effect: { kind: "retry", previousCallId: state.previousCallId, why: input.why },
    state: ROLLOVER_IDLE,
  };
}

/**
 * How long both of the page's meters must have been silent before a rollover the server asked for goes ahead. The
 * server's own quiet reads transcripts, which lag the audio (`voiceTurnTaking.ts`), so words the owner began a moment before
 * the server's window can still be untranscribed when it asks. The meters see them within a
 * sample. Longer than a breath inside their speech (`OWNER_GAP_MS`, `voiceTurnTaking.ts`); the length itself is a judgement.
 */
export const ROLLOVER_METER_QUIET_MS = 1_000;

/**
 * How long a turn the voice owes the owner holds a rollover, from the voice's final that began the debt (`owedFromMs`,
 * `./voiceOwed.ts`, fixed so later sound never slides it on): a successor's fold starts empty, so a rollover takes the
 * nudge that turn offers away. Bounded, never the whole obligation, so an owed turn the owner walked away from cannot hold a
 * call from its rollover (from `PLAN_CALL_LIMITS.rolloverFromMs`, 80 min) into its lifetime cut (90 min) — the same 90s
 * after which the fold calls the owner's own silence theirs (`UNANSWERED_FORGET_MS`). Bounded holds still
 * renew one another across a steady conversation, which is why the urgent stage drops the ones that wait for a turn
 * (`./callRolloverFloor.ts`).
 */
export const ROLLOVER_OWED_HOLD_MS = 90_000;

/**
 * How near a held rollover is to the lifetime's cut: `calm` holds for every conversational turn, `urgent`
 * ({@link PLAN_CALL_LIMITS.rolloverUrgentMs} left) stops waiting for the next turn, `last`
 * ({@link PLAN_CALL_LIMITS.rolloverLastMs} left) waits only for a second of quiet on both meters.
 */
export type RolloverUrgency = "calm" | "urgent" | "last";

/**
 * The stage a held rollover is in with `remainingMs` of the lifetime left.
 *
 * @param remainingMs how long until the lifetime cuts the call ({@link heldAskStage}), negative once overdue
 * @returns `last` at or inside the last window (an overdue deadline included), `urgent` inside the urgent one, else `calm`
 */
export function rolloverUrgency({ remainingMs }: { remainingMs: number }): RolloverUrgency {
  if (remainingMs <= PLAN_CALL_LIMITS.rolloverLastMs) {
    return "last";
  }
  if (remainingMs <= PLAN_CALL_LIMITS.rolloverUrgentMs) {
    return "urgent";
  }
  return "calm";
}

/** The time left the server named, and the page's `performance.now()` as it arrived. */
export interface KnownRemainder {
  readonly remainingMs: number;
  readonly atMs: number;
}

/**
 * The time left at `nowMs`: the server's remainder less the page's `performance.now()` since it arrived.
 *
 * The page's count may run LATE, never early, and the server corrects it. The page reads no wall clock: a civil clock
 * stepped forward would fake the last stage minutes early and drop the owner's turn's holds mid-sentence, and on the page a
 * step and a sleep look the same. `performance.now()` stops while a Mac sleeps
 * (`mach_absolute_time`), while the server's cut, a Node timer, runs on (libuv's darwin clock is
 * `mach_continuous_time`), so after a sleep the page's count is behind; the server's own asks, sent as the urgent and
 * last windows open on that same Node clock, put it right ({@link soonerRemainder}).
 *
 * @param known the server's remainder as the page received it
 * @param nowMs the page's `performance.now()` now
 * @returns how long until the lifetime cuts the call, negative once overdue
 */
export function remainingAt({ known, nowMs }: { known: KnownRemainder; nowMs: number }): number {
  return known.remainingMs - (nowMs - known.atMs);
}

/**
 * The stage a held ask is in at `nowMs`: `calm` until the server names the time left, then counted down by
 * {@link remainingAt}. A late delivery of the server's ask makes the page's count late by the delay, which neither end
 * can measure; the server asks again at the last stage's boundary, so a stream that was only slow is corrected there.
 * A reconnect's replay is measured as it is built (`replayAs`, `./talkPlanEventRing.ts`), so the outage itself is
 * deducted, while the delivery after it is not.
 *
 * What this does NOT close, and what would: a delay between the server measuring and this page handling the ask —
 * a stalled main thread, a stream slow to flush — overstates the time left by that delay, and in the last stage a
 * progressing-work hold can then outlast the cut (6s of delay with 10s left). Only a clock
 * both ends share would measure it; a round-trip offset on the stream would bound it. Neither exists here, so
 * the delay the work hold absorbs before it can outlast the cut is `ROLLOVER_CUT_SLACK_MS` plus `rolloverQuietMs`,
 * about five seconds.
 *
 * @param known the server's remainder as received, `undefined` while it has said only that the cut is far
 * @param nowMs the page's `performance.now()` now
 * @returns the stage, and the time left when one is known
 */
export function heldAskStage({ known, nowMs }: { known: KnownRemainder | undefined; nowMs: number }): {
  readonly urgency: RolloverUrgency;
  readonly remainingMs: number | undefined;
} {
  if (known === undefined) {
    return { remainingMs: undefined, urgency: "calm" };
  }
  const remainingMs = remainingAt({ known, nowMs });
  return { remainingMs, urgency: rolloverUrgency({ remainingMs }) };
}

/**
 * The remainder a held ask keeps when another arrives: whichever leaves less time. Neither count runs early, so the
 * sooner is the truer: a fresh server ask corrects a count a sleep left behind, and an older ask replayed after a
 * newer one, or an ask naming no time, never pushes the stage back.
 *
 * @param held the remainder already held, if any
 * @param arrived the one that just arrived, if it named one
 * @param nowMs the page's `performance.now()` as it arrived
 * @returns the remainder to hold
 */
export function soonerRemainder({
  held,
  arrived,
  nowMs,
}: {
  held: KnownRemainder | undefined;
  arrived: KnownRemainder | undefined;
  nowMs: number;
}): KnownRemainder | undefined {
  if (held === undefined) {
    return arrived;
  }
  if (arrived === undefined) {
    return held;
  }
  return remainingAt({ known: held, nowMs }) < arrived.remainingMs ? held : arrived;
}

/** What {@link QuietRollover} has the page do; every one is `VoiceProvider`'s, passed in as a plain function. */
export interface RolloverSeams {
  /** Forget the old call as live without a drop cue: nothing dropped. */
  readonly silence: () => void;
  /** Release the old call on the wire, writing `why` as its end — no cue, no reconnect, share and mute kept. */
  readonly release: (input: { readonly why: string }) => void;
  /** Open the successor, minted to wait silently (`CallOpenMode` `rollover`). */
  readonly open: () => void;
  /**
   * The successor failed to open: start the visible reconnect for the call it replaced, the drop cue with it — the
   * invisibility has failed, and the owner must not believe the call is listening.
   */
  readonly dropped: (input: { readonly previousCallId: string | undefined }) => void;
  /** Write one line onto the call the ask arrived on: a change in the held ask, never a meter sample. */
  readonly journal: (input: { readonly detail: string }) => void;
  /** The page's `performance.now()`, the clock its meters run on. */
  readonly now: () => number;
}

/** A rollover the server asked for, held until the page hears a quiet floor. */
interface HeldAsk {
  readonly callId: string | undefined;
  readonly reason: string;
  /** the time left the server named, as received; `undefined` while it says the cut is far */
  readonly known: KnownRemainder | undefined;
  /** whether the server said the thread's context is nearly full, sticky for the call it asked on */
  readonly contextUrgent: boolean;
  readonly standing: () => { readonly current: boolean; readonly closing: boolean };
}

/** The journal line for a held ask the thread's nearly full context made urgent. */
export const CONTEXT_URGENT_DETAIL = "entered urgent: the thread's context is nearly full";

/**
 * The stage a held ask is in at `nowMs`: the lifetime's ({@link heldAskStage}), raised from `calm` to `urgent` once the
 * server said the thread's context is nearly full. Context never makes it `last`, and names no remainder: a compaction
 * is a silence, not a cut that takes the owner's words, so no deadline is invented for it.
 *
 * @param ask the held ask's remainder and context urgency
 * @param nowMs the page's `performance.now()` now
 * @returns the stage, and the lifetime's remainder when one is known
 */
export function askStage({
  ask,
  nowMs,
}: {
  ask: { readonly known: KnownRemainder | undefined; readonly contextUrgent: boolean };
  nowMs: number;
}): { readonly urgency: RolloverUrgency; readonly remainingMs: number | undefined } {
  const lifetime = heldAskStage({ known: ask.known, nowMs });
  if (ask.contextUrgent && lifetime.urgency === "calm") {
    return { remainingMs: lifetime.remainingMs, urgency: "urgent" };
  }
  return lifetime;
}

/**
 * One page's rollover across its calls: {@link rolloverTransition}'s state, held so a replayed server event is judged
 * synchronously, and its effects performed through {@link RolloverSeams}.
 */
export class QuietRollover {
  private state: RolloverState = ROLLOVER_IDLE;
  private held: HeldAsk | undefined = undefined;
  /** The stage and the hold last journalled for the held ask, so only a change is written. */
  private shown: { urgency: RolloverUrgency; hold: string | undefined } | undefined = undefined;
  private readonly seams: RolloverSeams;

  constructor({ seams }: { seams: RolloverSeams }) {
    this.seams = seams;
  }

  /**
   * The server asked for a rollover: hold it until the page's own floor is free, and say how long the call has left. A
   * later ask on the same call replaces a held one, keeping whichever time left is sooner — the server asks again,
   * naming it, as its urgent and last windows open — and nothing else happens yet. Called as the event arrives, which
   * is when the page's clocks are read.
   *
   * @param callId the call the event arrived on
   * @param lifetimeRemainingMs how long until the lifetime cuts the call, `null` while the server says it is far
   * @param contextUrgent whether the server said the thread's context is nearly full; a later ask on the same call
   *   that does not say so never takes it back
   * @param standing read when the ask goes ahead, not now: whether that call is still the page's own, and whether the
   *   owner has hung up on it
   */
  asked({
    callId,
    reason,
    lifetimeRemainingMs,
    contextUrgent,
    standing,
  }: {
    callId: string | undefined;
    reason: string;
    lifetimeRemainingMs: number | null;
    contextUrgent: boolean;
    standing: () => { readonly current: boolean; readonly closing: boolean };
  }): void {
    const nowMs = this.seams.now();
    const arrived = lifetimeRemainingMs === null ? undefined : { atMs: nowMs, remainingMs: lifetimeRemainingMs };
    const before = this.held !== undefined && this.held.callId === callId ? this.held : undefined;
    const known = soonerRemainder({ arrived, held: before?.known, nowMs });
    const wasUrgent = before?.contextUrgent === true;
    this.held = { callId, contextUrgent: wasUrgent || contextUrgent, known, reason, standing };
    this.shown = undefined;
    const detail = arrived === undefined ? "ask received" : `ask received: ${secondsLeft(arrived)}`;
    this.seams.journal({ detail });
    if (contextUrgent && !wasUrgent) {
      this.seams.journal({ detail: CONTEXT_URGENT_DETAIL });
    }
  }

  /**
   * The stage the held ask is in, and the lifetime left, which the meter loop judges its floor at. Bound, so the meter
   * clock can hold it as a plain function of stable identity.
   *
   * @param nowMs the meter sample's instant, on `performance.now()`
   * @returns the stage and the remainder ({@link askStage}), or `undefined` when no ask is held and there is no
   *   floor to judge
   */
  readonly stage = ({
    nowMs,
  }: {
    nowMs: number;
  }): { readonly urgency: RolloverUrgency; readonly remainingMs: number | undefined } | undefined => {
    const ask = this.held;
    if (ask === undefined) {
      return undefined;
    }
    return askStage({ ask, nowMs });
  };

  /**
   * One meter sample's verdict on the floor: a held ask journals what changed — the stage, then what holds it — and
   * goes ahead, once, the first time nothing does. Bound, like {@link QuietRollover.stage}.
   *
   * @param hold what holds the floor (`pageRolloverHold`), `undefined` when it is free
   * @param nowMs the meter sample's instant, on `performance.now()`
   */
  readonly observed = ({ hold, nowMs }: { hold: string | undefined; nowMs: number }): void => {
    const ask = this.held;
    if (ask === undefined) {
      return;
    }
    const { urgency, remainingMs } = askStage({ ask, nowMs });
    const before = this.shown;
    if (remainingMs !== undefined && urgency !== "calm" && before?.urgency !== urgency) {
      this.seams.journal({ detail: `entered ${urgency}: ${secondsLeft({ remainingMs })}` });
    }
    this.shown = { hold, urgency };
    if (hold !== undefined) {
      if (before?.hold !== hold) {
        this.seams.journal({ detail: `held: ${hold}` });
      }
      return;
    }
    this.held = undefined;
    this.shown = undefined;
    // Journalled before the release, so the line lands on the call it describes rather than its successor.
    this.seams.journal({ detail: `released in a meter pause (${urgency})` });
    this.requested({ callId: ask.callId, reason: ask.reason, ...ask.standing() });
  };

  /**
   * The server said, in a free floor, that the call should roll over: release it and open the successor, once.
   *
   * @param callId the call the event arrived on
   * @param current whether that call is still the page's own
   * @param closing whether the owner has hung up on it
   */
  requested({
    callId,
    reason,
    current,
    closing,
  }: {
    callId: string | undefined;
    reason: string;
    current: boolean;
    closing: boolean;
  }): void {
    const effect = this.step({ input: { callId, closing, current, kind: "requested", reason } });
    if (effect.kind !== "replace") {
      return;
    }
    this.seams.silence();
    this.seams.release({ why: effect.reason });
    this.seams.open();
  }

  /**
   * A call reached live.
   *
   * @returns whether it was a rollover's successor, so the page plays no back cue and writes no reconnect
   */
  opened(): boolean {
    return this.step({ input: { kind: "opened" } }).kind === "settled";
  }

  /**
   * A call ended. The owner's end or the page's cancels a rollover under way; any other end of a successor still opening is
   * its failure, handed to the reconnect.
   *
   * @param why the reason it ended, `undefined` for an end the owner or the page asked for
   */
  ended({ why }: { why: string | undefined }): void {
    // An ask still held belonged to the call that just ended.
    this.held = undefined;
    this.shown = undefined;
    if (why === undefined) {
      this.step({ input: { kind: "cancelled" } });
      return;
    }
    const effect = this.step({ input: { kind: "failed", why } });
    if (effect.kind === "retry") {
      this.seams.dropped({ previousCallId: effect.previousCallId });
    }
  }

  /** Step the state on one input, keeping the next state. */
  private step({ input }: { input: RolloverInput }): RolloverEffect {
    const next = rolloverTransition({ input, state: this.state });
    this.state = next.state;
    return next.effect;
  }
}

/**
 * How long a held ask has before the lifetime cuts its call, as the journal says it.
 *
 * @returns e.g. `173 seconds remain`, rounded up and never below zero
 */
function secondsLeft({ remainingMs }: { remainingMs: number }): string {
  return `${String(Math.ceil(Math.max(0, remainingMs) / 1_000))} seconds remain`;
}
