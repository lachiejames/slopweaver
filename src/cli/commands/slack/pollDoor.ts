/**
 * What `slack poll` hands the door and the poll store: the gate list, the door request and the record claimed
 * before the post, and the checks a live poll must pass before it is planned. Split out of `./pollRun.ts` to keep
 * that shell to the order of its irreversible steps.
 */
import type { DoorGate, DoorRequest } from "../../../admit/types.js";
import { type VoiceGateInput, voiceProfileGate } from "../../../admit/voiceProfileGate.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { prLedOpeningGate } from "../../../outbound/slack/draftPrLead.js";
import {
  destinationLabel,
  duplicateSendGate,
  OVERRIDE_REMEDY,
  priorSendFrom,
} from "../../../outbound/slack/duplicateGate.js";
import type { PollSurface } from "../../../outbound/slack/pollRender.js";
import type { PollRecord } from "../../../outbound/slack/pollStore.js";
import { DUPLICATE_WINDOW_HOURS, peekSend } from "../../../outbound/slack/sendReservation.js";
import type { ConversationSurface } from "../../../outbound/slack/types.js";
import { type HighStakesDeps, highStakesRefusals } from "./highStakesGate.js";
import type { PollPlan } from "./pollCore.js";

/**
 * What must hold before a live poll is planned, asked in order, and the surface it lands on when all of it does.
 *
 * **A poll into a high-stakes channel is refused** (`./highStakesGate.ts`, owner ruling): a poll is always a
 * top-level post and never a finding card, so it is exactly the undefended post that gate exists to stop.
 *
 * **Then Slack is asked which kind of conversation it lands in**, and an unclear answer REFUSES: the footer
 * promises who can see a vote, and that promise has to be true of the surface it lands on. A DM footer claiming
 * the vote is public makes people self-censor, and nothing would surface that it happened. Both channel arms
 * answer that identically — everyone in the channel does. The public/private split exists for the as-me door,
 * which cares about a *very public place*, and folding it in here would make the footer claim a distinction it
 * does not draw.
 *
 * @param deps the high-stakes reads, the surface read and the environment the hatches are read from
 * @param options where the poll is aimed and the Slopweaver home
 * @param token the bot token Slack is asked with
 * @returns the poll's own two-arm surface, or the refusal lines
 */
export async function pollSurfaceOrRefusal({
  deps,
  options,
  token,
}: {
  deps: HighStakesDeps & {
    readonly env: () => Readonly<Record<string, string | undefined>>;
    readonly conversationSurface: (args: {
      token: string;
      channel: string;
    }) => Promise<ConversationSurface | undefined>;
  };
  options: { readonly channel: string; readonly home: string };
  token: string;
}): Promise<Result<PollSurface>> {
  const { channel, home } = options;
  // Asked only once the dry-run branch is behind it, so a live poll takes the channel's claim here.
  const highStakes = await highStakesRefusals({
    channel,
    claim: true,
    deps,
    env: deps.env(),
    formKind: "poll",
    home,
    threadTs: undefined,
    token,
  });
  if (highStakes.length > 0) {
    return err(highStakes);
  }
  const conversation = await deps.conversationSurface({ channel, token });
  if (conversation === undefined) {
    return err([
      `cannot determine whether ${channel} is a DM or a shared channel, so the poll's footer cannot ` +
        "state truthfully who will see a vote. Nothing was posted.",
    ]);
  }
  return ok(conversation === "direct-message" ? "direct-message" : "shared-channel");
}

/**
 * The gate list: the voice rules already read, then the duplicate warn seeded from a NON-mutating peek.
 *
 * @param home the state home holding the reservation store
 * @param plan the fully-decided poll, whose `pollId` is the duplicate key
 * @param nowIso the reference instant the duplicate window is measured from
 * @param voice the voice input read before Slack was asked anything
 * @param verifiedOwnDm their bot DM's id once a bot-token read proved it their, undefined when unproven
 * @returns the gates the door judges this poll against, voice first
 */
export function pollGates({
  home,
  plan,
  nowIso,
  verifiedOwnDm,
  voice,
}: {
  home: string;
  plan: PollPlan;
  nowIso: string;
  verifiedOwnDm: string | undefined;
  voice: VoiceGateInput;
}): readonly DoorGate[] {
  const prior = peekSend({ duplicateKey: plan.pollId, home, nowIso, windowHours: DUPLICATE_WINDOW_HOURS });
  const { channel, payload } = plan;
  return [
    voiceProfileGate(voice),
    // A poll's question is its opening, held to the rule every teammate-bound send is.
    prLedOpeningGate({ channel, payload, verifiedOwnDm }),
    duplicateSendGate({
      prior: priorSendFrom({
        destination: destinationLabel({ channel: plan.channel }),
        duplicateKey: plan.pollId,
        reservation: prior,
      }),
      unconfirmedRemedy: OVERRIDE_REMEDY,
      windowHours: DUPLICATE_WINDOW_HOURS,
    }),
  ];
}

/**
 * The door request for a poll. The ledger records the opaque identity, never the question or the options.
 *
 * @param plan the fully-decided poll
 * @param home the state home whose ledger records the decision
 * @returns the request the door judges
 */
export function pollDoorRequest({ plan, home }: { plan: PollPlan; home: string }): DoorRequest {
  return {
    action: { kind: "verb", noun: "slack", verb: "poll" },
    artifact: {
      actor: plan.actor,
      blockCount: 1,
      channel: plan.channel,
      duplicateKey: plan.pollId,
      optionCount: plan.ballot.length,
    },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  } satisfies DoorRequest;
}

/**
 * The record the poll store claims before posting, so a results read can pair each reaction with its option.
 *
 * @param plan the fully-decided poll
 * @param nowIso the instant the poll is recorded as created
 * @returns the record to persist
 */
export function pollRecordFor({ plan, nowIso }: { plan: PollPlan; nowIso: string }): PollRecord {
  return {
    channel: plan.channel,
    createdIso: nowIso,
    emojiNames: plan.ballot.map((entry) => entry.emojiName),
    // The BALLOT's labels, not the authored options: the ballot appends the "Other — explain in replies" row,
    // so the authored list is one shorter and storing it would leave `options[i]` and `emojiNames[i]` out of
    // step — which the store rejects as a corrupt ballot, and rightly, since the tally pairs them by index.
    options: plan.ballot.map((entry) => entry.label),
    pollId: plan.pollId,
    question: plan.artifact.question,
    schemaVersion: 1,
    why: plan.artifact.why,
  };
}
