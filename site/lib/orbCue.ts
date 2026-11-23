/**
 * The orb's SOUND: a short, quiet earcon for the work it is wearing, so the state its colour and badge show can be
 * heard by an owner who is not looking at it. Audio feedback says the same thing as the orb's status without saying too
 * much, offers a few sound options to try as the orb has its styles, and applies a pick live on the call.
 *
 * So the BADGE `orbFaceOf` (`./orbMood.ts`) already decides is the only input, and this module decides when a badge
 * is worth a sound and what that sound is. "Without saying too much" is five rules, each one a line below:
 *
 * - **A badge is announced once.** Every render re-reads the face about twelve times a second; only a badge the orb
 *   had not already announced can sound, and a badge clearing makes the next one fresh.
 * - **Never over speech.** While the owner is talking or the voice is, the badge waits; it is announced at the first quiet
 *   moment if the orb is STILL wearing it, and dropped if the work ended meanwhile — a sound never describes work
 *   that is over.
 * - **Still due when it plays.** Routing a sound to the owner's speaker is asynchronous, so a cue is checked again at
 *   the instant it is scheduled ({@link cueStillDue}) and dropped if the call ended, somebody started talking, the
 *   badge moved on, the owner's pick changed or the speaker changed while it waited. A pick's sample is held to the
 *   same ({@link sampleStillDue}): on a call, in quiet, while it is still the owner's pick.
 * - **A flicker is one sound.** Tool after tool inside {@link CUE_GAP_MS} sounds once, and the same cue does not
 *   repeat inside {@link CUE_REPEAT_MS}; a badge throttled away is consumed, never queued.
 * - **An error is the drop cue's.** A call that fails already plays `callDropCue.ts`'s louder cut-out, so the orb's
 *   own error badge stays silent rather than sounding the same event twice. Listening, hearing and speaking have no
 *   sound of their own: the owner can already hear those.
 *
 * One sound is not a badge's: while a delegated turn runs on with the voice silent, the server's `progress` events
 * play {@link PROGRESS_CUE} on its cadence, under the same quiet, pick and still-due rules
 * ({@link progressCueStillDue}) — the sound that stands in for a spoken "still on it".
 *
 * Each badge sounds in one of {@link CUE_SOUNDS}, the owner's pick, switched live. Pure: the clock is a seam, and the tones
 * are data `components/voice/orbCueSound.ts` plays.
 */
import type { OrbBadge } from "./orbMood";

/** Every badge that has a sound — every work badge, and the stall. */
export const ORB_CUES = [
  "thinking",
  "writing",
  "looking",
  "slack",
  "code",
  "recalling",
  "browsing",
  "relaying",
  "working",
  "stalled",
] as const satisfies readonly OrbBadge[];

/** One of {@link ORB_CUES}. */
export type OrbCue = (typeof ORB_CUES)[number];

/** Within this long of the last cue, a new badge is announced silently: tool after tool is one sound. */
export const CUE_GAP_MS = 1200;

/** Within this long of the same cue, it does not sound again: a turn reasoning between tools chimes once. */
export const CUE_REPEAT_MS = 6000;

/** The sounds the owner can pick between, as the stage has its looks. */
export const CUE_SOUNDS = ["chimes", "taps", "glass"] as const;

/** One of {@link CUE_SOUNDS}. */
export type CueSound = (typeof CUE_SOUNDS)[number];

/** What each sound is, in a few words, for its option's hover. */
export const CUE_SOUND_INTENTS: Readonly<Record<CueSound, string>> = {
  chimes: "soft little melodies: eyes opening rise, Slack knocks, a relay is sent away",
  glass: "small bell strikes, a different note for each kind of work",
  taps: "the quietest: a few dry ticks, their count and pitch saying what it is doing",
};

/** One note of a cue: a waveform gliding from one pitch to another, offset from the cue's start. */
export interface Tone {
  readonly wave: "sine" | "triangle";
  readonly startMs: number;
  readonly lengthMs: number;
  readonly fromHz: number;
  readonly toHz: number;
  /** Peak gain, well under the drop cue's 0.18 (`callDropCue.ts`) and the voice's own level. */
  readonly gain: number;
}

