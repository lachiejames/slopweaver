/**
 * The barge-in signal: the voice stopping for the owner reads "your turn", and the look-alikes — a backchannel, its own
 * echo, a cough, a mute, talking on over the owner — never do.
 */
import { describe, expect, it } from "vitest";

import { foldActivity, NO_ACTIVITY, type VoiceActivity, voiceStatusOf } from "../../lib/voiceActivity";
import {
  foldTurnTaking,
  micAheadOfWords,
  NO_TURN_TAKING,
  OWNER_GAP_MS,
  ownerSounding,
  YIELD_WITHIN_MS,
  YIELDED_SHOWN_MS,
  YIELDED_WORDS,
  yieldedNow,
} from "../../lib/voiceTurnTaking";

/** A loud level on either meter, and silence. */
const LOUD = 0.1;

/**
 * The owner's microphone's waveform RMS while they talk: a spoken sample's, as a call's cue trace logs it. Repro, from
 * the home: `grep -o 'held: the owner's microphone was loud (mic 0.480 rms 0.042' talk/calls/<call-id>-*.jsonl`
 */
const SPOKEN_RMS = 0.042;

/**
 * The owner's quiet room as the meters read it: loud on the spectral level, silent on RMS — a sample the cue trace
 * logs while nobody speaks. Repro, from the home:
 * `grep -o 'held: the owner was transcribed moments ago (mic 0.311 rms 0.004' talk/calls/<call-id>-*.jsonl`
 */
const QUIET_ROOM = { micLevel: 0.311, micRms: 0.004 } as const;

/** One meter sample a scene is built from: who is loud from when to when, in ms. */
interface Span {
  readonly fromMs: number;
  readonly untilMs: number;
}

/** The meter clock's step, ms: the call's own. */
const STEP_MS = 80;

/** Fold a scene through the activity fold, one sample per step up to `untilMs`. */
function play({
  voice,
  owner,
  untilMs,
  muted = false,
}: {
  voice: Span;
  owner: Span;
  untilMs: number;
  muted?: boolean;
}): VoiceActivity {
  let activity = NO_ACTIVITY;
  for (let at = 0; at <= untilMs; at += STEP_MS) {
    const talking = at >= owner.fromMs && at < owner.untilMs;
    activity = foldActivity({
      activity,
      input: {
        kind: "sounded",
        micLevel: talking ? LOUD : 0,
        micRms: talking ? SPOKEN_RMS : 0,
        muted,
        outputLevel: at >= voice.fromMs && at < voice.untilMs ? LOUD : 0,
      },
      nowMs: at,
    });
  }
  return activity;
}

/** The phase a call shows at an instant, with the owner's microphone at the level and RMS the scene gives it then. */
function phaseAt({
  activity,
  nowMs,
  micLevel,
  micRms,
}: {
  activity: VoiceActivity;
  nowMs: number;
  micLevel: number;
  micRms: number;
}): string {
  return voiceStatusOf({ activity, link: "live", micLevel, micRms, muted: false, nowMs, outputLevel: 0 }).phase;
}

describe("the voice stopping for the owner", () => {
  it("reads 'your turn' once the voice goes quiet under the owner's cut-in", () => {
    const activity = play({
      owner: { fromMs: 2_000, untilMs: 6_000 },
      untilMs: 3_360,
      voice: { fromMs: 0, untilMs: 2_800 },
    });
    const status = voiceStatusOf({
      activity,
      link: "live",
      micLevel: LOUD,
      micRms: SPOKEN_RMS,
      muted: false,
      nowMs: 3_360,
      outputLevel: 0,
    });
    expect(status).toEqual({
      detail: YIELDED_WORDS,
      headline: "your turn",
      nudge: undefined,
      phase: "yielded",
      seconds: undefined,
    });
  });

  it("outranks the speaking hold the lagging transcript would otherwise keep", () => {
    const quiet = play({
      owner: { fromMs: 2_000, untilMs: 6_000 },
      untilMs: 3_200,
      voice: { fromMs: 0, untilMs: 2_800 },
    });
    const spoke = foldActivity({ activity: quiet, input: { kind: "spoke" }, nowMs: 3_200 });
    expect(phaseAt({ activity: spoke, micLevel: LOUD, micRms: SPOKEN_RMS, nowMs: 3_280 })).toBe("yielded");
  });

  it("settles into hearing the owner once it has shown", () => {
    const activity = play({
      owner: { fromMs: 2_000, untilMs: 6_000 },
      untilMs: 5_000,
      voice: { fromMs: 0, untilMs: 2_800 },
    });
    const yieldedMs = activity.turn.yieldedMs!;
    expect(phaseAt({ activity, micLevel: LOUD, micRms: SPOKEN_RMS, nowMs: yieldedMs + YIELDED_SHOWN_MS })).toBe(
      "hearing",
    );
  });

  it("gives way to the voice's own sound the moment it speaks again", () => {
    const activity = play({
      owner: { fromMs: 2_000, untilMs: 6_000 },
      untilMs: 3_360,
      voice: { fromMs: 0, untilMs: 2_800 },
    });
    const status = voiceStatusOf({
      activity,
      link: "live",
      micLevel: LOUD,
      micRms: SPOKEN_RMS,
      muted: false,
      nowMs: 3_360,
      outputLevel: LOUD,
    });
    expect(status.phase).toBe("speaking");
    const again = foldActivity({
      activity,
      input: { kind: "sounded", micLevel: LOUD, micRms: SPOKEN_RMS, muted: false, outputLevel: LOUD },
      nowMs: 3_440,
    });
    expect(again.turn.yieldedMs).toBe(undefined);
  });

  it("is forgotten when the call closes", () => {
    const activity = play({
      owner: { fromMs: 2_000, untilMs: 6_000 },
      untilMs: 3_360,
      voice: { fromMs: 0, untilMs: 2_800 },
    });
    const closed = foldActivity({ activity, input: { kind: "closed" }, nowMs: 3_400 });
    expect(closed.turn).toBe(NO_TURN_TAKING);
  });
});

