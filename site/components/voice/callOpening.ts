/**
 * What a call that just went live opens with, by how it was opened: a reconnect plays the back cue that pairs with the
 * drop cue and journals the reconnect, and every other call starts its reopen window (`reopenReminderClient.ts`),
 * which the server arms only on a fresh call the owner reopened within a minute of hanging up. A rollover's successor opens
 * with nothing the owner hears, and never reaches here. Split from `VoiceProvider.tsx` to keep it under the line cap.
 */
import { playCallBackCue } from "../../lib/callDropCue";
import { type ReconnectChain, reconnectLiveJournal } from "../../lib/callReconnect";
import type { CallOpenMode } from "../../lib/callRollover";
import { watchReopenReminder } from "./reopenReminderClient";
import type { CallTranscript } from "./useCallTranscript";

/**
 * Open the call that just went live.
 *
 * @param callId the minted call's id, which the reopen window is posted under
 * @param thisCall the page's own id for the call, which a reconnect's journal names as the new call
 * @param chain the reconnect chain, stamped with when this reconnect went live, so a fresh drop is judged against it
 * @param current whether the call is still this page's
 * @param sounding whether the owner's microphone carries the owner talking, read off the live meter
 */
export function openLiveCall({
  callId,
  chain,
  current,
  mode,
  sounding,
  thisCall,
  transcript,
}: {
  callId: string;
  chain: { current: ReconnectChain | undefined };
  current: () => boolean;
  mode: CallOpenMode;
  sounding: () => boolean;
  thisCall: string;
  transcript: Pick<CallTranscript, "reconnect">;
}): void {
  if (mode === "reconnect" && chain.current !== undefined) {
    transcript.reconnect({ journal: reconnectLiveJournal({ chain: chain.current, newCallId: thisCall }) });
    chain.current = { ...chain.current, liveAtMs: performance.now() };
    playCallBackCue();
    return;
  }
  watchReopenReminder({ callId, current, sounding });
}