/** A steady note: one pitch, start to end. */
function note({
  wave,
  startMs,
  lengthMs,
  hz,
  gain,
}: {
  wave: Tone["wave"];
  startMs: number;
  lengthMs: number;
  hz: number;
  gain: number;
}): Tone {
  return { fromHz: hz, gain, lengthMs, startMs, toHz: hz, wave };
}

/** A dry tick for the taps: a very short triangle at one pitch. */
function tick({ startMs, hz }: { startMs: number; hz: number }): Tone {
  return note({ gain: 0.04, hz, lengthMs: 18, startMs, wave: "triangle" });
}

/** A bell strike for the glass: a fundamental and a quieter partial a twelfth above it, struck together. */
function bell({ startMs, hz }: { startMs: number; hz: number }): readonly Tone[] {
  return [
    note({ gain: 0.04, hz, lengthMs: 180, startMs, wave: "sine" }),
    note({ gain: 0.015, hz: hz * 3, lengthMs: 90, startMs, wave: "sine" }),
  ];
}

/**
 * Each sound's notes for each cue. Every cue ends inside 250 ms and every note peaks at or under 0.06, so it is a
 * texture beside the voice rather than a second voice.
 */
export const CUE_TONES: Readonly<Record<CueSound, Readonly<Record<OrbCue, readonly Tone[]>>>> = {
  // Shapes that rhyme with the orb's motions: eyes opening rise, Slack knocks, the code ticks, remembering dips and
  // comes back, the browser glides off, a relay is sent away, a stall sinks.
  chimes: {
    browsing: [{ fromHz: 420, gain: 0.045, lengthMs: 160, startMs: 0, toHz: 720, wave: "sine" }],
    code: [
      note({ gain: 0.035, hz: 880, lengthMs: 25, startMs: 0, wave: "triangle" }),
      note({ gain: 0.035, hz: 1040, lengthMs: 25, startMs: 60, wave: "triangle" }),
      note({ gain: 0.035, hz: 880, lengthMs: 25, startMs: 120, wave: "triangle" }),
    ],
    looking: [
      note({ gain: 0.045, hz: 440, lengthMs: 70, startMs: 0, wave: "sine" }),
      note({ gain: 0.045, hz: 660, lengthMs: 90, startMs: 90, wave: "sine" }),
    ],
    recalling: [
      { fromHz: 520, gain: 0.04, lengthMs: 90, startMs: 0, toHz: 400, wave: "sine" },
      { fromHz: 400, gain: 0.04, lengthMs: 110, startMs: 110, toHz: 600, wave: "sine" },
    ],
    relaying: [{ fromHz: 350, gain: 0.04, lengthMs: 190, startMs: 0, toHz: 780, wave: "triangle" }],
    slack: [
      note({ gain: 0.05, hz: 300, lengthMs: 40, startMs: 0, wave: "triangle" }),
      note({ gain: 0.05, hz: 300, lengthMs: 40, startMs: 110, wave: "triangle" }),
    ],
    stalled: [{ fromHz: 180, gain: 0.045, lengthMs: 200, startMs: 0, toHz: 150, wave: "sine" }],
    thinking: [note({ gain: 0.045, hz: 220, lengthMs: 150, startMs: 0, wave: "sine" })],
    working: [
      note({ gain: 0.035, hz: 330, lengthMs: 60, startMs: 0, wave: "sine" }),
      note({ gain: 0.035, hz: 440, lengthMs: 60, startMs: 80, wave: "sine" }),
    ],
    writing: [
      note({ gain: 0.035, hz: 620, lengthMs: 45, startMs: 0, wave: "triangle" }),
      note({ gain: 0.035, hz: 760, lengthMs: 45, startMs: 70, wave: "triangle" }),
    ],
  },
  // One bell per kind of work, on a pentatonic scale so any two in a row sit well together; the stall is the lowest.
  glass: {
    browsing: bell({ hz: 784, startMs: 0 }),
    code: bell({ hz: 1047, startMs: 0 }),
    looking: [...bell({ hz: 523, startMs: 0 }), ...bell({ hz: 784, startMs: 0 }).slice(0, 1)],
    recalling: bell({ hz: 440, startMs: 0 }),
    relaying: [
      ...bell({ hz: 587, startMs: 0 }).slice(0, 1),
      note({ gain: 0.03, hz: 880, lengthMs: 120, startMs: 100, wave: "sine" }),
    ],
    slack: bell({ hz: 659, startMs: 0 }),
    stalled: bell({ hz: 262, startMs: 0 }),
    thinking: bell({ hz: 392, startMs: 0 }),
    working: bell({ hz: 330, startMs: 0 }),
    writing: bell({ hz: 880, startMs: 0 }),
  },
  // Count and pitch carry it: one low tick thinks, two rising ticks look, three high ticks read the code.
  taps: {
    browsing: [tick({ hz: 600, startMs: 0 }), tick({ hz: 800, startMs: 70 }), tick({ hz: 1000, startMs: 140 })],
    code: [tick({ hz: 1400, startMs: 0 }), tick({ hz: 1400, startMs: 50 }), tick({ hz: 1400, startMs: 100 })],
    looking: [tick({ hz: 700, startMs: 0 }), tick({ hz: 1000, startMs: 90 })],
    recalling: [tick({ hz: 800, startMs: 0 }), tick({ hz: 600, startMs: 90 })],
    relaying: [tick({ hz: 500, startMs: 0 }), tick({ hz: 750, startMs: 50 }), tick({ hz: 1100, startMs: 100 })],
    slack: [tick({ hz: 450, startMs: 0 }), tick({ hz: 450, startMs: 110 })],
    stalled: [tick({ hz: 220, startMs: 0 })],
    thinking: [tick({ hz: 400, startMs: 0 })],
    working: [tick({ hz: 600, startMs: 0 })],
    writing: [tick({ hz: 1000, startMs: 0 }), tick({ hz: 1000, startMs: 60 })],
  },
};