describe("what is not the voice stopping for the owner", () => {
  it("is not a backchannel: the voice starting while the owner talks", () => {
    const activity = play({
      owner: { fromMs: 0, untilMs: 6_000 },
      untilMs: 3_360,
      voice: { fromMs: 1_000, untilMs: 2_000 },
    });
    expect(activity.turn.yieldedMs).toBe(undefined);
    expect(phaseAt({ activity, micLevel: LOUD, micRms: SPOKEN_RMS, nowMs: 3_360 })).toBe("hearing");
  });

  it("is not its own echo, which ends with it", () => {
    const activity = play({
      owner: { fromMs: 400, untilMs: 2_800 },
      untilMs: 4_000,
      voice: { fromMs: 0, untilMs: 2_800 },
    });
    expect(activity.turn.yieldedMs).toBe(undefined);
  });

  it("is not a cough shorter than a cut-in", () => {
    const activity = play({
      owner: { fromMs: 2_000, untilMs: 2_160 },
      untilMs: 4_000,
      voice: { fromMs: 0, untilMs: 2_800 },
    });
    expect(activity.turn.yieldedMs).toBe(undefined);
  });

  it("is not the owner while muted", () => {
    const activity = play({
      owner: { fromMs: 2_000, untilMs: 6_000 },
      muted: true,
      untilMs: 3_360,
      voice: { fromMs: 0, untilMs: 2_800 },
    });
    expect(activity.turn.yieldedMs).toBe(undefined);
  });

  it("is not the voice talking on over the owner and stopping long after", () => {
    const stopsMs = 2_000 + YIELD_WITHIN_MS + 1_000;
    const activity = play({
      owner: { fromMs: 2_000, untilMs: 9_000 },
      untilMs: stopsMs + 800,
      voice: { fromMs: 0, untilMs: stopsMs },
    });
    expect(activity.turn.yieldedMs).toBe(undefined);
  });
});

describe("foldTurnTaking", () => {
  it("hands back the same object when nothing changed, since it runs twelve times a second", () => {
    const silent = { micLevel: 0, micRms: 0, muted: false, outputLevel: 0 };
    expect(foldTurnTaking({ nowMs: 100, sample: silent, turn: NO_TURN_TAKING })).toBe(NO_TURN_TAKING);
  });

  // A stretch of the owner built on the spectral level alone would never end in a quiet room.
  it("never starts or extends a stretch of the owner on a quiet room's sample, and does on their speech", () => {
    const room = { ...QUIET_ROOM, muted: false, outputLevel: 0 };
    expect(foldTurnTaking({ nowMs: 100, sample: room, turn: NO_TURN_TAKING })).toBe(NO_TURN_TAKING);
    const spoke = foldTurnTaking({
      nowMs: 100,
      sample: { micLevel: QUIET_ROOM.micLevel, micRms: SPOKEN_RMS, muted: false, outputLevel: 0 },
      turn: NO_TURN_TAKING,
    });
    expect(spoke.owner).toEqual({ lastMs: 100, sinceMs: 100 });
    expect(foldTurnTaking({ nowMs: 180, sample: room, turn: spoke }).owner).toEqual({ lastMs: 100, sinceMs: 100 });
  });

  it("does not say so before it happened or once it has shown", () => {
    const turn = { ...NO_TURN_TAKING, yieldedMs: 1_000 };
    expect(yieldedNow({ nowMs: 999, outputLevel: 0, turn })).toBe(false);
    expect(yieldedNow({ nowMs: 1_000, outputLevel: 0, turn })).toBe(true);
    expect(yieldedNow({ nowMs: 1_000 + YIELDED_SHOWN_MS, outputLevel: 0, turn })).toBe(false);
  });
});

