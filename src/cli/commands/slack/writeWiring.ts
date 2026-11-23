/**
 * The production wiring for `slopweaver slack post|reply` — every edge {@link SlackWriteDeps} declares,
 * resolved against the real world.
 *
 * Separated from `./run.ts`'s shell when owner turn 291-8x added a fifth store-backed seam and that file
 * crossed its size ratchet. The seam it split on is the one the shell's own header already draws: `run.ts`
 * is the ORDER of the steps and what each refusal costs, and nothing in it may name a token store, a
 * profile file or a transport. This file is the other half — every name `run.ts` is forbidden to know — so
 * a new dependency lands here and a new STEP lands there.
 *
 * It imports its own contract as a TYPE, which is why there is no cycle: `run.ts` imports this factory as
 * a value and gets nothing back at run time.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { recordExactVoicePainPoints } from "../../../admit/painPoint.js";
import { readSlackDraftMedia } from "../../../admit/slackDraftMediaStore.js";
import { appendSlackDraftEvent, readSlackDraftLines } from "../../../admit/slackDraftStore.js";
import { autonomyLedgerPort } from "../../../autonomy/port.js";
import { slackBotToken, slackUserToken, slopweaverHome } from "../../../config.js";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import {
  makeSlackMembershipReader,
  makeSlackWriteApi,
  makeSlackWriteTransport,
} from "../../../corpus/slack/writeApi.js";
import { makeSlackAccountReader } from "../../../corpus/slack/writeApiAccount.js";
import { logger } from "../../../lib/logger.js";
import { readStdin } from "../../../lib/readStdin.js";
import { err } from "../../../lib/result.js";
import { slackTsFromEpochMs } from "../../../lib/slackTs.js";
import { approvedScheduledChannelsOf } from "../../../live/automation/approvedChannels.js";
import { fetchCompleteSlackHistory, fetchCompleteSlackThread } from "../../../live/slack/pagination.js";
import { botMembershipOf } from "../../../outbound/slack/findingIdentity.js";
import { mentionsFromIdentity } from "../../../outbound/slack/mentionWiring.js";
import { addressedToPerson } from "../../../outbound/slack/placement.js";
import { ownerUserIdFromProfile, readExactVoiceRules } from "../../../profileStore.js";
import { identityRosterPort } from "../../../silver/identityRoster.js";
import { imageAdmitFor } from "../../../visualEvidence/prepareUploads.js";
import { bareRefContext as bareRefContextFor } from "../../bareRefContext.js";
import { runRenderProof } from "./dripSendPlan.js";
import { liveHighStakesDeps } from "./highStakesRead.js";
import { liveReadPriorAsk } from "./priorAskWiring.js";
import type { SlackWriteDeps } from "./run.js";
import { liveReadiness } from "./uploadReadiness.js";
import { liveVerifiedOwnDm } from "./verifiedOwnDm.js";
import { liveWallRun } from "./wallRunRead.js";
import { chromeFromProfile, dripConfigFromProfile, promptChannelFromProfile } from "./wiring.js";

/** How many top-level pages a release walks from its watermark before calling the change set unreadable. */
const RELEASE_HISTORY_PAGES = 5;

/**
 * Where a release is about to land, read live and WHOLE: a thread, or the channel's top-level messages from the
 * row's watermark on, `oldest` itself included, walked to cursor exhaustion. A partial read is refused rather than
 * judged — it proves the conversation moved, but not what moved past it, and a `--thread-moved-cleared` set checked
 * against a prefix would clear changes nobody read — so a draft further behind than the page budget is withdrawn and
 * re-drafted, never cleared. Completeness is Slack's cursor, never a row count (`../../../live/slack/pagination.ts`).
 *
 * A row addressed to a PERSON names no conversation a read can take, so its DM is resolved first with
 * `conversations.open` — idempotent by Slack's guarantee, and the same conversation the send itself posts into.
 */