/**
 * The cue a badge sounds, if it has one.
 *
 * @param badge the badge the orb wears
 * @returns its cue, or `undefined` for no badge and for the error badge, which the drop cue speaks for
 */
export function cueOfBadge({ badge }: { badge: OrbBadge | undefined }): OrbCue | undefined {
  return ORB_CUES.find((cue) => cue === badge);
}

/** What the voice is doing at one instant, as far as a cue is concerned. */
export interface CueMoment {
  /**
   * Whether a badge may be announced now: a call is up and neither of them is talking, or the owner's sounds are off. Off
   * never holds a badge, talking or not — it is announced silently (the caller plays nothing), so turning sounds on
   * plays only the sample and never a backlog.
   */
  readonly audible: boolean;
  readonly badge: OrbBadge | undefined;
}

/** The moment a waiting sound is checked against: the voice, and the owner's pick as it stands. */
export interface CueNow {
  /** A call is up and neither of them is talking — whatever the owner's pick. */
  readonly quiet: boolean;
  readonly badge: OrbBadge | undefined;
  readonly setting: OrbCueSetting;
}

/**
 * Which still-due check a waiting cue failed, by name, so the call file can say why a sound the owner expected never played
 * (otherwise a call with no work sound and nothing on the record says which rule held them): somebody talking or no
 * call up, the badge moved on, the owner's pick changed, a newer progress event superseded it, or the work it described
 * had ended.
 */
export type CueStale = "not-quiet" | "badge-moved" | "sound-changed" | "superseded" | "work-ended";

/**
 * Why a cue decided a moment ago may no longer play now, at the instant it would be scheduled.
 *
 * @param cue the cue waiting to play
 * @param sound the sound it was decided in
 * @param now the voice and the owner's pick at this instant
 * @returns the first check it fails, or `undefined` while a sound may play, the owner still has this sound picked, and the
 *   orb still wears the badge this cue announces
 */
export function cueStaleReason({
  cue,
  sound,
  now,
}: {
  cue: OrbCue;
  sound: CueSound;
  now: CueNow;
}): CueStale | undefined {
  if (!now.quiet) {
    return "not-quiet";
  }
  if (now.setting !== sound) {
    return "sound-changed";
  }
  if (cueOfBadge({ badge: now.badge }) !== cue) {
    return "badge-moved";
  }
  return undefined;
}

