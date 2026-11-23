/**
 * Deleting a working checklist: the direct delete every checklist removal shares, and the capture-time
 * cleanup for an ask the visible supervisor triaged to no-response.
 *
 * Split out of `./posterWorking.ts`, which binds {@link deleteWorkingImpl} into `deleteWorking` and routes it
 * through the door for `reapEarlierCard`. Neither function here posts words: a delete is the one checklist
 * write that leaves nothing for a reader to open on.
 */

import { DEFAULT_GATES } from "../../admit/door.js";
import type { DoorLedgerPort } from "../../admit/doorLedgerPort.js";
import { throughDoor } from "../../admit/effects.js";
import type { SlackWriteTransport } from "../../corpus/slack/writeTransport.js";
import type { StartedChecklist } from "../ask/checklist.js";
import type { AskIdentity } from "../ask/identity.js";
import { cardStaysForAnotherAsk } from "../ask/sharedCard.js";
import { turnDoorRequest } from "./posterDoor.js";
import type { PostedRef } from "./run.js";
import { DoorRecordingRefusedError } from "./run.js";

/**
 * `deleteWorking`'s body. No door check: cleaning up a message the door already approved posting is not a
 * second write to judge, the same reasoning `writeSend.ts`'s own retraction takes. `deleteMessage` is
 * best-effort, so a failed delete falls back to `finalizeWorking` rather than aborting an answered turn.
 *
 * @param posted the checklist message to remove
 * @param transport the Slack write transport
 * @returns whether Slack confirmed the message gone
 */
export async function deleteWorkingImpl({
  posted,
  transport,
}: {
  posted: PostedRef;
  transport: SlackWriteTransport;
}): Promise<boolean> {
  return transport.deleteMessage({ posted });
}

/**
 * Delete the CAPTURE-TIME checklist for an ask the visible supervisor triaged to no-response.
 *
 * Reuses {@link deleteWorkingImpl}'s direct delete. Routed through the door like every other outbound write
 * the checklist makes; `started.turnId`
 * doubles as the door's own `turnId`, since no separate turn was ever dispatched for a no-response ask — the
 * capture-time id this checklist was minted under is the only one that exists.
 *
 * A decision the store could not record is NOT a `false`: `false` is the door's own refusal or an unconfirmed
 * delete, and a store fault dressed as either would send the caller looking for the wrong cause. It throws
 * {@link DoorRecordingRefusedError} instead.
 *
 * @param askIdentity the exact ask whose capture checklist this deletes
 * @param doorLedger where the door's decision is recorded
 * @param home the resolved state home
 * @param started the checklist's own `turnId`/`workingTs`, from capture
 * @param transport the Slack write transport
 * @returns `true` once the checklist is confirmed gone, `false` when the delete could not be confirmed
 */
export async function deleteCapturedChecklist({
  askIdentity,
  doorLedger,
  home,
  started,
  transport,
}: {
  askIdentity: AskIdentity;
  doorLedger: DoorLedgerPort;
  home: string;
  started: StartedChecklist;
  transport: SlackWriteTransport;
}): Promise<boolean> {
  const posted: PostedRef = { channel: askIdentity.channel, ts: started.workingTs };
  if (cardStaysForAnotherAsk({ askIdentity, home, what: "triage cleanup", workingTs: posted.ts })) {
    return true;
  }
  const outcome = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: doorLedger,
    perform: () => deleteWorkingImpl({ posted, transport }),
    request: turnDoorRequest({
      askIdentity,
      home,
      targetTs: posted.ts,
      turnId: started.turnId,
      verb: "triage-cleanup",
    }),
  });
  if (outcome.kind === "recording-refused") {
    throw new DoorRecordingRefusedError(
      `the door's decision to delete the capture checklist could not be recorded, so nothing was deleted — ${outcome.error.message}`,
    );
  }
  return outcome.performed && outcome.result;
}
