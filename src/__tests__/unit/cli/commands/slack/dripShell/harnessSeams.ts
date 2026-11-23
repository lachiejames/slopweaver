/*
 * The identity and gate seams of the as-me drip shell harness: who the run is, which channel it lands in, and what the
 * door, the wall and the voice rules answer. Each builder reads the one resolved options snapshot `harness()` made.
 */
import type { SlackWriteDeps } from "../../../../../../cli/commands/slack/run.js";
import { ok } from "../../../../../../lib/result.js";
import type { SlackCardChrome } from "../../../../../../outbound/slack/types.js";
import { grantedEnv } from "../../../../../hatchGrantFixture.js";
import { PROMPT_DM } from "../ownDmFakes.js";
import { type HarnessRecord, RELEASE_SELF, type ResolvedHarnessOptions } from "./harnessTypes.js";

const CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: "#123456",
  detailLabel: "*Details*",
  metadataEventType: "test_card_v1",
};

/**
 * The seams that say who is running and what the account looks like: ledgers, tokens, the bot DM and membership.
 *
 * @returns the identity half of the fake deps.
 */
export function identitySeams({
  options,
  record,
}: {
  options: ResolvedHarnessOptions;
  record: HarnessRecord;
}): Pick<
  SlackWriteDeps,
  | "approvedScheduledChannels"
  | "autonomy"
  | "bareRefContext"
  | "botToken"
  | "chrome"
  | "conversationMembership"
  | "doorLedger"
  | "ownerUserId"
  | "promptChannel"
  | "taggedAccount"
  | "userToken"
  | "verifiedOwnDm"
  | "whoAmI"
> {
  const { autonomy, door, ownDm, userToken } = options;
  return {
    autonomy,
    doorLedger: door.port,
    bareRefContext: () => ({ repos: [] }),
    botToken: () => "xoxb-test",
    chrome: () => CHROME,
    // The owner's bot DM: the DM membership hold passes it, and nothing else on the as-me drip reads it.
    promptChannel: () => PROMPT_DM,
    verifiedOwnDm: ownDm,
    // A channel nobody is in, so neither the in-conversation rescue nor the DM hold fires on a fixture written for
    // something else.
    conversationMembership: async () => ({ directMessage: false, kind: "read", members: new Set() }),
    taggedAccount: async () => ({ deleted: false, kind: "read", name: undefined }),
    ownerUserId: () => "U0OWNER",
    // An as-me drip carries no recipe slot key either, so the 291-8x gate never fires on this lane.
    approvedScheduledChannels: () => [],
    userToken: ({ home }) => {
      record.userHomes.push(home);
      if (userToken === null) {
        return undefined;
      }
      return userToken;
    },
    whoAmI: async () => ({ userId: RELEASE_SELF, workspaceUrl: "https://fixture.slack.com/" }),
  };
}

/**
 * The seams the gates ask: high-stakes channels, the wall, the render proof, the door's environment and the voice rules.
 *
 * @returns the gate half of the fake deps.
 */
export function gateSeams({
  options,
}: {
  options: ResolvedHarnessOptions;
}): Pick<
  SlackWriteDeps,
  | "botMembership"
  | "channelClaim"
  | "conversationGroupDm"
  | "conversationSurface"
  | "doorEnv"
  | "dripConfig"
  | "fleetHistory"
  | "highStakes"
  | "proveRender"
  | "releaseChannelClaim"
  | "resolveMentions"
  | "threadAnchor"
  | "voiceRules"
  | "wallRun"
> {
  const { exactVoiceRules, extraEnv, grants, override, paragraphSpacing, renderProofChannel } = options;
  const grantEnv = grants === undefined ? {} : grantedEnv(grants);
  return {
    // A PRIVATE channel by default, so the one-card gate never fires on a fixture written to test
    // something else. The public case has its own tests, which pass this explicitly.
    highStakes: () => options.highStakes,
    threadAnchor: async () => ({ kind: "present" as const }),
    channelClaim: () => ({ kind: "free" as const }),
    releaseChannelClaim: () => undefined,
    fleetHistory: options.fleetHistory,
    proveRender: options.proveRender,
    conversationSurface: options.conversationSurface,
    conversationGroupDm: async () => undefined,
    botMembership: async () => "member",
    doorEnv: () => ({
      ...grantEnv,
      ...extraEnv,
      ...(override === undefined ? {} : { SLOPWEAVER_DOOR_OVERRIDE: override }),
    }),
    // The as-bot lane reads the operator's rules through its own dep rather than through drip
    // configuration, so a fixture that sets rules exercises BOTH lanes.
    voiceRules: () => ok(exactVoiceRules),
    dripConfig: () =>
      ok({
        exactVoiceRules,
        paragraphSpacing,
        intervalMs: 0,
        maxMessages: 8,
        messageVisibleMax: 300,
        soleMessageVisibleMax: 1000,
        cardVisibleMax: 1000,
        maxBullets: 10,
        maxLines: 8,
        ...(renderProofChannel === undefined ? {} : { renderProofChannel }),
      }),
    resolveMentions: options.resolveMentions,
    wallRun: options.wallRun,
  };
}
