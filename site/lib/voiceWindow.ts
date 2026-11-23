/**
 * The voice's window state: the orb alone, the middle (the call card with Messenger open over the orb), or full screen
 * (the stage). The app opens in the MIDDLE state, there is no mini bar and no button to show or hide Messenger, the
 * state is STICKY — whichever of the three the owner left it in holds across calls and restarts — and a call starting
 * never goes full screen on its own.
 *
 * So the state is the owner's preference, kept in this browser like every other voice preference, and only the owner's
 * own moves write it: the orb, the card's close and full screen, Escape, Alt+V, the stage's collapse and the tray menu.
 * Two things show the orb alone for a while without writing it, and each lets go by itself:
 *
 * - **A click into another app folds it** (a tap elsewhere is how the owner asks to close it) — the middle only with
 *   no call up, since on a call focus moves on its own and the card stays; the stage always. The fold is held until
 *   the owner's next move, and a press on the orb brings back the state they left, full screen included. A click into
 *   Slopweaver's own console window is not a click elsewhere, and the shell sends nothing for it
 *   (`desktop/src/overlayWindow.ts`, `overlayCommandOnBlur`), so that click never folds the window.
 * - **A region of the owner's screen lifted on their ask** shows the orb alone while the frame is up, because the card
 *   or the stage would cover it.
 *
 * Pure.
 */
import type { VoiceView } from "./voiceStage";

/** Where the voice is drawn: the orb alone, the call card over it, or the stage. */
export type VoiceWindowState = "minimised" | "middle" | "fullscreen";

/** Where the voice opens before the owner has moved it: the middle. */
export const DEFAULT_VOICE_WINDOW_STATE: VoiceWindowState = "middle";

/** Where the owner's window state is kept, in this browser. */
export const VOICE_WINDOW_STORAGE_KEY = "slopweaver.talk.windowState";

/**
 * Whether a value is a window state the preference can hold.
 *
 * @returns true for `minimised`, `middle` or `fullscreen`
 */
export function isVoiceWindowState(value: unknown): value is VoiceWindowState {
  return value === "minimised" || value === "middle" || value === "fullscreen";
}

/**
 * The state drawn now: the owner's stored one, unless a fold or a lifted region of their screen shows the orb alone for
 * now.
 *
 * @param stored the state the owner left it in
 * @param folded a click into another app folded it, and the owner has not moved since
 * @param focusLit a region of the owner's screen is lifted on their ask
 * @returns the state to draw
 */
export function voiceWindowShown({
  stored,
  folded,
  focusLit,
}: {
  stored: VoiceWindowState;
  folded: boolean;
  focusLit: boolean;
}): VoiceWindowState {
  if (folded || focusLit) {
    return "minimised";
  }
  return stored;
}

/**
 * The state a press on the orb leaves stored: from the orb alone, the state the owner left it in when that was a fold,
 * else the middle; from the card or the stage, the orb alone.
 *
 * @param stored the state the owner left it in
 * @param shown the state drawn as the owner pressed it
 * @returns the state to store, which the caller draws with the fold let go
 */
export function voiceWindowOnOrb({
  stored,
  shown,
}: {
  stored: VoiceWindowState;
  shown: VoiceWindowState;
}): VoiceWindowState {
  if (shown !== "minimised") {
    return "minimised";
  }
  if (stored === "minimised") {
    return "middle";
  }
  return stored;
}

/**
 * The view a window state is drawn in, for the shell's sizing (`overlayModeOf`): full screen is the stage, the rest the
 * corner.
 *
 * @param shown the state drawn now
 * @returns the view
 */
export function voiceViewOf({ shown }: { shown: VoiceWindowState }): VoiceView {
  if (shown === "fullscreen") {
    return "stage";
  }
  return "corner";
}

/**
 * Which of the voice window's surfaces may draw at the shell's current extent. The card lives in the corner, which the
 * shell grows to the card's measured height, so it draws whenever the window is in the middle and never waits on the
 * whole display; the stage, a screen focus and a page-drawn edge glow span the display and wait for the shell's word
 * that the window covers it (an open card stays in the corner, and a card waiting on `covers` would never draw).
 *
 * @param shown the window state drawn now
 * @param staged the stage, or a preview of it, is asked for
 * @param covers the shell has answered that the window is the whole display for the newest ask
 * @returns whether the card draws, whether the stage draws, and whether a display-spanning surface may draw
 */
export function voiceWindowDrawing({
  covers,
  shown,
  staged,
}: {
  covers: boolean;
  shown: VoiceWindowState;
  staged: boolean;
}): { readonly cardDrawn: boolean; readonly stageDrawn: boolean; readonly wholeReady: boolean } {
  return { cardDrawn: shown === "middle", stageDrawn: staged && covers, wholeReady: covers };
}
