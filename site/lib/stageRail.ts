/**
 * The voice stage's controls: which show, the word each one is named by, whether it is pressed, and WHERE it sits —
 * the call's own along a bar at the bottom, the way out alone in the top right corner. The stage draws each as an
 * icon with that word as its accessible name and its tooltip (`components/voice/StageControls.tsx`). Icons read better than
 * text — the word survives only where a reader of the screen or a hover asks for it.
 *
 * **The call's controls sit along the bottom; the corner stays top right.** Four buttons crammed into the top right
 * of a page with so much screen real estate are friction, where Meet and Zoom put theirs around the bottom — taken
 * as inspiration, never as definitive. The owner reaches for a big red end call button on the bottom with mute to the
 * left of it, and minimize stays so nobody feels stuck on full screen. So the bar is the microphone and speaker
 * chevron, mute, the screen and hang-up, and the corner is the one way out, where Zoom's own full screen puts its exit.
 * The call's trays lead the bar with their buttons in the corner card's order (`components/voice/StageControls.tsx`).
 *
 * **No settings on the stage.** Every preference is chosen in Settings and the stage only honours it: the stage has no settings cog, only
 * the mute, the end call and the move to corner. The chevron joined to mute opens the microphone and
 * speaker tray — device routing, not a preference.
 *
 * A `?stage=` preview has no call, so it draws the call's controls as a call shows them, INERT: the preview is how
 * the stage is photographed, and a bar missing its mute and hang-up is not the bar the owner sees. Two kinds stay live in
 * a preview: the corner, which closes it, and the trays' buttons, the chevron among them, which only change what is
 * drawn. The widget only previews while no call is up (`VoiceWidget.tsx`), so a live call's real controls always win.
 */
import type { ScreenSight } from "./screenFrame";

/** One call control, shared with the call card's bar (`messengerMode.ts`). */
export type StageRailId = "mute" | "screen" | "end" | "collapse";

/** One control as a call view draws it. */
export interface StageRailControl {
  readonly id: StageRailId;
  /** Its accessible name and its tooltip, which change with its state. */
  readonly word: string;
  /** Whether it is on: muted, or showing the screen. `undefined` for a control that is never pressed. */
  readonly pressed: boolean | undefined;
  /** Drawn for a preview, where pressing it reaches no call. */
  readonly inert: boolean;
}

/** One control on the stage, the microphone and speaker chevron included. */
export interface StageControl extends Omit<StageRailControl, "id"> {
  readonly id: StageRailId | "audio";
}

/** The stage's controls by where they sit. */
export interface StageControls {
  /** The bottom bar, left to right: the chevron joined to mute, the screen, then hang-up. */
  readonly bar: readonly StageControl[];
  /** The top right corner's one control, which moves the call to the corner or closes a preview. */
  readonly corner: StageRailControl;
}

/**
 * Hang-up's fill: a saturated red the same in both themes, white glyph on it. The theme's own `--a-danger` is a verdict
 * INK, a pale red in dark mode, and hang-up is a big red end call button; `stageRail.test.ts` measures white on
 * this fill on an sRGB screen and a Display P3 one.
 */
export const HANG_UP_FILL = "oklch(0.55 0.22 27)";

/**
 * The call's controls, left to right — the order the call card's bar takes them in too.
 *
 * @param hasLive whether the call has its live session, which is what mute acts on
 * @param callActive whether a call is up
 * @param muted whether the owner's microphone is muted
 * @param sharing what the owner's screen share is of, or `undefined` when they are not sharing
 * @param screenSight how the voice sees the owner's screen: a browser share, or the desktop app looking natively
 * @param preview whether this is a `?stage=` preview with no call up
 * @returns the controls in the order they are drawn
 */
export function stageRailOf({
  hasLive,
  callActive,
  muted,
  sharing,
  screenSight,
  preview,
}: {
  hasLive: boolean;
  callActive: boolean;
  muted: boolean;
  sharing: string | undefined;
  screenSight: ScreenSight;
  preview: boolean;
}): readonly StageRailControl[] {
  const controls: StageRailControl[] = [];
  if (hasLive || preview) {
    controls.push({ id: "mute", inert: preview, pressed: muted, word: muted ? "unmute" : "mute" });
  }
  const showsScreen = sharing !== undefined || screenSight !== "native";
  if ((callActive || preview) && showsScreen) {
    const shown = sharing !== undefined;
    controls.push({
      id: "screen",
      inert: preview,
      pressed: shown,
      word: shown ? "stop showing screen" : "look at my screen",
    });
  }
  if (callActive || preview) {
    controls.push({ id: "end", inert: preview, pressed: undefined, word: "hang up" });
  }
  controls.push({
    id: "collapse",
    inert: false,
    pressed: undefined,
    word: preview ? "close preview" : "move to the corner",
  });
  return controls;
}

/**
 * The stage's controls by where they sit: the call's along the bottom, led by the microphone and speaker chevron
 * whenever any call control shows, and the way out in the corner.
 *
 * @param hasLive whether the call has its live session, which is what mute acts on
 * @param callActive whether a call is up
 * @param muted whether the owner's microphone is muted
 * @param sharing what the owner's screen share is of, or `undefined` when they are not sharing
 * @param screenSight how the voice sees the owner's screen: a browser share, or the desktop app looking natively
 * @param preview whether this is a `?stage=` preview with no call up
 * @returns the bar's controls in the order they are drawn, and the corner's one
 */
export function stageControlsOf({
  hasLive,
  callActive,
  muted,
  sharing,
  screenSight,
  preview,
}: {
  hasLive: boolean;
  callActive: boolean;
  muted: boolean;
  sharing: string | undefined;
  screenSight: ScreenSight;
  preview: boolean;
}): StageControls {
  const rail = stageRailOf({ callActive, hasLive, muted, preview, screenSight, sharing });
  const call = rail.filter((control) => control.id !== "collapse");
  const corner = rail.find((control) => control.id === "collapse")!;
  if (call.length === 0) {
    return { bar: [], corner };
  }
  const audio: StageControl = { id: "audio", inert: false, pressed: undefined, word: "microphone and speaker" };
  return { bar: [audio, ...call], corner };
}