// The triage clock's line must not be posted while the owner talks; the page asks this first.
describe("ownerSounding", () => {
  it("reads the owner sounding through a breath, quiet once it outlasts one, and never before they have made a sound", () => {
    const loud = foldTurnTaking({
      nowMs: 1_000,
      sample: { micLevel: LOUD, micRms: SPOKEN_RMS, muted: false, outputLevel: 0 },
      turn: NO_TURN_TAKING,
    });
    expect(ownerSounding({ nowMs: 1_000 + OWNER_GAP_MS, turn: loud })).toBe(true);
    expect(ownerSounding({ nowMs: 1_000 + OWNER_GAP_MS + 1, turn: loud })).toBe(false);
    expect(ownerSounding({ nowMs: 1_000, turn: NO_TURN_TAKING })).toBe(false);
    const muted = foldTurnTaking({
      nowMs: 1_000,
      sample: { micLevel: LOUD, micRms: SPOKEN_RMS, muted: true, outputLevel: 0 },
      turn: NO_TURN_TAKING,
    });
    expect(ownerSounding({ nowMs: 1_000, turn: muted })).toBe(false);
  });
});

// A relay's call and the owner's transcript ride two transports, so speech the owner began before the relay reached
// the page can have its first fragment land after it.
describe("micAheadOfWords", () => {
  const stretch = (lastMs: number) => ({ lastMs, sinceMs: lastMs - 300 });

  // `performance.now()` need not advance between callbacks, so a tie reads ahead, the fail-closed way.
  it("is true when the owner's microphone was audible after, or on the same millisecond as, their latest words", () => {
    expect(micAheadOfWords({ lastTranscribedMs: 1_080, ownerStretch: stretch(1_081) })).toBe(true);
    expect(micAheadOfWords({ lastTranscribedMs: 1_080, ownerStretch: stretch(1_080) })).toBe(true);
    expect(micAheadOfWords({ lastTranscribedMs: 1_080, ownerStretch: stretch(1_079) })).toBe(false);
  });

  it("is false with no stretch of the owner's, or none of their words yet", () => {
    expect(micAheadOfWords({ lastTranscribedMs: 1_080, ownerStretch: undefined })).toBe(false);
    expect(micAheadOfWords({ lastTranscribedMs: undefined, ownerStretch: stretch(1_081) })).toBe(false);
  });

  const ahead = (activity: VoiceActivity) =>
    micAheadOfWords({ lastTranscribedMs: activity.lastTranscribedMs, ownerStretch: activity.turn.owner });
  const loudAt = ({ activity, nowMs }: { activity: VoiceActivity; nowMs: number }) =>
    foldActivity({
      activity,
      input: { kind: "sounded", micLevel: LOUD, micRms: SPOKEN_RMS, muted: false, outputLevel: 0 },
      nowMs,
    });
  const yes = foldActivity({
    activity: loudAt({ activity: NO_ACTIVITY, nowMs: 1_000 }),
    input: { kind: "heard", text: "Yes" },
    nowMs: 1_400,
  });

  it("reads the live fold: a yes heard, then the microphone loud before the next words land, then those words", () => {
    expect(ahead(yes)).toBe(false);
    const louder = loudAt({ activity: yes, nowMs: 2_000 });
    expect(ahead(louder)).toBe(true);
    const caught = foldActivity({ activity: louder, input: { kind: "heard", text: " Well" }, nowMs: 2_300 });
    expect(ahead(caught)).toBe(false);
  });

  // A typed turn landing after the sample advances `lastHeardMs`, but it carries no audio, so the sound
  // sampled before it is still speech no transcript has caught up with.
  it("stays ahead when a typed turn lands after the sample, which `lastHeardMs` alone would have masked", () => {
    const typed = foldActivity({
      activity: loudAt({ activity: yes, nowMs: 2_000 }),
      input: { kind: "heard", text: "ship it", typed: true },
      nowMs: 2_200,
    });
    expect([typed.lastHeardMs, typed.lastTranscribedMs, ahead(typed)]).toEqual([2_200, 1_400, true]);
  });

  // A blank or text-less fragment is no words, so it cannot mask the sample either.
  it("stays ahead when a blank or text-less fragment lands after the sample", () => {
    const loud = loudAt({ activity: yes, nowMs: 2_000 });
    const blank = foldActivity({ activity: loud, input: { kind: "heard", text: "  " }, nowMs: 2_200 });
    const bare = foldActivity({ activity: loud, input: { kind: "heard" }, nowMs: 2_200 });
    expect([blank.lastTranscribedMs, ahead(blank), bare.lastTranscribedMs, ahead(bare)]).toEqual([
      1_400,
      true,
      1_400,
      true,
    ]);
  });
});
