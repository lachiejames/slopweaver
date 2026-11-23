/**
 * What the menu bar icon says, as a pure reducer. The model is Docker Desktop's: an icon that changes with state and
 * shows an exclamation mark when something needs attention, with a graceful recovery in progress not counting as one.
 * So the icon is quiet while the console runs or while the shell is
 * bringing it back by itself, and shows the attention mark ONLY once that recovery has failed and the next
 * step is the owner's. Sharing the owner's screen is its own icon, because a share must be clear.
 */
import type { OverlayCommand, OverlayStatus } from "./desktopBridge";

/** Where the console stands, from the shell's side. */
export type ServiceStatus =
  | { readonly kind: "booting" }
  | { readonly kind: "recovering" }
  /** Down inside a normal update's restart window (`consoleRestartHold.ts`): quiet, no note, no Retry. */
  | { readonly kind: "restarting"; readonly problem: string }
  | { readonly kind: "ready"; readonly endpoint: string }
  | { readonly kind: "needs-attention"; readonly problem: string };

/** Everything the menu bar is drawn from. */
export interface ShellState {
  readonly service: ServiceStatus;
  /** Live screen-share tracks the console holds. */
  readonly displayTracks: number;
  /** Live microphone tracks the console holds — a voice call is open while this is above zero. */
  readonly audioTracks: number;
  /** The last session ended while a call was open. */
  readonly interruptedCall: boolean;
  /** The console page the owner was last on, when it is not the Queue. */
  readonly lastPath: string | undefined;
  /** A problem with the shell's own saved state, shown until the next good write. */
  readonly stateProblem: string | undefined;
  /** A macOS permission the voice needs and does not have. */
  readonly permissionProblem: string | undefined;
  /** The voice over the desktop, as it last reported itself; `undefined` until its page has loaded. */
  readonly overlay: OverlayStatus | undefined;
  /**
   * The owner pressed the X on the corner orb: the voice's window is off their screen while the call runs on, until
   * the menu bar's Show voice, an explicit ask for the voice, or the next call brings it back.
   */
  readonly overlayHidden: boolean;
}

/** One thing that happened to the shell. */
export type ShellEvent =
  | { readonly kind: "recovery-started" }
  | { readonly kind: "recovery-succeeded"; readonly endpoint: string }
  | { readonly kind: "recovery-failed"; readonly problem: string }
  | { readonly kind: "restart-held"; readonly problem: string }
  | { readonly kind: "media-counted"; readonly displayTracks: number; readonly audioTracks: number }
  | { readonly kind: "interrupted-call-read"; readonly present: boolean }
  | { readonly kind: "interrupted-call-cleared" }
  | { readonly kind: "page-visited"; readonly path: string }
  | { readonly kind: "state-problem"; readonly problem: string | undefined }
  | { readonly kind: "permission-problem"; readonly problem: string | undefined }
  | { readonly kind: "overlay-reported"; readonly status: OverlayStatus | undefined }
  | { readonly kind: "overlay-hidden" }
  | { readonly kind: "overlay-shown" };

/**
 * What the tray's voice item sends: any {@link OverlayCommand}, or `show`, which brings a hidden voice back as it was.
 * `show` is the tray's alone, never parsed off the console window's request (`desktopBridge.ts` `parseOverlayCommand`).
 */
export type TrayVoiceCommand = OverlayCommand | "show";

/** Which of the four menu bar icons is drawn. */
export type IconVariant = "ready" | "recovering" | "attention" | "sharing";

/** The menu bar item as plain data: the icon, its tooltip, and the lines and actions the menu carries. */
export interface MenuView {
  readonly icon: IconVariant;
  readonly tooltip: string;
  /** Disabled lines at the top of the menu, in order. */
  readonly lines: readonly string[];
  /** Offer "Reopen <last page>" under "Open Queue". */
  readonly reopenPath: string | undefined;
  /** Offer "Retry Console" — only once recovery has failed. */
  readonly retry: boolean;
  /** The voice item: what it says and the command it sends, once the voice's window is up. */
  readonly voice: { readonly label: string; readonly command: TrayVoiceCommand } | undefined;
}

/** The Queue, where the owner lands: the default page. */
export const QUEUE_PATH = "/queue";

/** The state before anything has been read. */
export const INITIAL_SHELL_STATE: ShellState = {
  audioTracks: 0,
  displayTracks: 0,
  interruptedCall: false,
  lastPath: undefined,
  overlay: undefined,
  overlayHidden: false,
  permissionProblem: undefined,
  service: { kind: "booting" },
  stateProblem: undefined,
};

/**
 * Apply one event.
 *
 * @param state the state before it
 * @param event what happened
 * @returns the state after it
 */
