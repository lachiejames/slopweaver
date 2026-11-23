/*
 * The voice provider's place in the desktop shell. Its own file so `./VoiceProvider.tsx` stays under the line cap.
 */
import type { DesktopBridge, DesktopPageIdentity } from "../../lib/desktopShell";
import type { OverlayCall } from "../../lib/overlayCrashRecovery";
import type { TriageClockReport, TriageCommand } from "../../lib/triageBridge";
import type { VoiceStartRoute } from "../../lib/voiceStart";
import type { VoiceFailureReport } from "./failureNotice";
import type { DesktopCardMove } from "./useOpenCardSeams";

/**
 * Where the provider sits in the desktop shell (`site/lib/desktopShell.ts`), which draws the console in two
 * windows and runs the call in only one of them. Absent in a browser, which keeps the voice's record and settings
 * and starts no call (`site/lib/voiceStart.ts`).
 */
export interface DesktopVoiceSeam {
  /** The voice's window: the console page the owner is on, from the other window, in place of its own `/voice`. */
  readonly pageIdentity?: DesktopPageIdentity;
  /** The console window: hand each page as the voice would see it to the voice's window. */
  readonly publishPage?: (identity: DesktopPageIdentity) => void;
  /**
   * The console window: the shell carries the page's reading (`DesktopBridge.carriesPageReading`), so each page
   * handed over carries what its `read_page` would answer. Absent under an older shell, which is handed none.
   */
  readonly carriesPageReading?: boolean;
  /**
   * Where a start goes: run here in the voice's window, handed to it from the console window. Absent, nothing starts
   * — a browser tab, and the console window until its role is known.
   */
  readonly startRoute?: VoiceStartRoute;
  /** The console window: the voice's window reports a call up, so a start control here reads as one being up. */
  readonly callActiveElsewhere?: boolean;
  /** The voice's window: `open_card` moves the console window to a card, not this one (`./useOpenCardSeams.ts`). */
  readonly cardMove?: DesktopCardMove;
  /**
   * The voice's window: the shell's own look at the owner's screen, so `read_screen` needs no share.
   * Absent under a shell built without it, where the voice still asks the owner for a share.
   */
  readonly captureScreen?: DesktopBridge["captureScreen"];
  /** The voice's window: this shell takes a typed ask's look with no call up (`DesktopBridge.supportsTypedScreenLook`). */
  readonly supportsTypedScreenLook?: boolean;
  /** The voice's window: which application is in front, for the messenger band and a look's credit; never model-bound. */
  readonly frontAppBand?: DesktopBridge["frontAppBand"];
  /** The voice's window: lift one region of that look on the owner's ask (`./useScreenFocus.ts`); absent under an older shell. */
  readonly focusRegion?: DesktopBridge["focusRegion"];
  /** The voice's window: which window is in front, names only, for drift and ISO (`./useFrontWindowNotices.ts`). */
  readonly frontWindow?: DesktopBridge["frontWindow"];
  /**
   * The voice's window: tell the console window something the voice tried for the owner failed, for its toast. Absent where no call runs — a browser tab, the console window itself.
   */
  readonly reportFailure?: VoiceFailureReport;
  /**
   * The voice's window: tell the shell which call is up, `null` once none is, so a renderer death knows what to end
   * (`../../lib/overlayCrashRecovery.ts`). Absent under an older shell, which reloads a crashed voice knowing nothing.
   */
  readonly reportCall?: (call: OverlayCall | null) => void;
  /** The voice's window: take what the shell held for a call its renderer died under; absent as above. */
  readonly takeRecovery?: () => Promise<unknown>;
  /**
   * `e2e` when the desktop TEST instance runs the call (`DesktopBridge.instance`): every transcript batch and relay
   * says so, so the walk's speech is never read as the owner's. Absent on the owner's own app and in a browser.
   */
  readonly instance?: "e2e";
  /**
   * The voice's window: the triage pass's link to the menu bar and the floating notes (`./useTriageCommands.ts`). Absent
   * in a browser, in the console window and under a shell from before rapid triage.
   */
  readonly triageClock?: TriageClockLink;
  /**
   * The voice's window: ask the console window on screen for the Queue it holds now, which a Queue tool reads
   * (`./useQueueScreen.ts`). Absent in a browser, in the console window and under an older shell.
   */
  readonly requestVoiceQueue?: () => Promise<unknown>;
  /**
   * The console window: answer the voice's window's ask with the Queue this window holds (`./useQueueScreenServer.ts`);
   * the listener returns the snapshot's wire string, or `null` for none. Absent in a browser and the voice's window.
   */
  readonly serveVoiceQueue?: (listener: () => unknown) => () => void;
}

/** Where a triage pass's clock goes out to the shell, and where the shell's triage presses come in. */
export interface TriageClockLink {
  readonly report: (input: { readonly report: TriageClockReport }) => void;
  readonly onCommand: (listener: (command: TriageCommand) => void) => () => void;
}
