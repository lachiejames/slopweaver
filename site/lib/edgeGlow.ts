/**
 * The glow round the window's edge: whether the owner's screen is shared, the moment the voice takes a frame of it,
 * and the voice speaking — in either view, so it is never only the stage that says so.
 *
 * Sharing a screen must be clear at a glance: a glow around the screen shows when the voice is seeing it, and again
 * when it is speaking. The screen edge pulses once as the voice takes a screenshot, and again with each new one.
 *
 * So three things, each answering one question at a glance:
 *
 * - **shared** — a steady border in the looking colour for as long as the share is open: it can see when asked;
 * - **a pulse** — one bright flash of that border per frame the voice takes, keyed by the `read_screen` call that took
 *   it; a relay carries a look's frame and never grabs its own, so it never pulses —
 *   in the desktop app too, where the voice looks with no share and so there is no steady border;
 * - **speaking** — a soft glow in the speaking colour breathing with the voice's own level.
 *
 * It is constant through every call, with no switch: the screen edge glow exposes no configurability option.
 *
 * Pure: `components/voice/EdgeGlow.tsx` draws it, or in the desktop app reports it to the shell's screen-edge strips
 * (`desktop/src/edgeGlowShell.ts`).
 */
import type { ScreenSight } from "./screenFrame";
import type { VoicePhase } from "./voiceActivity";
import type { HeardSegment } from "./voiceTranscript";

/** What the edge shows now. `off` draws nothing. */
export type EdgeGlowState = "off" | "shared" | "speaking" | "shared-speaking";

/**
 * What the window's edge shows.
 *
 * @param callActive whether a call is up — no call, no glow, even with a share left open
 * @param sharing whether the owner's screen is shared
 * @param phase what the session is doing
 * @returns the edge's state
 */
export function edgeGlowOf({
  callActive,
  sharing,
  phase,
}: {
  callActive: boolean;
  sharing: boolean;
  phase: VoicePhase;
}): EdgeGlowState {
  if (!callActive) {
    return "off";
  }
  const speaking = phase === "speaking";
  if (sharing && speaking) {
    return "shared-speaking";
  }
  if (sharing) {
    return "shared";
  }
  if (speaking) {
    return "speaking";
  }
  return "off";
}

/**
 * Whether the edge may flash a frame now. With a share, only while it draws the share's steady border. In the desktop
 * app the voice looks with no share at all (`screenFrame.ts` `ScreenSight`), so each frame still pulses whenever a
 * call is up, while no steady border ever claims a share the owner never opened.
 *
 * @param state what the edge shows now (`edgeGlowOf`)
 * @param sight how the voice sees the owner's screen
 * @param callActive whether a call is up
 * @returns whether a frame's pulse may be drawn
 */
export function framePulsesOn({
  state,
  sight,
  callActive,
}: {
  state: EdgeGlowState;
  sight: ScreenSight;
  callActive: boolean;
}): boolean {
  if (state === "shared" || state === "shared-speaking") {
    return true;
  }
  return sight === "native" && callActive;
}

/** One frame a look actually took: its tool call's token, and the owner's newest stretch of speech when the frame was in hand. */
export interface FrameTaken {
  readonly token: string;
  readonly after: string | undefined;
}

/**
 * The record of a frame just taken, made the moment `read_screen` has the frame in hand — never at the call's start,
 * and never off the activity line, which a newer tool may already have replaced.
 *
 * @param token the `read_screen` call that took it
 * @param segments the conversation at that moment
 * @returns the frame, as {@link framePulseKey} reads it
 */
export function frameTakenOf({ token, segments }: { token: string; segments: readonly HeardSegment[] }): FrameTaken {
  return { after: segments.findLast((segment) => segment.who === "owner")?.id, token };
}

/**
 * Which frame the edge pulses for: the latest frame a look took, until the owner speaks after it. A new call is a new key, so
 * each look pulses once; looks landing in one render share one flash, and one landing mid-flash restarts it (a queue
 * of flashes no eye could tell apart is not built). Keying on the frame itself means a refused look never pulses, a
 * look the owner talked over while it ran still does, and in the desktop app — whose voice is in the frame it takes — the flash lands after the picture,
 * so it never paints over what the voice was shown. The key names the frame whether or not the edge may
 * flash, so one taken while it may not is spent unseen (`pulseMove`) rather than flashed late; a frame gone stale (the owner
 * has spoken since it was taken) names no key at all.
 *
 * @param frame the latest frame a look took (`frameTakenOf`), or `undefined` before any this call
 * @param segments the conversation now, which says whether that frame is still the latest exchange's
 * @returns the pulse's key, or `undefined` when no frame has just been taken
 */
export function framePulseKey({
  frame,
  segments,
}: {
  frame: FrameTaken | undefined;
  segments: readonly HeardSegment[];
}): string | undefined {
  if (frame === undefined) {
    return undefined;
  }
  if (segments.findLast((segment) => segment.who === "owner")?.id !== frame.after) {
    return undefined;
  }
  return frame.token;
}

/**
 * What the edge does with a frame's pulse now. A key flashes once: it is spent as its flash STARTS, and a key that
 * arrives while the edge may not flash is spent unseen. The flash in flight keeps drawing until it ends, and is dropped
 * the moment the edge may no longer flash — so a new call, or reopening the share, never shows a frame late or a
 * second time, even one cut short mid-flash.
 *
 * @param pulses whether the edge may flash a frame now (`framePulsesOn`)
 * @param pulse the frame just taken (`framePulseKey`)
 * @param spent the last key that flashed or could not
 * @param flashing the key whose flash is in flight, if any
 * @returns whether to draw the flash, and whether to spend the key unseen or drop the flash in flight
 */
export function pulseMove({
  pulses,
  pulse,
  spent,
  flashing,
}: {
  pulses: boolean;
  pulse: string | undefined;
  spent: string | undefined;
  flashing: string | undefined;
}): { draw: boolean; spendUnseen: boolean; dropFlashing: boolean } {
  if (!pulses) {
    return { draw: false, dropFlashing: flashing !== undefined, spendUnseen: pulse !== undefined && pulse !== spent };
  }
  const draw = pulse !== undefined && (pulse !== spent || pulse === flashing);
  return { draw, dropFlashing: false, spendUnseen: false };
}
