/**
 * The door requests `slack channel` hands the door: what the ledger records for a create, an invite and an
 * archive. Pure, and split out of `./channelRun.ts` because it is the one half of that shell with nothing to
 * inject — each is a record shape, never an effect.
 */
import type { DoorRequest } from "../../../admit/types.js";
import type { SlackActor } from "../../../outbound/slack/types.js";
import type { ChannelCreatePlan, ChannelInvitePlan } from "./channelCore.js";

/**
 * The door request for a channel create. The ledger records the NAME and the shape, never the purpose or
 * topic prose — the same discipline the poll's request keeps about a question's text.
 *
 * @param plan the fully-decided create
 * @param home the state home whose ledger records the decision
 * @returns the request the door judges
 */
export function channelCreateDoorRequest({ plan, home }: { plan: ChannelCreatePlan; home: string }): DoorRequest {
  return {
    action: { kind: "verb", noun: "slack", verb: "channel" },
    artifact: {
      actor: plan.actor,
      duplicateKey: plan.duplicateKey,
      inviteCount: plan.inviteUserIds.length,
      isPrivate: plan.isPrivate,
      name: plan.name,
      operation: "create",
    },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  } satisfies DoorRequest;
}

/**
 * The door request for a channel archive.
 *
 * @param channel the channel being archived
 * @param actor the lane the archive runs on
 * @param home the state home whose ledger records the decision
 * @returns the request the door judges
 */
export function channelArchiveDoorRequest({
  channel,
  actor,
  home,
}: {
  channel: string;
  actor: SlackActor;
  home: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "slack", verb: "channel" },
    artifact: { actor, channel, operation: "archive" },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  } satisfies DoorRequest;
}

/**
 * The door request for an invite into an existing channel. The ledger records the channel and the count,
 * never the people — the same discipline the create keeps about its invitees.
 *
 * @param plan the fully-decided invite
 * @param home the state home whose ledger records the decision
 * @returns the request the door judges
 */
export function channelInviteDoorRequest({ plan, home }: { plan: ChannelInvitePlan; home: string }): DoorRequest {
  return {
    action: { kind: "verb", noun: "slack", verb: "channel" },
    artifact: {
      actor: plan.actor,
      channel: plan.channel,
      duplicateKey: plan.duplicateKey,
      inviteCount: plan.inviteUserIds.length,
      operation: "invite",
    },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  } satisfies DoorRequest;
}