/**
 * Whether a cue decided a moment ago may still play now, at the instant it would be scheduled.
 *
 * @param cue the cue waiting to play
 * @param sound the sound it was decided in
 * @param now the voice and the owner's pick at this instant
 * @returns true only while {@link cueStaleReason} names no failed check
 */
export function cueStillDue({ cue, sound, now }: { cue: OrbCue; sound: CueSound; now: CueNow }): boolean {
  return cueStaleReason({ cue, now, sound }) === undefined;
}

/**
 * Why a pick's sample may no longer play now. A sample is a cue like any other — never off a call, never over speech
 * — and a pick changed while it waited (to another sound, or off) drops it.
 *
 * @param sound the sound just picked
 * @param now the voice and the owner's pick at this instant
 * @returns the first check it fails, or `undefined` on a call, in quiet, while this is still the owner's pick
 */
export function sampleStaleReason({ sound, now }: { sound: CueSound; now: CueNow }): CueStale | undefined {
  if (!now.quiet) {
    return "not-quiet";
  }
  if (now.setting !== sound) {
    return "sound-changed";
  }
  return undefined;
}

/**
 * Whether a pick's sample may still play now.
 *
 * @param sound the sound just picked
 * @param now the voice and the owner's pick at this instant
 * @returns true only while {@link sampleStaleReason} names no failed check
 */
export function sampleStillDue({ sound, now }: { sound: CueSound; now: CueNow }): boolean {
  return sampleStaleReason({ now, sound }) === undefined;
}

/**
 * The cue a delegated turn's `progress` event plays (`PlanProgressEvent`, `./planCallContract.ts`): the plain working
 * sound, whatever the badge. It stands in for a spoken progress line: a subtle but distinct ding that shows the voice is
 * working on something.
 */
export const PROGRESS_CUE: OrbCue = "working";

/**
 * Whether a progress cue the server sent may still play now, at the instant it would be scheduled. Not a badge's cue:
 * it is due on the server's clock rather than on the orb changing, so the badge is not asked, and it is not throttled
 * by {@link OrbCuer} — the server already spaces them seconds apart.
 *
 * @param generation how many progress events the call has had by now
 * @param expected how many it had when this cue was sent, so a newer event (or a replayed one) supersedes it
 * @param workRunning whether a delegated turn still runs — a sound never says work goes on once it is over
 * @param sound the sound it was decided in
 * @param now the voice and the owner's pick at this instant
 * @returns the first check it fails, or `undefined` while this is the newest progress event, the work still runs,
 *   neither of them is talking, and the owner still has this sound picked
 */
export function progressCueStaleReason({
  generation,
  expected,
  workRunning,
  sound,
  now,
}: {
  generation: number;
  expected: number;
  workRunning: boolean;
  sound: CueSound;
  now: CueNow;
}): CueStale | undefined {
  if (generation !== expected) {
    return "superseded";
  }
  if (!workRunning) {
    return "work-ended";
  }
  return sampleStaleReason({ now, sound });
}

/**
 * Whether a progress cue the server sent may still play now.
 *
 * @param generation how many progress events the call has had by now
 * @param expected how many it had when this cue was sent
 * @param workRunning whether a delegated turn still runs
 * @param sound the sound it was decided in
 * @param now the voice and the owner's pick at this instant
 * @returns true only while {@link progressCueStaleReason} names no failed check
 */
export function progressCueStillDue({
  generation,
  expected,
  workRunning,
  sound,
  now,
}: {
  generation: number;
  expected: number;
  workRunning: boolean;
  sound: CueSound;
  now: CueNow;
}): boolean {
  return progressCueStaleReason({ expected, generation, now, sound, workRunning }) === undefined;
}

/**
 * A waiting sound's question, made one-way: its first answer is the speaker it plays on, and once any later answer
 * differs — not due, or another device — it is never due again. Without this a badge replaced over speech and then
 * worn again, or a pick set off and back, would revive a sound that had already ended.
 *
 * @param due the caller's live question: the speaker now, or `undefined` once the sound is not due
 * @returns the same question, latched
 */
