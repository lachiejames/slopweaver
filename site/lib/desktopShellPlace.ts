/**
 * The orb's-place half of the desktop shell's bridge (`desktopShell.ts`): the voice's window reports where the owner
 * dragged its orb and the box it draws there, and the shell crops its window round that box and says back where the
 * work area sits in the window it chose (the orb is draggable, and nothing is ever off
 * screen). The shell's half of this shape is `desktop/src/desktopBridge.ts` `OverlayPlaceReport` — a separate project,
 * so each side states it and the shell parses it strictly. Pure.
 */
import { isRecord } from "./desktopShellWire";
import type { MessengerAnchor, MessengerFrame, OverlayHome, OverlayOrigin } from "./messengerPlace";

/**
 * What the voice's page reports of its orb's place: the place, `null` for where it has always rested (the shell then
 * fits its corner exactly as before); the frame the widget draws there; and whether the orb is being dragged, which
 * gives the drag the work area and holds the pointer until it lets go.
 */
export interface OverlayPlaceReport {
  readonly anchor: MessengerAnchor | null;
  readonly frame: MessengerFrame;
  readonly manipulating: boolean;
}

/**
 * The bridge's place methods, optional together: under an older shell the orb rests where it always has and offers no
 * drag, since that shell neither moves its window to a place nor says where the work area sits in it.
 */
export interface PlaceBridge {
  /** The voice's window only: the orb's place and the frame round it. Main refuses it from the console window. */
  readonly reportOverlayPlace?: (input: { readonly report: OverlayPlaceReport }) => void;
  /** The voice's window: where the work area's right and bottom edges sit in from the window's, sent beside every fit. */
  readonly onOverlayOrigin?: (listener: (origin: unknown) => void) => () => void;
  /**
   * The voice's window: where the orb rests with no place of its own, sent beside every fit, so a drag can bring it
   * back down level with a Dock below the work area. Absent from a shell from before it, which keeps a drag inside the
   * work area and refuses a place below it.
   */
  readonly onOverlayHome?: (listener: (home: unknown) => void) => () => void;
}

/** The {@link PlaceBridge} methods, for the bridge's check that each is absent or a function. */
export const PLACE_OPTIONAL_METHODS = ["reportOverlayPlace", "onOverlayOrigin", "onOverlayHome"] as const;

/** How the voice's widget hands its place to the shell and hears the shell's word back (`VoiceShellControl.place`). */
export interface OverlayPlaceLink {
  readonly report: (report: OverlayPlaceReport) => void;
  readonly onOrigin: (listener: (origin: OverlayOrigin) => void) => () => void;
  /** Where the orb rests with no place of its own; `undefined` under a shell that does not say. */
  readonly onHome: ((listener: (home: OverlayHome) => void) => () => void) | undefined;
}

/**
 * The shell's home word, read strictly: exactly the one edge, a finite distance in bounds, either sign — negative
 * where the orb rests level with a Dock below the work area.
 *
 * @param value what the shell sent
 * @returns the home, or `undefined` when it is not exactly one
 */
export function overlayHomeOf({ value }: { value: unknown }): OverlayHome | undefined {
  if (!isRecord(value) || Array.isArray(value) || Object.keys(value).length !== 1) {
    return undefined;
  }
  const { bottom } = value;
  if (typeof bottom !== "number" || !Number.isFinite(bottom) || Math.abs(bottom) > ORIGIN_CEILING_PX) {
    return undefined;
  }
  return { bottom };
}

/** The farthest the work area's edge may sit from the window's, CSS pixels — past any display; a bigger one is corrupt. */
const ORIGIN_CEILING_PX = 16_384;

/**
 * The shell's origin word, read strictly: exactly the two edges, each a finite distance in bounds, either sign — the
 * work area's edge inside a window larger than it is positive, a window cropped inside the work area negative.
 *
 * @param value what the shell sent
 * @returns the origin, or `undefined` when it is not exactly one
 */
export function overlayOriginOf({ value }: { value: unknown }): OverlayOrigin | undefined {
  if (!isRecord(value) || Array.isArray(value) || Object.keys(value).length !== 2) {
    return undefined;
  }
  const { bottom, right } = value;
  const edge = (side: unknown): side is number =>
    typeof side === "number" && Number.isFinite(side) && Math.abs(side) <= ORIGIN_CEILING_PX;
  if (!edge(bottom) || !edge(right)) {
    return undefined;
  }
  return { bottom, right };
}
