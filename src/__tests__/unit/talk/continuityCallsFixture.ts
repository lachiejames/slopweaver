/**
 * The call, steer and continuity read `continuityCalls.test.ts` starts every case from: a dropped call whose owner
 * asked something after their one relayed steer. Held apart from that file to keep it under the file-size
 * ratchet's cap, and importable by any later test of the calls half.
 */
import { type CallRecord, type CallSegment } from "../../../talk/callRecord.js";
import type { ContinuitySteer, TalkContinuity } from "../../../talk/continuity.js";
import { callsSince } from "../../../talk/continuityCalls.js";
import type { TypedConversation } from "../../../talk/typedConversation.js";

/** Nothing typed since the call: these cases are about the call itself. */
export const NO_TYPING: TypedConversation = {
  afterCall: true,
  cut: 0,
  floorPartial: false,
  partial: false,
  sinceIso: "2026-09-25T02:29:40.000Z",
  turns: [],
};

export const CALL = "a0000041-0000-4000-8000-000000000044";
export const SINCE = "2026-09-22T02:30:00.000Z";
export const RELAYED_AT = "2026-09-25T02:26:00.000Z";

/** A rollover's opener when no call before it was written down: never greet, and say nothing until the owner speaks. */
export const SILENT_ROLLOVER = [
  "This call is an AUTOMATIC ROLLOVER: the console moved the owner's ongoing call with you onto this fresh one in a pause, so",
  "it is the same conversation and, to the owner, nothing happened. Never greet them, never say you are back or",
  "reconnected, and never ask them to repeat themselves; when they speak, answer as the same call. If they were showing",
  "their screen, the share carried over, so read_screen works without asking them to share again.",
  "Say NOTHING until they speak.",
];

/**
 * One segment, overridable.
 *
 * @param over the fields a case changes
 * @returns the owner's final line asking after the staging pool, with `over` applied
 */
export const segment = (over: Partial<CallSegment> = {}): CallSegment => ({
  atIso: "2026-09-25T02:25:00.000Z",
  beganIso: "2026-09-25T02:25:00.000Z",
  final: true,
  id: "s-1",
  open: undefined,
  text: "look at the staging pool",
  who: "owner",
  ...over,
});

/**
 * One call as the store folds it: dropped, no end written.
 *
 * @param over the fields a case changes
 * @returns four lines ending on the owner cut off mid-sentence, with `over` applied
 */
export const call = (over: Partial<CallRecord> = {}): CallRecord => ({
  callId: CALL,
  ended: undefined,
  lastIso: "2026-09-25T02:29:40.000Z",
  notes: [],
  offers: [],
  openedIso: "2026-09-25T02:20:00.000Z",
  origin: undefined,
  reconnects: [],
  segments: [
    segment(),
    segment({ atIso: "2026-09-25T02:25:30.000Z", id: "s-2", text: "on it", who: "voice" }),
    segment({ atIso: "2026-09-25T02:29:10.000Z", id: "s-3", text: "and merge the ISO PR once CI is green" }),
    segment({ atIso: "2026-09-25T02:29:40.000Z", final: false, id: "s-4", text: "then ping Ari about the" }),
  ],
  sessionId: "sess_1",
  skipped: 0,
  surface: "voice",
  usages: [],
  voice: "marin",
  written: [],
  ...over,
});

/** The one relayed steer, registered between the owner's first words and their later ones. */
export const steer: ContinuitySteer = {
  atIso: RELAYED_AT,
  delivery: { detail: "typed", kind: "typed" },
  heard: "look at the staging pool",
  outcome: { lastAction: undefined, marks: [], rowPresent: true, settlement: undefined },
  reachedChat: true,
  slug: "talk-9b2f",
  turnId: "a0000075-0000-4000-8000-000000000082",
  typed: false,
  words: "Look at the staging pool.",
};

/**
 * A read holding the calls given and, by default, the one steer.
 *
 * @param over the fields a case changes
 * @returns the read built after the dropped call, with `over` applied
 */
export const continuity = (over: Partial<TalkContinuity> = {}): TalkContinuity => ({
  builtIso: "2026-09-25T02:40:00.000Z",
  calls: callsSince({ calls: [call()], sinceIso: SINCE }),
  knowledge: [],
  rulings: [],
  sinceIso: SINCE,
  steers: [steer],
  typed: [],
  unread: [],
  ...over,
});
