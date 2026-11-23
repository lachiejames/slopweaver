/**
 * The sound a console call makes when it drops. A call can hit the console's own 90-minute cap mid-conversation while
 * the owner is not looking at the computer, and they would not realise until they looked.
 *
 * A drop is a call that had gone LIVE ending with a reason while the owner had not asked it to end. Their hang-up, the
 * page being left or reloaded, and a start that never reached live are all silent: they were looking, or there was no
 * call. The reason itself is already on the widget (`VoiceProvider`'s `failure`); this is the half that reaches the
 * owner when they are not looking. A drop also reconnects on its own (`./callReconnect.ts`, the same predicate), so
 * this is the "dropped" sound, {@link playCallConnectingCue} the quiet "connecting" one repeating until the call is
 * back, and {@link playCallBackCue} the "back" one. The three sounds differ from one another, and the connecting one
 * repeats until it succeeds. Sounds stand in for a spoken "connection lost", so all three are tones.
 *
 * The drop sounds the moment the link is read lost (`./callLink.ts`), before the call is ended, so a loss
 * plays it once and the end that follows it stays silent.
 *
 * The decision is pure; the tone is synthesised on a fresh `AudioContext`, because the call's own is closed by the
 * same `stop` that decides to play it, and so needs no asset file.
 */

/**
 * Whether a call ending now is a drop the owner should hear.
 *
 * @param why the reason the call is ending, `undefined` for an end the owner or the page asked for
 * @param wasLive whether this call had reached live — a start that failed before it never had a call to drop
 * @param ownerEnding whether the owner had already pressed end on it, so a reason racing their press is still their end
 * @returns `true` only for a live call ending with a reason the owner did not ask for
 */
export function shouldPlayCallDropCue({
  why,
  wasLive,
  ownerEnding,
}: {
  why: string | undefined;
  wasLive: boolean;
  ownerEnding: boolean;
}): boolean {
  return wasLive && why !== undefined && !ownerEnding;
}

/**
 * One page's drop cue across its calls: told when a call goes live, when its link is lost or back, and when one ends,
 * it plays at most once per loss. `ended` forgets the call, so a second `stop` of the same one — a teardown's own close
 * event — stays silent, and so does the end of a call whose loss already sounded.
 */
export class CallDropCue {
  private live = false;
  private sounded = false;
  private readonly play: () => void;

  constructor({ play }: { play: () => void }) {
    this.play = play;
  }

  /** The current call reached live. */
  wentLive(): void {
    this.live = true;
    this.sounded = false;
  }

  /** The live call's link was read lost (`./callLink.ts`): sound now, once, while the call is still held. */
  lost(): void {
    if (this.live && !this.sounded) {
      this.sounded = true;
      this.play();
    }
  }

  /** The live call's link came back inside its heal window, so a later loss sounds again. */
  healed(): void {
    this.sounded = false;
  }

  /**
   * The current call is ending; sound if it is a drop whose loss has not already sounded.
   *
   * @param why the reason it is ending, `undefined` for an end the owner or the page asked for
   * @param ownerEnding whether the owner had already pressed end on it
   * @returns whether it was a drop, sounded now or at its loss — which is also what reconnects it
   *   (`./callReconnect.ts`)
   */
  ended({ why, ownerEnding }: { why: string | undefined; ownerEnding: boolean }): boolean {
    const wasLive = this.live;
    const sounded = this.sounded;
    this.live = false;
    this.sounded = false;
    const dropped = shouldPlayCallDropCue({ ownerEnding, wasLive, why });
    if (dropped && !sounded) {
      this.play();
    }
    return dropped;
  }
}

/**
 * One layer of a cue: a glide from one pitch to another, its gain a fraction of the cue's peak, rising over `attackS`
 * and gone over the last `releaseS` of its length.
 */
export interface CallCueTone {
  readonly attackS: number;
  readonly fromHz: number;
  readonly gain: number;
  readonly lengthS: number;
  readonly releaseS: number;
  readonly startS: number;
  readonly toHz: number;
  readonly waveform: OscillatorType;
}

/**
 * The drop: a line cutting out, not a doorbell, in the manner of a Messenger-style cut-out sound. So a bright glide falls and is clipped off in 8ms while a lower body falls under its
 * start, two overlapping layers rather than two notes in turn.
 */
const DROP_TONES = [
  { attackS: 0.012, fromHz: 780, gain: 1, lengthS: 0.28, releaseS: 0.008, startS: 0, toHz: 310, waveform: "triangle" },
  { attackS: 0.01, fromHz: 330, gain: 0.55, lengthS: 0.12, releaseS: 0.05, startS: 0.04, toHz: 190, waveform: "sine" },
] as const satisfies readonly [CallCueTone, CallCueTone];

