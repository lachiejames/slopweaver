/**
 * The voice's window asks for the Queue on screen, and main asks the console tab on screen for it
 * (`voiceQueueWire.ts` says what crosses and why). Only the voice's window may ask; only the tab in front is asked; only
 * that tab's reply to that request counts; and a tab the owner left, or a page that navigated, under the ask is asked again
 * once, of the tab in front then. Nothing here reads the snapshot: it goes to the voice's window as the tab sent it.
 */
import { randomUUID } from "node:crypto";

import { type IpcMainInvokeEvent, ipcMain, type WebContents } from "electron";

import { activeTabId, tabContents } from "./tabsShell";
import {
  movedTwiceAnswer,
  parseVoiceQueueReply,
  VOICE_QUEUE_DEADLINE_MS,
  type VoiceQueueAnswer,
  type VoiceQueueAsk,
  type VoiceQueueReply,
  voiceQueueOutcome,
} from "./voiceQueueWire";

/** The asks waiting on a reply, by request id: the tab's page asked, and what settles the ask. */
const waiting = new Map<
  string,
  { readonly contents: WebContents; readonly settle: (reply: VoiceQueueReply) => void }
>();

/**
 * Ask the tab in front once.
 *
 * @returns how the ask ended, and which tab was asked
 */
async function askOnce(): Promise<{ readonly ask: VoiceQueueAsk; readonly askedTab: string | undefined }> {
  const askedTab = activeTabId();
  const contents = tabContents({ id: askedTab });
  if (contents === undefined || contents.isDestroyed()) {
    return { ask: { kind: "no-tab" }, askedTab: undefined };
  }
  const id = randomUUID();
  const ask = await new Promise<VoiceQueueAsk>((resolve) => {
    const finish = (ended: VoiceQueueAsk): void => {
      clearTimeout(timer);
      waiting.delete(id);
      contents.removeListener("did-start-navigation", navigated);
      contents.removeListener("destroyed", gone);
      resolve(ended);
    };
    // A new document under the ask is a page that will never answer it: asked again of the tab in front.
    const navigated = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>): void => {
      if (details.isMainFrame && !details.isSameDocument) {
        finish({ kind: "navigated" });
      }
    };
    const gone = (): void => {
      finish({ kind: "navigated" });
    };
    const timer = setTimeout(() => {
      finish({ kind: "deadline" });
    }, VOICE_QUEUE_DEADLINE_MS);
    contents.on("did-start-navigation", navigated);
    contents.once("destroyed", gone);
    waiting.set(id, {
      contents,
      settle: (reply) => {
        finish({ kind: "replied", reply, tabNow: activeTabId() });
      },
    });
    contents.send("slopweaver:voice-queue-request", id);
  });
  return { ask, askedTab };
}

/**
 * Ask, and once more when the screen moved under the first ask.
 *
 * @returns what the voice's window is handed
 */
async function askForQueue(): Promise<VoiceQueueAnswer> {
  const first = await askOnce();
  const outcome = voiceQueueOutcome(first);
  if (outcome !== "retry") {
    return outcome;
  }
  const second = await askOnce();
  const again = voiceQueueOutcome(second);
  if (again === "retry") {
    return movedTwiceAnswer();
  }
  return again;
}

/**
 * Take the voice's window's asks and the console tabs' replies.
 *
 * @param fromOverlay whether a message came from the voice's window, on the console, from its top frame
 */
export function installVoiceQueueRequests({
  fromOverlay,
}: {
  fromOverlay: (input: { readonly event: IpcMainInvokeEvent }) => boolean;
}): void {
  ipcMain.on("slopweaver:voice-queue-reply", (event, value: unknown) => {
    const reply = parseVoiceQueueReply({ value });
    if (reply === undefined) {
      return;
    }
    const ask = waiting.get(reply.id);
    // Only the page the request went to may answer it.
    if (ask === undefined || ask.contents !== event.sender) {
      return;
    }
    ask.settle(reply);
  });
  ipcMain.handle("slopweaver:voice-queue", async (event): Promise<VoiceQueueAnswer> => {
    if (!fromOverlay({ event })) {
      return { kind: "unreached", why: "only the voice's window may ask for the Queue on screen" };
    }
    return askForQueue();
  });
}
