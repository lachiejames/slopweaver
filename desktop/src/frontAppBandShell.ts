/**
 * The effectful half of the messenger band's channel (`frontAppBand.ts`): the overlay's report of whether the messenger
 * is open, and the read of what is in front. The voice's window alone may do either.
 */
import { BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, ipcMain } from "electron";

import {
  FRONT_APP_BAND_START,
  type FrontAppBandReply,
  type FrontAppBandState,
  type FrontProcess,
  parseMessengerOpen,
  reportedMessengerOpen,
  settledFrontAppBand,
} from "./frontAppBand";
import { readFrontWindowAndPid } from "./frontWindowShell";
import type { MessengerReport } from "./nativeCapture";

/**
 * Whose window a read found in front. Slopweaver's console window and its messenger share one process, so the process
 * id alone cannot tell them apart.
 */
function frontProcessOf({ pid, voice }: { pid: number | undefined; voice: BrowserWindow | undefined }): FrontProcess {
  if (pid !== process.pid) {
    return "external";
  }
  const focused = BrowserWindow.getFocusedWindow();
  return focused === null || focused === voice ? "voice" : "console";
}

/**
 * Install the band's two messages.
 *
 * @param voiceNow the voice's window as it is now
 * @param isVoiceSender whether a message came from the voice's window
 * @param callUp whether the live-call proof holds, under which a look's application may be read with the messenger shut
 * @returns whether the messenger is open now and its epoch, which moves on every open and close, as a typed look reads them
 */
export function installFrontAppBand({
  voiceNow,
  isVoiceSender,
  callUp,
}: {
  voiceNow: () => BrowserWindow | undefined;
  isVoiceSender: (input: { event: IpcMainEvent | IpcMainInvokeEvent }) => boolean;
  callUp: () => boolean;
}): { readonly messenger: () => MessengerReport } {
  let state: FrontAppBandState = FRONT_APP_BAND_START;
  ipcMain.on("slopweaver:messenger-open", (event, value: unknown) => {
    const open = parseMessengerOpen({ value });
    if (isVoiceSender({ event }) && open !== undefined) {
      state = reportedMessengerOpen({ open, state });
    }
  });
  ipcMain.handle("slopweaver:front-app-band", async (event): Promise<FrontAppBandReply> => {
    if (!isVoiceSender({ event }) || voiceNow() === undefined) {
      throw new Error("only the voice's window may read which application is in front");
    }
    if (!state.open && !callUp()) {
      return { why: "the messenger is closed and no call is up" };
    }
    const startedEpoch = state.epoch;
    const { pid, reply: read } = await readFrontWindowAndPid();
    const front = frontProcessOf({ pid, voice: voiceNow() });
    const settled = settledFrontAppBand({ front, read, startedEpoch, state });
    state = settled.state;
    return settled.reply;
  });
  return { messenger: () => ({ epoch: state.epoch, open: state.open }) };
}
