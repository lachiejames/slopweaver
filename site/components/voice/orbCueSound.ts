"use client";

/**
 * The browser half of the orb's sound: plays one cue's tones (`site/lib/orbCue.ts`) — or a herald's
 * (`site/lib/announceCue.ts`), through the same queue — through the speaker the voice is on. Which tones, and when,
 * is decided there; nothing here chooses, and nothing here asks whether anybody is talking: that is the caller's `due`.
 *
 * - **One context for the page**, made at the first cue and kept: the call's own `AudioContext` only feeds the level
 *   meters and is closed by every hang-up, and a context per cue would be a fresh device open for every chime.
 * - **The voice's speaker, or silence.** The cue follows the sink the voice's own element reports
 *   (`useAudioRoute.ts`). A browser that cannot route a context to that device, or refuses the route, plays nothing:
 *   a chime from the laptop while the voice is in the owner's headset would be a sound from the wrong room.
 * - **Still due, or not at all.** Routing and waking the context are asynchronous, so the caller is asked again at
 *   the instant the notes are scheduled; a cue whose call ended, whose badge moved on, that somebody started talking
 *   over, or whose speaker changed while it waited is dropped, never played late. A cue already sounding is asked
 *   again on every commit ({@link recheckOrbCue}) and faded out mid-note if the answer changed. What this does
 *   NOT close: the notes are handed to the audio thread up front, so one due to start in the instant between React
 *   committing a new phase and the layout effect that rechecks can still start, and its fade runs from the recheck.
 *   Same task, normally well under a millisecond; only scheduling each note just in time from the main thread would
 *   close it, at the cost of every note's timing.
 * - **One cue at a time.** The next cue routes only once the last one's notes have ended, so a switch of speaker
 *   never carries a cue's tail to a device it was not played for.
 * - **Best effort.** A cue is optional; nothing it fails on reaches the call.
 * - **Every cue says what became of it.** The caller's `report` hears played, dropped (before or after routing),
 *   unroutable or refused, exactly once, plus faded after played when a sounding cue is cut short, so a cue the owner never
 *   heard leaves its reason on the call file (`site/lib/cueTrace.ts`) rather than a silence nobody can read back.
 */
import type { CueSoundOutcome } from "../../lib/cueTrace";
import { latchDue, type Tone } from "../../lib/orbCue";

/** A context that can be pointed at a device — Chrome's, which the DOM types do not carry yet. */
interface RoutableContext {
  readonly sinkId: string | object;
  setSinkId: (sinkId: string) => Promise<void>;
}

/** The attack every tone opens with, so a note never clicks in. */
const ATTACK_S = 0.01;

/** How fast a cue that stopped being due fades to nothing — quick, but never a click. */
const FADE_S = 0.02;

/** Slack past a cue's last note before the next one may re-route the context under it. */
const SETTLE_MS = 30;

/** The page's one cue context, once a cue has made it. */
let shared: AudioContext | undefined;

/** The route-and-play chain: each cue routes after the one before it, so two switches never land out of order. */
let chain: Promise<void> = Promise.resolve();

/** Whether this browser can point a context at a device. */
function isRoutable(context: AudioContext): context is AudioContext & RoutableContext {
  return "setSinkId" in context && typeof context.setSinkId === "function";
}

/** The page's cue context, made on first use; `undefined` where the browser refuses one. */
function contextNow(): AudioContext | undefined {
  if (shared !== undefined) {
    return shared;
  }
  try {
    shared = new AudioContext();
  } catch {
    return undefined;
  }
  return shared;
}

/**
 * Point the context at the voice's speaker.
 *
 * @returns whether it now plays there — false where a non-default device cannot be reached
 */
async function routed({ context, sinkId }: { context: AudioContext; sinkId: string }): Promise<boolean> {
  if (!isRoutable(context)) {
    return sinkId === "";
  }
  if (context.sinkId === sinkId) {
    return true;
  }
  await context.setSinkId(sinkId);
  return true;
}

/** A cue's notes once scheduled: what to fade if it stops being due, and how long it runs. */
interface Scheduled {
  readonly notes: readonly { readonly oscillator: OscillatorNode; readonly gain: GainNode; readonly startS: number }[];
  readonly lengthMs: number;
}

/**
 * Schedule one cue's tones on a context already routed and running.
 *
 * @returns its nodes, and how long it runs
 */
function schedule({ context, tones }: { context: AudioContext; tones: readonly Tone[] }): Scheduled {
  const at = context.currentTime;
  const notes: Scheduled["notes"][number][] = [];
  for (const tone of tones) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = at + tone.startMs / 1000;
    const end = start + tone.lengthMs / 1000;
    oscillator.type = tone.wave;
    oscillator.frequency.setValueAtTime(tone.fromHz, start);
    oscillator.frequency.linearRampToValueAtTime(tone.toHz, end);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(tone.gain, start + ATTACK_S);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end);
    notes.push({ gain, oscillator, startS: start });
  }
  const lengthMs = Math.max(...tones.map((tone) => tone.startMs + tone.lengthMs));
  return { lengthMs, notes };
}

