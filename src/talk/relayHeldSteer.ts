/**
 * Whether a held relay's channel steer may be recorded — pure.
 *
 * A relay whose words may stop short of a "no, wait" (`./relayCutHold.ts`) may still NARROW where a held row can go,
 * because a steer at the cut END of the owner's words was a measured mis-send. It may never WIDEN it: the newest steer across
 * a row's lineage decides where a release may go (`../outbound/slack/draftSteerGate.ts`), so recording one replaces the
 * steer before it rather than adding to it.
 *
 * - **A take-back** naming the row's own channel is never recorded held, whatever governs.
 * - **No steer governs the lineage yet**: a steer away from the row's channel narrows from anywhere to the channels it
 *   names, so it is recorded.
 * - **A steer governs it**: the held steer is recorded only when every channel it names is one the governing steer
 *   already allows. Otherwise it would lift the governing steer's refusal of the channels it adds — a cut steer to C
 *   replacing a whole one to B lets a re-cut into C go.
 */
import type { DraftChannelSteer } from "../outbound/slack/draftRegister.js";
import type { RelaySteer } from "./relayChannelSteer.js";

/**
 * The lead a held relay's steer opens on when it is NOT recorded, saying which earlier word still governs.
 *
 * @param governing the newest steer across the steered row's lineage now, or `undefined` when none carries one
 * @param hold why the relay's words may end before the owner did, or `undefined` when whole
 * @param steer the planned steer
 * @returns the NOT-recorded lead, or `undefined` when the steer is recorded as planned
 */
export function heldSteerLead({
  governing,
  hold,
  steer,
}: {
  governing: DraftChannelSteer | undefined;
  hold: string | undefined;
  steer: RelaySteer;
}): string | undefined {
  if (hold === undefined) {
    return undefined;
  }
  const { draftId, event } = steer;
  // First, whatever governs: a take-back recorded by another relay between this one's read and its append would
  // otherwise make this one's look narrowing.
  if (event.channels.some((channel) => channel.id === event.from.id)) {
    return `CHANNEL: the take-back on ${draftId} was NOT recorded, so any earlier steer still refuses (${hold})`;
  }
  if (governing === undefined) {
    return undefined;
  }
  const narrows = event.channels.every((channel) => governing.channels.some((allowed) => allowed.id === channel.id));
  if (narrows) {
    return undefined;
  }
  const allowed = governing.channels.map((channel) => `#${channel.name}`).join(" or ");
  return `CHANNEL: the steer on ${draftId} was NOT recorded, so the owner's earlier word for ${allowed} still governs (${hold})`;
}
