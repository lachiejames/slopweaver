/**
 * The four HERALD chimes: a short sound played just before the console has the voice say something the owner did not
 * ask for, so they can tell from across the room that the line is not the voice answering them, and which kind of line
 * it is.
 *
 * The focus nudges stay spoken: a visual-only signal would miss an owner who paces away from the computer. The same
 * voice speaks them with no spoken label, and a chime with the voice is the light signal of what the line is. One chime
 * for all automated speech is not granular enough and fifty is too granular, so there are four.
 *
 * - **focus** — a drift from the plan the owner stated, or an ISO nudge (`./talkPlanWindowNotices.ts`): one long bell.
 * - **reminder** — a meeting about to start or started (`PlanCall.announceMeeting`): a falling ding-dong.
 * - **done** — something the owner asked for finished: a quick rising pair. No line rings it now: a Slack send that
 *   went is not worth the voice saying, so it is never said unasked (`./slackSendWatch.ts`). Kept, because the four
 *   kinds are the owner's pick.
 * - **attention** — something needs the owner's word: a send held or failed, or a triage card's time up: three
 *   strikes.
 *
 * Lines that answer the owner — the "on it" acknowledgement, the look line, a resume press, a typed turn — are the
 * conversation they are in and carry no herald.
 *
 * **A herald never waits for quiet.** The orb's work cues are held while either of them talks (`./orbCue.ts`'s
 * `not-quiet` check, asked again after routing and on every commit), and that check swallowed sounds. A herald exists
 * to come right before the voice speaks, and a started meeting cuts in over
 * the owner on purpose, so {@link announceStaleReason} asks only whether a call is up and the owner's sounds are on — never the
 * phase. The server waits {@link ANNOUNCE_LEAD_MS} after sending one before the line is written
 * (`./talkPlanAnnounce.ts`). Pure: the tones are data `components/voice/orbCueSound.ts` plays.
 */
import type { OrbCueSetting, Tone } from "./orbCue";

/** The four heralds, one per kind of line the owner did not ask for. */
export const ANNOUNCE_CUES = ["focus", "reminder", "done", "attention"] as const;

/** One of {@link ANNOUNCE_CUES}. */
export type AnnounceCue = (typeof ANNOUNCE_CUES)[number];

/** What each herald means, in the owner's words for it: the card and the docs read these. */
export const ANNOUNCE_CUE_MEANINGS: Readonly<Record<AnnounceCue, string>> = {
  attention: "something needs your word: a Slack send held or failed, or a triage card's time is up",
  done: "something you asked for finished",
  focus: "a focus nudge: you drifted from the plan you stated, or ISO work is waiting while you are off it",
  reminder: "a reminder: a meeting is about to start, or has started",
};

/**
 * How long the server waits after a herald before the line it heralds is written: the longest herald is 600 ms, and
 * the page's one player queues a herald behind a work cue still sounding (≤ 250 ms plus its settle), so a second
 * leaves room for both. A judgement, not a measured bound: nothing acknowledges playback, so a slow route can still
 * run past it.
 */
export const ANNOUNCE_LEAD_MS = 1_000;

/** A struck bell: a fundamental, and a quieter partial a twelfth above it that dies sooner. */
function strike({
  hz,
  startMs,
  lengthMs,
  gain,
}: {
  hz: number;
  startMs: number;
  lengthMs: number;
  gain: number;
}): Tone[] {
  return [
    { fromHz: hz, gain, lengthMs, startMs, toHz: hz, wave: "sine" },
    { fromHz: hz * 3, gain: gain / 4, lengthMs: Math.round(lengthMs / 2), startMs, toHz: hz * 3, wave: "sine" },
  ];
}

/**
 * Each herald's notes. Louder and longer than a work cue (those peak at 0.06 and end inside 250 ms) so it reads as
 * its own thing, still well under the drop cue's 0.18 (`./callDropCue.ts`); every one ends by 600 ms. The four differ
 * in shape, not only pitch, so they are told apart without a reference note: one bell, two falling, two rising, three
 * level.
 */
