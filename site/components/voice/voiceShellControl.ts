/**
 * The desktop shell's control over the voice widget (`VoiceWidget.tsx`), as `DesktopVoiceOverlay.tsx` builds it from
 * the shell's bridge: its own module, so the contract between the shell and the widget reads in one place.
 */
import type { OverlayGlowLink } from "../../lib/desktopShellGlow";
import type { OverlayShellCommand, OverlayStatus } from "../../lib/desktopShellOverlay";
import type { OverlayPlaceLink } from "../../lib/desktopShellPlace";
import type { OverlayExtentLink } from "./useOverlayExtent";

/**
 * How the desktop shell drives the widget when it is drawn over the owner's desktop (`DesktopVoiceOverlay.tsx`): the tray's
 * and the console window's commands come in, and the view goes out so the shell can size its glass and pass clicks
 * through. Commands enter the same view reducer the owner's own gestures do, so the shell never keeps a second one.
 */
export interface VoiceShellControl {
  readonly onCommand: (listener: (command: OverlayShellCommand) => void) => () => void;
  readonly onStatus: (status: OverlayStatus) => void;
  /** Take the owner's keyboard as the orb's options open, so a click into another app folds them; absent under an older shell. */
  readonly focus?: () => void;
  /**
   * Take the overlay off the owner's screen while the call runs on, from the X on the orb; the menu bar's Show voice brings it
   * back. Absent under an older shell, whose orb draws no X.
   */
  readonly hide?: () => void;
  /** How much of the work area the widget needs drawn, and the shell's word back (`useOverlayExtent`); absent under a
   * shell from before it. */
  readonly extent?: OverlayExtentLink;
  /** The shell draws the edge glow along the display's edges, so the window keeps its corner; absent under an older one. */
  readonly glow?: OverlayGlowLink;
  /** The shell moves its window to where the owner dragged the orb (`useMessengerPlace`); absent under an older one. */
  readonly place?: OverlayPlaceLink;
}
