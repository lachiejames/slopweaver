/**
 * The effectful half of the voice's native look: Electron's `screen`, `desktopCapturer` and `systemPreferences`
 * applied to what `nativeCapture.ts` decides. `main.ts` hands it the shell's state, which stays there because every
 * other window shares it.
 */
import { type BrowserWindow, desktopCapturer, screen, systemPreferences } from "electron";

import {
  fittedNativeCaptureSize,
  lookRefusal,
  type MessengerReport,
  messengerHeldOpen,
  type NativeCaptureReply,
  nativeCaptureSize,
  SCREEN_RECORDING_OFF,
  screenRecordingRefusal,
  sourceForDisplay,
} from "./nativeCapture";
import type { LookedDisplay } from "./screenFocus";
import type { ShellEvent, ShellState } from "./shellState";

/**
 * One still of the display the voice is on, exactly as the owner sees it — the orb, the widget and the transcript included,
 * never hidden for the look, so what the owner sees is what the voice sees — and only during
 * a call or on a typed ask with the messenger open ({@link lookRefusal}), asked before the look and after it, so a
 * still taken across the owner's hang-up or the messenger's closing never leaves main. The first attempt raises
 * macOS's own Screen Recording prompt; until the owner grants it the answer names the
 * switch, here and on the menu bar. Every failure is an answer, never a throw.
 *
 * @param window the voice's window, whose display is the one looked at
 * @param shellNow the shell's state as it is at the moment of asking — read before the look and again after it
 * @param overlayMicTracks the live microphone tracks the voice's own window reports, never the console's
 * @param messenger the messenger's open state and epoch — read before the look and again after it
 * @param typedAsk whether a typed message asked for this look
 * @param report a shell event to apply — the permission problem, set or cleared
 * @param looked told which display the still is of, just before a still is handed back, so the voice can later point
 *   into it (`screenShell.ts`)
 * @returns the still as PNG bytes with its size, or why there is none
 */
export async function captureScreenNatively({
  window,
  shellNow,
  overlayMicTracks,
  messenger,
  typedAsk,
  report,
  looked,
}: {
  window: BrowserWindow;
  shellNow: () => ShellState;
  overlayMicTracks: () => number;
  messenger: () => MessengerReport;
  typedAsk: boolean;
  report: (event: ShellEvent) => void;
  looked: (input: { display: LookedDisplay }) => void;
}): Promise<NativeCaptureReply> {
  // Asked again after the look: a call the owner ends while macOS looks yields no picture, and so
  // does a messenger the owner closes, reopened or not.
  const started = messenger();
  const noCallNow = (): string | undefined =>
    lookRefusal({
      messengerOpen: messengerHeldOpen({ now: messenger(), started }),
      overlayAudioTracks: overlayMicTracks(),
      overlayCallActive: shellNow().overlay?.callActive === true,
      typedAsk,
    });
  const noCall = noCallNow();
  if (noCall !== undefined) {
    return { why: noCall };
  }
  const display = screen.getDisplayMatching(window.getBounds());
  const thumbnailSize = nativeCaptureSize({ scaleFactor: display.scaleFactor, size: display.size });
  if (thumbnailSize === undefined) {
    return { why: "the display the voice is on reports no size to take a picture at" };
  }
  let sources: Electron.DesktopCapturerSource[] | undefined;
  let failure: string | undefined;
  try {
    sources = await desktopCapturer.getSources({ thumbnailSize, types: ["screen"] });
  } catch (cause) {
    failure = `macOS took no picture: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
  // Read after the attempt, which is what raises the prompt; a refused permission explains a failed attempt too.
  const refusal = screenRecordingRefusal({ status: systemPreferences.getMediaAccessStatus("screen") });
  if (refusal !== undefined) {
    report({ kind: "permission-problem", problem: refusal.why });
    return refusal;
  }
  if (shellNow().permissionProblem === SCREEN_RECORDING_OFF) {
    report({ kind: "permission-problem", problem: undefined });
  }
  if (sources === undefined) {
    return { why: failure! };
  }
  const endedWhileLooking = noCallNow();
  if (endedWhileLooking !== undefined) {
    return { why: endedWhileLooking };
  }
  const source = sourceForDisplay({ displayId: display.id, sources });
  if (source === undefined || source.thumbnail.isEmpty()) {
    return { why: "macOS listed no picture of the display the voice is on" };
  }
  const still = source.thumbnail.resize(fittedNativeCaptureSize({ source: source.thumbnail.getSize() }));
  const { height, width } = still.getSize();
  looked({ display: { bounds: display.bounds, id: display.id } });
  return { height, png: new Uint8Array(still.toPNG()), width };
}