export const ANNOUNCE_TONES: Readonly<Record<AnnounceCue, readonly Tone[]>> = {
  attention: [
    ...strike({ gain: 0.08, hz: 698, lengthMs: 120, startMs: 0 }),
    ...strike({ gain: 0.08, hz: 698, lengthMs: 120, startMs: 150 }),
    ...strike({ gain: 0.08, hz: 698, lengthMs: 150, startMs: 300 }),
  ],
  done: [
    ...strike({ gain: 0.08, hz: 523, lengthMs: 140, startMs: 0 }),
    ...strike({ gain: 0.08, hz: 784, lengthMs: 220, startMs: 120 }),
  ],
  focus: [
    ...strike({ gain: 0.095, hz: 659, lengthMs: 580, startMs: 0 }),
    { fromHz: 1318, gain: 0.02, lengthMs: 300, startMs: 0, toHz: 1318, wave: "sine" },
  ],
  reminder: [
    ...strike({ gain: 0.085, hz: 784, lengthMs: 260, startMs: 0 }),
    ...strike({ gain: 0.085, hz: 587, lengthMs: 330, startMs: 240 }),
  ],
};

/** Why a herald may not play now: no call is up, or the owner's sounds are off. Never that somebody is talking. */
export type AnnounceStale = "no-call" | "sound-off";

/**
 * Why a herald waiting to play may not, at the instant it is asked — before routing, after it, and on every commit
 * while it sounds.
 *
 * @param callActive whether the call it heralds a line on is still up
 * @param setting the owner's sounds pick as it stands; any sound but `off` plays the same four heralds
 * @returns the check it fails, or `undefined` while it may play
 */
export function announceStaleReason({
  callActive,
  setting,
}: {
  callActive: boolean;
  setting: OrbCueSetting;
}): AnnounceStale | undefined {
  if (!callActive) {
    return "no-call";
  }
  if (setting === "off") {
    return "sound-off";
  }
  return undefined;
}

/** Why the page's own triage chime may not play now: a voice call is up, whose line is the chime, or sounds are off. */
export type TriageDingStale = "call-up" | "sound-off";

/**
 * Why a triage chime the page owes off a call may not play, at the instant it is asked: a call that came up while it
 * waited heralds its own time-up line, so the page's chime would be a second one.
 *
 * @param callUpAnywhere whether a voice call is up in this window or another
 * @param setting the owner's sounds pick as it stands
 * @returns the check it fails, or `undefined` while it may play
 */
export function triageDingStaleReason({
  callUpAnywhere,
  setting,
}: {
  callUpAnywhere: boolean;
  setting: OrbCueSetting;
}): TriageDingStale | undefined {
  if (callUpAnywhere) {
    return "call-up";
  }
  if (setting === "off") {
    return "sound-off";
  }
  return undefined;
}

/** One herald the call sent, numbered so two of the same kind in a row are two chimes. */
export interface HeardHerald {
  readonly seq: number;
  readonly cue: AnnounceCue;
}

/**
 * How many heralds the page keeps for its player to catch up on. Two arriving in one read of the stream are set in
 * one React render, so a single newest value would lose the first; the server holds a second herald off
 * for a whole lead, so more than two at once is a stalled stream, and four is room past that.
 */
export const ANNOUNCE_KEPT = 4;

/**
 * The kept heralds with one more appended, numbered one past the newest, oldest dropped past {@link ANNOUNCE_KEPT}.
 *
 * @param kept the heralds kept so far, oldest first
 * @param cue the herald the call just sent
 * @returns the new kept list, oldest first
 */
export function withHerald({ kept, cue }: { kept: readonly HeardHerald[]; cue: AnnounceCue }): readonly HeardHerald[] {
  const newest = kept.at(-1);
  let seq = 1;
  if (newest !== undefined) {
    seq = newest.seq + 1;
  }
  return [...kept, { cue, seq }].slice(-ANNOUNCE_KEPT);
}

/**
 * The kept heralds the player has not reached yet, oldest first.
 *
 * @param kept the heralds kept, oldest first
 * @param heard the sequence number of the last one the player took; 0 before any
 * @returns every herald numbered past it
 */
export function unheardHeralds({
  kept,
  heard,
}: {
  kept: readonly HeardHerald[];
  heard: number;
}): readonly HeardHerald[] {
  return kept.filter(({ seq }) => seq > heard);
}