/**
 * The back cue: the drop's glides played upward, the bright one resolving softly rather than cut, so the two read as
 * one pair — gone, then back. Like Messenger, a noise when it
 * drops and waits, and another when it reconnects so talking can resume (`./callReconnect.ts`).
 */
const BACK_TONES = [
  { attackS: 0.012, fromHz: 310, gain: 1, lengthS: 0.28, releaseS: 0.06, startS: 0, toHz: 780, waveform: "triangle" },
  { attackS: 0.01, fromHz: 190, gain: 0.55, lengthS: 0.12, releaseS: 0.05, startS: 0, toHz: 330, waveform: "sine" },
] as const satisfies readonly [CallCueTone, CallCueTone];

/**
 * The connecting cue: two short soft pips at one pitch, neither falling like the drop nor rising like the back, and
 * quieter than both — the steady "still trying" of a call app searching for its line, repeated until the call is back
 * ({@link CONNECTING_CUE_EVERY_MS}).
 */
const CONNECTING_TONES = [
  { attackS: 0.008, fromHz: 523, gain: 0.45, lengthS: 0.07, releaseS: 0.04, startS: 0, toHz: 523, waveform: "sine" },
  { attackS: 0.008, fromHz: 523, gain: 0.45, lengthS: 0.07, releaseS: 0.04, startS: 0.16, toHz: 523, waveform: "sine" },
] as const satisfies readonly [CallCueTone, CallCueTone];

/** How often the connecting cue repeats while the call is lost or reconnecting. A judgement: present, not nagging. */
export const CONNECTING_CUE_EVERY_MS = 2_500;

/** When the first connecting cue plays after the call is lost: once the drop cue has finished. */
export const CONNECTING_CUE_FIRST_MS = 1_200;

/**
 * A cue's layers.
 *
 * @param kind `drop` for a live call cutting out, `connecting` for one still coming back, `back` for a reconnected one
 *   live again
 * @returns its two layers, in the order they start
 */
export function callCueTones({ kind }: { kind: "drop" | "connecting" | "back" }): readonly [CallCueTone, CallCueTone] {
  if (kind === "drop") {
    return DROP_TONES;
  }
  if (kind === "connecting") {
    return CONNECTING_TONES;
  }
  return BACK_TONES;
}

/** The cue's peak gain: audible over a quiet room, well under the voice's own level. */
const CUE_GAIN = 0.18;

/** The low-pass every layer passes through, so the triangle's edge reads as a soft blip rather than a buzz. */
const CUE_LOWPASS_HZ = 1800;

/**
 * Play the drop cue once, on a context of its own that closes itself afterwards. Best effort: a browser with no
 * audio device, or one refusing a context, loses the sound and never the teardown that called it.
 */
export function playCallDropCue(): void {
  playTones({ tones: callCueTones({ kind: "drop" }) });
}

/** Play the connecting cue once — the call is lost and still coming back. Best effort, as the drop cue. */
export function playCallConnectingCue(): void {
  playTones({ tones: callCueTones({ kind: "connecting" }) });
}

/** Play the back cue once — a dropped call the console reconnected has gone live again. Best effort, as the drop cue. */
export function playCallBackCue(): void {
  playTones({ tones: callCueTones({ kind: "back" }) });
}

/** Play a cue's layers through one low-pass, on a context of their own that closes itself after the last. */
function playTones({ tones }: { tones: readonly [CallCueTone, CallCueTone] }): void {
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch {
    return;
  }
  try {
    const at = context.currentTime;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = CUE_LOWPASS_HZ;
    filter.connect(context.destination);
    for (const tone of tones) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = tone.waveform;
      const start = at + tone.startS;
      const end = start + tone.lengthS;
      const peak = CUE_GAIN * tone.gain;
      oscillator.frequency.setValueAtTime(tone.fromHz, start);
      oscillator.frequency.exponentialRampToValueAtTime(tone.toHz, end);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peak, start + tone.attackS);
      gain.gain.setValueAtTime(peak, end - tone.releaseS);
      gain.gain.linearRampToValueAtTime(0, end);
      oscillator.connect(gain).connect(filter);
      oscillator.start(start);
      oscillator.stop(end);
    }
    // A context created outside a gesture can start suspended; the call's own press earlier usually unlocks it.
    void context.resume().catch(() => undefined);
    const totalMs = Math.max(...tones.map((tone) => tone.startS + tone.lengthS)) * 1000 + 250;
    window.setTimeout(() => {
      void context.close().catch(() => undefined);
    }, totalMs);
  } catch {
    void context.close().catch(() => undefined);
  }
}
