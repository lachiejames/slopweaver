/**
 * The shell's half of a call surviving the voice's renderer dying under it, wired to Electron (`overlayRecovery.ts`
 * is the pure decision). It hears which call the overlay's page holds, logs every death to the shell's event log
 * (`desktopEventLog.ts`), holds the recovery, and hands it to the reloaded page when that page asks. It watches the
 * overlay's contents itself, so `main.ts` stays under the line cap with one call per overlay window.
 */
import { type IpcMainEvent, type IpcMainInvokeEvent, ipcMain, type WebContents } from "electron";

import { type DesktopRole, type OverlayCall, parseOverlayCall } from "./desktopBridge";
import { logDesktopEvent } from "./eventLogShell";
import {
  type HeldRecovery,
  type OverlayCrashRecovery,
  recoveryAfterRendererGone,
  takeRecovery,
} from "./overlayRecovery";

/** Which of the shell's windows sent a message, on the console, from its top frame. */
type RoleOf = (input: { event: IpcMainEvent | IpcMainInvokeEvent }) => DesktopRole | undefined;

/** One watched overlay's own state: none of it is ever read or written by another window's event. */
interface WatchedOverlay {
  /** The call its page last reported, `null` for none — what a renderer death ends. */
  call: OverlayCall | null;
  /** A dead call's recovery, held until its reloaded page takes it. */
  held: HeldRecovery | undefined;
  /** When its renderer last died, on the monotonic clock, so a second death soon after does not reconnect. */
  lastCrashMonoMs: number | undefined;
  /**
   * Whether its current page has asked for the recovery. Until it has, its call reports are ignored, so a page can never
   * report a new call over a recovery it has not yet taken. The page asks as it mounts, and one
   * renderer's messages arrive in order, so this drops only the `null` it reports first.
   */
  asked: boolean;
}

/** Each watched overlay's state by its contents id, which a reload keeps and a closed window's destruction drops. */
const watched = new Map<number, WatchedOverlay>();
/** Whether the two messages are registered: `ipcMain.handle` refuses a second handler for one channel. */
let listening = false;

/**
 * Listen, once, for the overlay's call reports and its recovery ask, each only from the overlay.
 *
 * @param roleOf which window sent a message
 */
function listen({ roleOf }: { roleOf: RoleOf }): void {
  if (listening) {
    return;
  }
  listening = true;
  ipcMain.on("slopweaver:overlay-call", (event, value: unknown) => {
    const reported = parseOverlayCall({ value });
    const state = watched.get(event.sender.id);
    if (roleOf({ event }) === "overlay" && reported !== undefined && state?.asked === true) {
      state.call = reported;
    }
  });
  // The reloaded voice page asks once it is up; a recovery is handed over once, and never to the console window.
  ipcMain.handle("slopweaver:overlay-recovery", (event): OverlayCrashRecovery | null => {
    const state = watched.get(event.sender.id);
    if (roleOf({ event }) !== "overlay" || state === undefined) {
      return null;
    }
    const taken = takeRecovery({ held: state.held, monoMs: performance.now(), nowMs: Date.now() });
    state.held = undefined;
    state.asked = true;
    if (taken === undefined) {
      return null;
    }
    logDesktopEvent({ entry: taken.entry });
    return taken.recovery;
  });
}

/**
 * Watch one overlay window's contents: a page that navigates is gone, so the next reports its own call, and a renderer
 * that dies is logged and its call's recovery held — read off the call before anything forgets it, whichever of the
 * contents' listeners runs first, since the death itself is what clears the call here.
 *
 * @param contents the overlay window's contents
 * @param roleOf which window sent a message
 */
export function watchOverlayRecovery({ contents, roleOf }: { contents: WebContents; roleOf: RoleOf }): void {
  listen({ roleOf });
  const state: WatchedOverlay = { asked: false, call: null, held: undefined, lastCrashMonoMs: undefined };
  const { id } = contents;
  watched.set(id, state);
  contents.once("destroyed", () => {
    watched.delete(id);
  });
  contents.on("did-navigate", () => {
    state.asked = false;
    state.call = null;
  });
  contents.on("render-process-gone", (_event, details) => {
    const nowMs = Date.now();
    const monoMs = performance.now();
    const gone = { exitCode: details.exitCode, reason: details.reason };
    const after = recoveryAfterRendererGone({
      call: state.call,
      gone,
      held: state.held,
      lastCrashMonoMs: state.lastCrashMonoMs,
      monoMs,
      nowMs,
    });
    state.asked = false;
    state.call = null;
    state.lastCrashMonoMs = monoMs;
    logDesktopEvent({ entry: after.entry });
    state.held = after.held;
  });
}