export function reduceShellState({ state, event }: { state: ShellState; event: ShellEvent }): ShellState {
  switch (event.kind) {
    case "recovery-started":
      return { ...state, service: { kind: "recovering" } };
    case "recovery-succeeded":
      return { ...state, service: { endpoint: event.endpoint, kind: "ready" } };
    case "recovery-failed":
      return { ...state, service: { kind: "needs-attention", problem: event.problem } };
    case "restart-held":
      return { ...state, service: { kind: "restarting", problem: event.problem } };
    case "media-counted":
      return {
        ...state,
        audioTracks: Math.max(0, event.audioTracks),
        displayTracks: Math.max(0, event.displayTracks),
        // A call the owner opened in this session answers the one the last session lost.
        interruptedCall: state.interruptedCall && event.audioTracks <= 0,
      };
    case "interrupted-call-read":
      return { ...state, interruptedCall: event.present };
    case "interrupted-call-cleared":
      return { ...state, interruptedCall: false };
    case "page-visited":
      return { ...state, lastPath: event.path === QUEUE_PATH ? undefined : event.path };
    case "state-problem":
      return { ...state, stateProblem: event.problem };
    case "permission-problem":
      return { ...state, permissionProblem: event.problem };
    case "overlay-reported":
      return {
        ...state,
        overlay: event.status,
        overlayHidden: state.overlayHidden && !overlayReturns({ before: state.overlay, after: event.status }),
      };
    case "overlay-hidden":
      // The stage never sits in a window the owner cannot see: an X pressed on the corner orb as the stage comes up arrives
      // after the stage's own report, and is refused rather than hiding it.
      return { ...state, overlayHidden: state.overlay?.mode !== "expanded" };
    case "overlay-shown":
      return { ...state, overlayHidden: false };
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

/**
 * Whether a report brings a hidden voice back by itself. A call starting does — the hide was for the call it was hidden
 * in, and the next one is back (the voice collapses by default on the next call), opening on the stage or
 * in the corner as the owner's start switch says. So does the stage coming up, which never sits in a window the owner cannot see.
 * The same call reported again does not, and nor does that call ending: the orb never pops back as the owner hangs up.
 *
 * @param before the voice's last report, `undefined` before any
 * @param after the report now, `undefined` while no page reports
 * @returns true when the hide ends here
 */
function overlayReturns({
  before,
  after,
}: {
  before: OverlayStatus | undefined;
  after: OverlayStatus | undefined;
}): boolean {
  if (after === undefined) {
    return false;
  }
  const callStarted = after.callActive && before?.callActive !== true;
  return callStarted || after.mode === "expanded";
}

/**
 * Draw the menu bar item. Attention outranks sharing, sharing outranks recovering: a failed recovery is the one
 * thing the owner must act on, and a live share is the thing the owner must always be able to see.
 *
 * @param state the shell's state
 * @returns the icon, tooltip and menu lines
 */
export function menuView({ state }: { state: ShellState }): MenuView {
  const lines: string[] = [];
  const service = state.service;
  let status = "Slopweaver: starting the console…";
  if (service.kind === "recovering") {
    status = "Slopweaver: reconnecting to the console…";
  } else if (service.kind === "restarting") {
    status = "Slopweaver: the console is restarting onto a new build…";
  } else if (service.kind === "ready") {
    status = `Slopweaver: running on ${service.endpoint.replace("http://", "")}`;
  } else if (service.kind === "needs-attention") {
    status = `Needs attention: ${service.problem}`;
  }
  lines.push(status);
  const sharing = state.displayTracks > 0;
  if (sharing) {
    lines.push("● Sharing your screen with the voice");
  }
  if (state.audioTracks > 0) {
    lines.push("Voice call open");
  }
  if (state.interruptedCall) {
    lines.push("The last session closed during a call; press the orb, then talk, to start again");
  }
  if (state.permissionProblem !== undefined) {
    lines.push(state.permissionProblem);
  }
  if (state.stateProblem !== undefined) {
    lines.push(state.stateProblem);
  }
  let icon: IconVariant = "ready";
  if (service.kind === "needs-attention") {
    icon = "attention";
  } else if (sharing) {
    icon = "sharing";
  } else if (service.kind === "booting" || service.kind === "recovering" || service.kind === "restarting") {
    icon = "recovering";
  }
  return {
    icon,
    lines,
    reopenPath: state.lastPath,
    retry: service.kind === "needs-attention",
    tooltip: sharing ? `${status} · sharing your screen` : status,
    voice: voiceItem({ audioTracks: state.audioTracks, hidden: state.overlayHidden, overlay: state.overlay }),
  };
}

/**
 * The tray's voice item, from what the overlay last reported: bring a hidden voice back, start a call, bring a
 * cornered one up to the stage, or move the stage back to the corner.
 *
 * @param overlay the voice's last report
 * @param audioTracks live microphone tracks across every window — one held while the overlay reports no call is a
 *   call open somewhere else, and starting a second is refused
 * @param hidden the owner hid the voice with the X on its orb, so the item brings it back whatever the call is doing
 * @returns the item, or `undefined` before the voice's window has loaded or while another window holds the mic
 */
function voiceItem({
  overlay,
  audioTracks,
  hidden,
}: {
  overlay: OverlayStatus | undefined;
  audioTracks: number;
  hidden: boolean;
}): { readonly label: string; readonly command: TrayVoiceCommand } | undefined {
  if (overlay === undefined) {
    return undefined;
  }
  if (hidden) {
    return { command: "show", label: "Show voice" };
  }
  if (!overlay.callActive) {
    if (audioTracks > 0) {
      return undefined;
    }
    return { command: "activate", label: "Start voice" };
  }
  if (overlay.mode === "collapsed") {
    return { command: "expand", label: "Expand voice" };
  }
  return { command: "collapse", label: "Move voice to corner" };
}
