/*
 * Tells the live conversation the owner put something on their running list, with the one fixed sentence
 * `RUNNING_LIST_CHANGED_TEXT` and never the item itself: what the owner added reaches the model only through its own
 * `running_list` read, where it arrives as data. The console's list route calls this after an add carrying the
 * conversation's id.
 *
 * - A voice call is told at once, as a developer message on its realtime session (`PlanCall`).
 * - A typed conversation holds the notice for the owner's next message (`TypedPlanSession`), since its thread takes no
 *   developer message and a turn of its own would be one nobody asked for.
 *
 * Never throws: the add already landed, so a notice that could not be handed over is a reason the route reports,
 * not a failure of the add.
 */
import { planCallById } from "./talkCallRegistry";
import type { PlanCall } from "./talkPlanCall";

/**
 * Tell whichever conversation `lookup` resolves for `callId` that the running list changed. The pure core of
 * {@link notifyRunningListChanged}, taking the lookup so a test passes a plain fake instead of the process registry.
 *
 * @param callId the id the page holds for its live call or typed conversation
 * @param lookup resolves that id to a held conversation, or `undefined` when none is held under it
 * @returns `undefined` once the notice was handed over (or held for the next typed message), else why not
 */
export async function notifyRunningListChangedVia({
  callId,
  lookup,
}: {
  callId: string;
  lookup: (input: { id: string }) => Pick<PlanCall, "notifyRunningListChanged"> | undefined;
}): Promise<string | undefined> {
  const call = lookup({ id: callId });
  if (call === undefined) {
    return `no live call or typed conversation is held under ${callId}`;
  }
  try {
    return await call.notifyRunningListChanged();
  } catch (error: unknown) {
    const why = error instanceof Error ? error.message : String(error);
    return `the running-list notice failed: ${why}`;
  }
}

/**
 * Tell the conversation held under `callId` in this process that the owner put something on their running list.
 *
 * @param callId the id the page holds for its live call or typed conversation
 * @returns `undefined` once the notice was handed over (or held for the next typed message), else why not
 */
export async function notifyRunningListChanged({ callId }: { callId: string }): Promise<string | undefined> {
  return notifyRunningListChangedVia({ callId, lookup: planCallById });
}