export function latchDue({ due }: { due: () => string | undefined }): () => string | undefined {
  let first: string | undefined;
  let asked = false;
  let ended = false;
  return () => {
    if (ended) {
      return undefined;
    }
    const answer = due();
    if (!asked) {
      asked = true;
      first = answer;
    }
    if (answer === undefined || answer !== first) {
      ended = true;
      return undefined;
    }
    return answer;
  };
}

/**
 * What {@link OrbCuer} made of one moment, when it made anything: a cue to play; one consumed silently by the
 * {@link CUE_GAP_MS} or {@link CUE_REPEAT_MS} throttle; or a badge held over speech, said once per badge, so a badge
 * that came and went while somebody talked is on the record rather than simply never heard.
 */
export type CueDecision =
  | { readonly kind: "play"; readonly cue: OrbCue }
  | { readonly kind: "throttled"; readonly cue: OrbCue; readonly why: "gap" | "repeat" }
  | { readonly kind: "held"; readonly cue: OrbCue };

/**
 * One call's orb, heard: told the badge on every render, it answers with the cue to play, at most once per badge.
 * The clock is passed in, so a test drives it by hand.
 */
export class OrbCuer {
  /** The badge already announced — played, throttled away or silent by design — and so never announced again. */
  private announced: OrbBadge | undefined;
  /** The badge last reported held over speech, so a held badge is reported once rather than every render. */
  private held: OrbBadge | undefined;
  private lastCueAt: number | undefined;
  private readonly lastAt = new Map<OrbCue, number>();
  private readonly clock: () => number;

  constructor({ clock }: { clock: () => number }) {
    this.clock = clock;
  }

  /**
   * The orb wears this badge now; play what this returns.
   *
   * @param moment the live badge — never a preview's — and whether a sound may play now
   * @returns the cue to play now, or `undefined` for silence
   */
  observe({ moment }: { moment: CueMoment }): OrbCue | undefined {
    const decision = this.decide({ moment });
    if (decision?.kind !== "play") {
      return undefined;
    }
    return decision.cue;
  }

  /**
   * The orb wears this badge now: what became of it, when anything did.
   *
   * @param moment the live badge — never a preview's — and whether a sound may play now
   * @returns the cue to play, one throttled away, a badge newly held over speech, or `undefined` when nothing changed
   */
  decide({ moment }: { moment: CueMoment }): CueDecision | undefined {
    const { badge, audible } = moment;
    if (badge === undefined) {
      this.announced = undefined;
      this.held = undefined;
      return undefined;
    }
    if (badge === this.announced) {
      return undefined;
    }
    const cue = cueOfBadge({ badge });
    if (cue === undefined) {
      this.announced = badge;
      return undefined;
    }
    // Not announced, and not consumed: the first quiet moment still wearing it announces it.
    if (!audible) {
      if (this.held === badge) {
        return undefined;
      }
      this.held = badge;
      return { cue, kind: "held" };
    }
    this.announced = badge;
    this.held = undefined;
    const now = this.clock();
    if (this.lastCueAt !== undefined && now - this.lastCueAt < CUE_GAP_MS) {
      return { cue, kind: "throttled", why: "gap" };
    }
    const lastSame = this.lastAt.get(cue);
    if (lastSame !== undefined && now - lastSame < CUE_REPEAT_MS) {
      return { cue, kind: "throttled", why: "repeat" };
    }
    this.lastCueAt = now;
    this.lastAt.set(cue, now);
    return { cue, kind: "play" };
  }
}

/** The owner's pick: one of the sounds, or none at all. */
export type OrbCueSetting = CueSound | "off";

/** Sounds are on until the owner picks otherwise. */
export const DEFAULT_ORB_CUE_SETTING: OrbCueSetting = "chimes";

/** Where the owner's pick is kept, in this browser. */
export const ORB_CUE_STORAGE_KEY = "slopweaver.talk.cues";

/** The cue a newly picked sound plays as its sample on a call, so the owner hears the pick at once. */
export const CUE_SAMPLE: OrbCue = "looking";

/**
 * Whether a stored value is a cue setting.
 *
 * @returns true for `off` or one of {@link CUE_SOUNDS}
 */
export function isOrbCueSetting(value: unknown): value is OrbCueSetting {
  return value === "off" || CUE_SOUNDS.some((sound) => sound === value);
}