const readReleaseConversation: SlackWriteDeps["readReleaseConversation"] = async ({
  channel: address,
  home,
  oldest,
  threadTs,
  token,
}) => {
  const api = makeSlackApi({ token });
  try {
    let channel = address;
    if (addressedToPerson({ address: { channel: address } })) {
      const opened = await makeSlackWriteTransport({ home, token }).openConversation({
        userIds: [address],
      });
      channel = opened.id;
    }
    if (threadTs !== undefined) {
      const thread = await fetchCompleteSlackThread({ api, channel, threadTs });
      return thread.map((value) => value.rawMessages).mapErr((error) => error.message);
    }
    // The paginator needs a fixed upper bound, so a message posted after this instant and before the send is unseen:
    // the check-then-act residue Slack's lack of a conditional post leaves anyway, starting at the read, not after it.
    const latest = slackTsFromEpochMs({ ms: Date.now() });
    const history = await fetchCompleteSlackHistory({
      api,
      channel,
      inclusive: true,
      latest,
      maxPages: RELEASE_HISTORY_PAGES,
      oldest,
    });
    return history
      .map((value) => value.rawMessages)
      .mapErr(
        (error) =>
          `${error.message} — the change set cannot be read whole, so it cannot be cleared: withdraw it with ` +
          "`slack draft drop` and re-draft",
      );
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
};

/** The live write API for one lane, whose high-stakes door and image admit both read that lane's `home`. */
const liveWriteApi = ({ home, token }: { home: string; token: string }) =>
  makeSlackWriteApi({
    admit: imageAdmitFor({ env: process.env, home, nowIso: new Date().toISOString() }),
    home,
    readiness: liveReadiness({ token }),
    token,
  });

/**
 * The production wiring.
 *
 * `botToken` goes through `config.slackBotToken` — the ONE resolver that knows the token may live in
 * `$home/secrets/slack-bot-token` as well as the environment. Reading `process.env` here instead was a
 * shipped defect: `secrets set slack-bot-token` worked, and the write path then claimed no token existed.
 *
 * @returns the real world, wired
 */
export function productionSlackWriteDeps(): SlackWriteDeps {
  // One bag per verb call, so this is the send's ask instant — what the roster's freshness is judged against.
  const askedAtIso = new Date().toISOString();
  return {
    ...liveHighStakesDeps(),
    autonomy: autonomyLedgerPort(),
    bareRefContext: ({ home }) => bareRefContextFor({ home }),
    botToken: ({ home }) => slackBotToken({ home }),
    chrome: ({ home }) => chromeFromProfile({ home }),
    doorEnv: () => process.env,
    doorLedger: doorLedgerPort(),
    dripConfig: ({ home }) => dripConfigFromProfile({ home }),
    approvedScheduledChannels: ({ home }) => approvedScheduledChannelsOf({ home }),
    promptChannel: ({ home }) => promptChannelFromProfile({ home }),
    verifiedOwnDm: liveVerifiedOwnDm,
    ownerUserId: ({ home }) => ownerUserIdFromProfile({ home }),
    makeApi: ({ token, home }) => liveWriteApi({ home, token }),
    out: (line) => {
      logger.out({ line: line });
    },
    readMedia: async ({ path }) => ({ bytes: await readFile(path), filename: basename(path) }),
    readStdin,
    recordVoicePainPoints: ({ findings, home, lane }) => {
      recordExactVoicePainPoints({ findings, home, lane, tsIso: new Date().toISOString() });
    },
    resolveMentions: ({ conversationMembers, groups, home, people }) =>
      mentionsFromIdentity({
        askedAtIso,
        conversationMembers,
        groups,
        home,
        identityRoster: identityRosterPort(),
        people,
      }),
    conversationMembership: async ({ channel, home, token }) => makeSlackMembershipReader({ home, token })({ channel }),
    taggedAccount: async ({ home, token, user }) => makeSlackAccountReader({ home, token })({ user }),
    userToken: ({ home }) => slackUserToken({ home }),
    voiceRules: ({ home }) => readExactVoiceRules({ home }),
    ...liveConversationReads(),
    proveRender: async ({ channel, payload, token, home }) =>
      runRenderProof({ api: liveWriteApi({ home, token }), channel, payload }),
    // A direct reference, not a re-spelling of the argument list. An adapter that names each field is a
    // place a field can be DROPPED or hardcoded, and a Codex review pass found exactly that mutant: pinning
    // `actor: "bot"` here typechecks and leaves all 105 tests in the three touched files green, while
    // production refuses every `--as me` drip over the owner's own earlier replies. There is no adapter to
    // get wrong now, which is stronger than a test for it.
    wallRun: liveWallRun,
    readDraftLog: ({ home }) => readSlackDraftLines({ home }),
    readReleaseConversation,
    readPriorAsk: liveReadPriorAsk,
    readDraftMedia: ({ home, media }) => readSlackDraftMedia({ home, media }),
    appendDraftEvent: ({ event, home }) => appendSlackDraftEvent({ event, home }),
    ...liveAccountReads(),
  };
}

/** One live transport for a token's READS, which never consult the write policy, so the ambient home serves. */
const transport = ({ token }: { token: string }) => makeSlackWriteTransport({ home: slopweaverHome(), token });

/** The deps answered by one live `conversations.info` call each: the conversation's surface, group-DM flag, membership. */
function liveConversationReads(): Pick<
  SlackWriteDeps,
  "botMembership" | "conversationGroupDm" | "conversationSurface"
> {
  return {
    conversationSurface: async ({ channel, token }) =>
      (await transport({ token }).conversationInfo({ channel })).surface,
    conversationGroupDm: async ({ channel, token }) =>
      (await transport({ token }).conversationInfo({ channel })).groupDm,
    botMembership: async ({ channel, token }) =>
      botMembershipOf({ isMember: (await transport({ token }).conversationInfo({ channel })).isMember }),
  };
}

/** The deps answered by the token's own account: who it is, what channel it can see, and joining one. */
function liveAccountReads(): Pick<SlackWriteDeps, "channelAccess" | "joinChannel" | "whoAmI"> {
  return {
    whoAmI: async ({ token }) => transport({ token }).whoAmI(),
    channelAccess: async ({ channel, token }) => {
      const info = await transport({ token }).conversationInfo({ channel });
      return { isMember: info.isMember, name: info.name, surface: info.surface };
    },
    joinChannel: async ({ channel, confirm, home, token }) =>
      makeSlackWriteTransport({ home, token }).joinChannel({ channel, confirm }),
  };
}
