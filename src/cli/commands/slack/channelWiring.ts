/**
 * `slack channel`'s seams, split out of `./channelRun.ts` so the shell stays one reviewable file: the injected
 * dependency bag every effect goes through, and the production wiring that fills it.
 */
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { type PainPointLane, recordExactVoicePainPoints } from "../../../admit/painPoint.js";
import { slackBotToken, slackUserToken } from "../../../config.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import type { InviteOutcome, OpenedConversation } from "../../../corpus/slack/writeApiConversations.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { ExactVoiceRule, ExactVoiceRuleFinding } from "../../../outbound/voice/exactRules.js";
import { type ProfileReadError, readExactVoiceRules } from "../../../profileStore.js";
import type { IdentityRosterError } from "../../../silver/identityRosterErrors.js";
import type { ChannelDescribeDeps } from "./channelDescribe.js";
import { freshSlackIdsNow } from "./wiring.js";

/** The injected seams. Each touches something real, so each is replaceable in a test without a mock. */
export interface ChannelDeps extends ChannelDescribeDeps {
  readonly botToken: (args: { home: string }) => string | undefined;
  readonly userToken: (args: { home: string }) => string | undefined;
  /** The door ledger every channel write's decision is recorded through before anything is performed. */
  readonly doorLedger: DoorLedgerPort;
  /** Identity-map key → Slack user id, EXACT matches only. A key nothing answers is simply absent. */
  readonly resolvePeople: (args: {
    home: string;
    people: readonly string[];
  }) => Promise<Result<ReadonlyMap<string, string>, IdentityRosterError>>;
  readonly createChannel: (args: {
    home: string;
    token: string;
    name: string;
    isPrivate: boolean;
  }) => Promise<OpenedConversation>;
  readonly inviteToChannel: (args: {
    home: string;
    token: string;
    channel: string;
    userIds: readonly string[];
  }) => Promise<InviteOutcome>;
  readonly archiveChannel: (args: { home: string; token: string; channel: string }) => Promise<boolean>;
  /** The operator's exact voice rules, for a create's purpose and topic. */
  readonly voiceRules: (args: { home: string }) => Result<readonly ExactVoiceRule[], ProfileReadError>;
  /** Record exact-rule matches as bounded future-turn guidance; this observation never decides the create. */
  readonly recordVoicePainPoints: (args: {
    home: string;
    findings: readonly ExactVoiceRuleFinding[];
    lane: PainPointLane;
  }) => void;
  /** The environment the voice hatch is read from, injected so the shell resolves it rather than the gate. */
  readonly env: () => Readonly<Record<string, string | undefined>>;
}

/** A transport for a channel call, under the verb's own home: its privacy policy judges every write. */
const channelTransport = ({ home, token }: { home: string; token: string }) => makeSlackWriteTransport({ home, token });

/**
 * The production wiring.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function liveChannelDeps(): ChannelDeps {
  return {
    archiveChannel: async ({ home, token, channel }) => channelTransport({ home, token }).archiveChannel({ channel }),
    botToken: ({ home }) => slackBotToken({ home }),
    createChannel: async ({ home, token, name, isPrivate }) =>
      channelTransport({ home, token }).createChannel({ isPrivate, name }),
    doorLedger: doorLedgerPort(),
    emit: (line) => {
      logger.out({ line });
    },
    env: () => process.env,
    inviteToChannel: async ({ home, token, channel, userIds }) =>
      channelTransport({ home, token }).inviteToChannel({ channel, userIds }),
    resolvePeople: freshSlackIdsNow,
    setPurpose: async ({ home, token, channel, purpose }) =>
      channelTransport({ home, token }).setChannelPurpose({ channel, purpose }),
    recordVoicePainPoints: ({ findings, home, lane }) => {
      recordExactVoicePainPoints({ findings, home, lane, tsIso: new Date().toISOString() });
    },
    setTopic: async ({ home, token, channel, topic }) =>
      channelTransport({ home, token }).setChannelTopic({ channel, topic }),
    userToken: ({ home }) => slackUserToken({ home }),
    voiceRules: ({ home }) => readExactVoiceRules({ home }),
  };
}