/** The cue sounding now: its notes, the question it was played on and its answer then, and how to end its wait. */
interface Sounding {
  readonly context: AudioContext;
  readonly notes: Scheduled;
  readonly due: () => string | undefined;
  readonly sinkId: string;
  readonly finish: () => void;
  readonly report: CueRequest["report"];
}

/** The cue whose notes are still scheduled or ringing, if any. */
let sounding: Sounding | undefined;

/** The latched `due` of every cue queued or routing, not yet sounding or dropped. */
const waiting = new Set<() => string | undefined>();

/**
 * End a cue now: a note not started yet never starts, and one ringing fades out within {@link FADE_S} — a cut
 * mid-wave would click.
 */
function hush({ context, notes }: Sounding): void {
  const at = context.currentTime;
  for (const { oscillator, gain, startS } of notes.notes) {
    const pending = startS > at;
    gain.gain.cancelScheduledValues(at);
    try {
      if (pending) {
        gain.gain.setValueAtTime(0, at);
        oscillator.stop(at);
      } else {
        gain.gain.setValueAtTime(gain.gain.value, at);
        gain.gain.linearRampToValueAtTime(0, at + FADE_S);
        oscillator.stop(at + FADE_S);
      }
    } catch {
      // A note already stopped has nothing left to cut.
    }
  }
}

/**
 * Ask the cue sounding now whether it is still due, and fade it out if not: its later notes would otherwise ring on
 * after somebody started talking, the call ended, the pick went off or the speaker changed. Called on every commit.
 */
export function recheckOrbCue(): void {
  // A cue still waiting is asked too, so a moment that passes and comes back while it routes has still ended it.
  for (const ask of waiting) {
    ask();
  }
  const now = sounding;
  if (now === undefined || now.due() === now.sinkId) {
    return;
  }
  sounding = undefined;
  hush(now);
  setTimeout(now.finish, FADE_S * 1000 + SETTLE_MS);
  // Told only once its release is armed, so the trace never holds up the next cue.
  now.report({ outcome: { kind: "faded" } });
}

/** What playing one cue needs: its notes, and the question asked again at the instant they would be scheduled. */
interface CueRequest {
  /** The notes: an orb cue's in the owner's picked sound (`CUE_TONES`), or a herald's (`ANNOUNCE_TONES`). */
  readonly tones: readonly Tone[];
  /**
   * The device the voice plays on NOW, or `undefined` once this cue is no longer due — asked before routing and
   * again after, since a route or a wake can take long enough for the call to end, a voice to start, the badge to
   * move on or the speaker to change.
   */
  readonly due: () => string | undefined;
  /** Told once what became of this cue — played, dropped and where, or faded — for the call file (`cueTrace.ts`). */
  readonly report: (input: { readonly outcome: CueSoundOutcome }) => void;
}

/**
 * Play one cue through the voice's speaker, after any cue still routing, if it is still due when its turn comes.
 *
 * @param tones the notes to play
 * @param due the sink the voice is on now — empty for the system default — or `undefined` once the cue is stale
 * @param report told once what became of it
 */
export function playOrbCue({ tones, due, report }: CueRequest): void {
  const once = latchDue({ due });
  waiting.add(once);
  // A trace is best effort like the cue: one that throws costs its line, never the chain every later cue rides.
  const tell: CueRequest["report"] = (input) => {
    try {
      report(input);
    } catch {
      // The line is lost; the cue and the chain are not.
    }
  };
  chain = chain.then(() => routeAndPlay({ due: once, report: tell, tones }));
}

/** Route the page's context to the voice's speaker, wake it, and play one cue; any refusal costs only this cue. */
async function routeAndPlay({ tones, due, report }: CueRequest): Promise<void> {
  const sinkId = due();
  const context = contextNow();
  if (sinkId === undefined) {
    waiting.delete(due);
    report({ outcome: { at: "before-routing", kind: "stale" } });
    return;
  }
  if (context === undefined) {
    waiting.delete(due);
    report({ outcome: { kind: "refused", why: "no AudioContext could be made" } });
    return;
  }
  try {
    if (!(await routed({ context, sinkId }))) {
      report({ outcome: { kind: "unroutable" } });
      return;
    }
    if (context.state === "suspended") {
      await context.resume();
    }
    // Synchronous from here to the last note scheduled, so nothing can change between this answer and the sound.
    if (due() !== sinkId) {
      report({ outcome: { at: "after-routing", kind: "stale" } });
      return;
    }
    waiting.delete(due);
    const notes = schedule({ context, tones });
    // The chain waits for the last note, so the next cue never re-routes the context under one still ringing.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(finish, notes.lengthMs + SETTLE_MS);
      function finish(): void {
        clearTimeout(timer);
        if (sounding?.notes === notes) {
          sounding = undefined;
        }
        resolve();
      }
      sounding = { context, due, finish, notes, report, sinkId };
      report({ outcome: { kind: "played" } });
    });
  } catch (error: unknown) {
    // A refused route or resume costs this cue, never the call.
    // Read under its own guard: a throw from reading it here would reject the chain and silence every later cue.
    let why = "the route or wake threw something other than an Error";
    try {
      if (error instanceof Error) {
        why = error.message;
      }
    } catch {
      // Its message could not be read; the fixed phrase stands.
    }
    report({ outcome: { kind: "refused", why } });
  } finally {
    waiting.delete(due);
  }
}
