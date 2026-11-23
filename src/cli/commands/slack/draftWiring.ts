/**
 * The production wiring for `slopweaver slack draft` — every edge {@link SlackDraftDeps} declares, resolved
 * against the real world.
 *
 * Separated from `./draftRun.ts` for the reason `./writeWiring.ts` is separated from `./run.ts`: the shell
 * is the ORDER of the steps, and nothing in it may name a token store, a profile file or a transport. It
 * imports its own contract as a TYPE, so there is no cycle at run time.
 *
 * **What is absent is the point.** There is no `makeApi`, no `proveRender` and no `readMedia` here, because
 * `SlackDraftDeps` declares none: the live calls are `conversations.info`, `auth.test`, a reply's
 * `conversations.replies` and — for a form that mentions anybody — `conversations.members`, all reads — under the
 * bot token for a `--as bot` recording, and for the membership
 * read an as-me finding in a channel is judged on — plus `context`'s one `conversations.history` page, and one GitHub
 * GraphQL read per pull request a `bump` or `review-ask` links, so a chase on a closed one is refused. A future edit
 * that wanted to post from this verb would have to add the edge to the type first, in a diff that says so.
 * `--media` adds two edges that cannot post either: `prepareMedia` reads the files and runs `slack post
 * --media`'s own admission, `storeMedia` keeps the admitted bytes in the private draft-media store.
 */
import { join } from "node:path";
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { recordExactVoicePainPoints } from "../../../admit/painPoint.js";
import { storeSlackDraftMedia } from "../../../admit/slackDraftMediaStore.js";
import {
  appendSlackDraftEvent,
  holdSlackDraftLock,
  mintSlackDraftId,
  readSlackDraftLines,
} from "../../../admit/slackDraftStore.js";
import { slackBotToken, slackUserToken, slopweaverHome } from "../../../config.js";
import { readOrgChart } from "../../../corpus/members/orgChartStore.js";
import { readAllMembers } from "../../../corpus/members/store.js";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import { makeSlackMembershipReader, makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { makeSlackAccountReader } from "../../../corpus/slack/writeApiAccount.js";
import { CONSOLE_URL_ENV, consoleBaseFrom } from "../../../hand/consoleLink.js";
import { resolveRawWords } from "../../../handover/hisWordsResolve.js";
import { logger } from "../../../lib/logger.js";
import { readStdin } from "../../../lib/readStdin.js";
import { err, ok } from "../../../lib/result.js";
import { slackTsFromEpochMs } from "../../../lib/slackTs.js";
import { approvedScheduledChannelsOf } from "../../../live/automation/approvedChannels.js";
import { readPullRequestState } from "../../../live/github/pullRequestState.js";
import { fetchCompleteSlackThread } from "../../../live/slack/pagination.js";
import { SlackDraftErrors } from "../../../outbound/slack/draftErrors.js";
import { botMembershipOf } from "../../../outbound/slack/findingIdentity.js";
import { mentionsFromIdentity } from "../../../outbound/slack/mentionWiring.js";
import { ownerUserIdFromProfile, readExactVoiceRules } from "../../../profileStore.js";
import { identityRosterPort } from "../../../silver/identityRoster.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { readApprovalLaterRelays } from "../../../talk/approvalRelayRead.js";
import { fenceCallWrites } from "../../../talk/callFence.js";
import { readRelayLedger } from "../../../talk/relayStore.js";
import { prepareMediaPaths } from "../../../visualEvidence/prepareUploads.js";
import { bareRefContext as bareRefContextFor } from "../../bareRefContext.js";
import { readLandedDraftBindings } from "../supervisor/landedCardReads.js";
import { liveDraftComparisonDeps } from "./draftComparisonWiring.js";
import type { DraftCorrectionsDeps } from "./draftCorrectionsRun.js";
import type { SlackDraftDeps } from "./draftRun.js";
import { liveHighStakesDeps } from "./highStakesRead.js";
import { liveReadPriorAsk } from "./priorAskWiring.js";
import { liveVerifiedOwnDm } from "./verifiedOwnDm.js";
import { liveWallRun } from "./wallRunRead.js";
import { chromeFromProfile, dripConfigFromProfile, promptChannelFromProfile } from "./wiring.js";

/** The conversation a draft lands in, read live: a thread whole, or one page of the channel's rows up to `through`. */
const readDraftConversation: SlackDraftDeps["readConversation"] = async ({
  channel,
  limit,
  threadTs,
  through,
  token,
}) => {
  const api = makeSlackApi({ token });
  try {
    const workspaceUrl = await api.workspaceUrl();
    if (workspaceUrl === undefined) {
      return err(SlackDraftErrors.contextUnreadable({ cause: "auth.test returned no workspace url", channel }));
    }
    if (threadTs !== undefined) {
      const thread = await fetchCompleteSlackThread({ api, channel, threadTs });
      if (thread.isErr()) {
        return err(SlackDraftErrors.contextUnreadable({ cause: thread.error.message, channel }));
      }
      return ok({ hasMore: false, rows: thread.value.rawMessages, workspaceUrl });
    }
    if (through !== undefined) {
      // One page, newest first, ending AT `through`: what a recording read, whatever was posted since.
      const page = await api.history({ channel, inclusive: true, latest: through, oldest: "0", pageSize: limit });
      return ok({ hasMore: page.hasMore === true, rows: page.messages, workspaceUrl });
    }
    // One page, newest first: the channel tail up to the moment it is read.
    const latest = slackTsFromEpochMs({ ms: Date.now() });
    const page = await api.history({ channel, latest, oldest: "0", pageSize: limit });
    return ok({ hasMore: page.hasMore === true, rows: page.messages, workspaceUrl });
  } catch (error) {
    return err(SlackDraftErrors.contextUnreadable({ cause: error, channel }));
  }
};

/** The two local reads `slack draft corrections` joins: their exact voice rules and the relay ledger. */
function liveDraftCorrectionsDeps(): DraftCorrectionsDeps {
  return {
    readSteerReceipts: ({ home }) => readRelayLedger({ home }),
    readVoiceRules: ({ home }) => readExactVoiceRules({ home }),
  };
}

/** A thread's every reply, read whole or refused as unreadable — never a prefix taken for the whole. */
const liveThreadReplies: SlackDraftDeps["threadReplies"] = async ({ channel, threadTs, token }) => {
  try {
    const thread = await fetchCompleteSlackThread({ api: makeSlackApi({ token }), channel, threadTs });
    if (thread.isErr()) {
      return err(SlackDraftErrors.threadUnreadable({ cause: thread.error.message, channel, threadTs }));
    }
    return ok(thread.value.rawMessages);
  } catch (error) {
    return err(SlackDraftErrors.threadUnreadable({ cause: error, channel, threadTs }));
  }
};

/** The conversation and identity reads `slack draft` makes through the write transport and the membership reader. */
function liveConversationDeps(): Pick<
  SlackDraftDeps,
  "botMembership" | "conversationInfo" | "conversationMembership" | "conversationSurface" | "whoAmI"
> {
  return {
    botMembership: async ({ channel, token }) =>
      botMembershipOf({
        isMember: (await makeSlackWriteTransport({ home: slopweaverHome(), token }).conversationInfo({ channel }))
          .isMember,
      }),
    conversationInfo: async ({ channel, token }) =>
      makeSlackWriteTransport({ home: slopweaverHome(), token }).conversationInfo({ channel }),
    conversationMembership: async ({ channel, home, token }) => makeSlackMembershipReader({ home, token })({ channel }),
    conversationSurface: async ({ channel, token }) =>
      (await makeSlackWriteTransport({ home: slopweaverHome(), token }).conversationInfo({ channel })).surface,
    whoAmI: async ({ token }) => makeSlackWriteTransport({ home: slopweaverHome(), token }).whoAmI(),
  };
}

/**
 * The real world, wired, with no way to put bytes into Slack.
 *
 * @returns the dependency bag `slack draft` runs against
 */
export function liveSlackDraftDeps(): SlackDraftDeps {
  // One bag per verb call, so this is the send's ask instant — what the roster's freshness is judged against.
  const askedAtIso = new Date().toISOString();
  return {
    ...liveHighStakesDeps(),
    ...liveDraftCorrectionsDeps(),
    ...liveDraftComparisonDeps(),
    ...liveConversationDeps(),
    appendEvent: ({ event, home }) => appendSlackDraftEvent({ event, home }),
    lockRegister: ({ home }) => holdSlackDraftLock({ home }),
    approvedScheduledChannels: ({ home }) => approvedScheduledChannelsOf({ home }),
    bareRefContext: ({ home }) => bareRefContextFor({ home }),
    botToken: ({ home }) => slackBotToken({ home }),
    chrome: ({ home }) => chromeFromProfile({ home }),
    consoleBase: () => consoleBaseFrom({ configured: process.env[CONSOLE_URL_ENV] }),
    doorEnv: () => process.env,
    doorLedger: doorLedgerPort(),
    dripConfig: ({ home }) => dripConfigFromProfile({ home }),
    loadMembers: ({ home }) => readAllMembers({ home }),
    loadOrgChart: ({ home }) => readOrgChart({ home }),
    mintId: () => mintSlackDraftId(),
    nowIso: () => new Date().toISOString(),
    out: (line) => {
      logger.out({ line });
    },
    ownerUserId: ({ home }) => ownerUserIdFromProfile({ home }),
    prepareMedia: async ({ env, home, nowIso, paths }) => prepareMediaPaths({ env, home, nowIso, paths }),
    promptChannel: ({ home }) => promptChannelFromProfile({ home }),
    verifiedOwnDm: liveVerifiedOwnDm,
    readApprovalLaterRelays,
    readConversation: readDraftConversation,
    readOwnerWords: ({ anchor, home }) =>
      resolveRawWords({ anchor, home, projectsDir: join(claudeHomeDir(), "projects") }),
    fenceCallWrites: (args) => fenceCallWrites(args).mapErr((error) => error.message),
    readLandedDrafts: readLandedDraftBindings,
    readLog: ({ home }) => readSlackDraftLines({ home }),
    readPriorAsk: liveReadPriorAsk,
    pullRequestState: async ({ home, number, repo }) =>
      readPullRequestState({ home, number, repo, subject: "pull-request" }),
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
    storeMedia: ({ home, uploads }) => storeSlackDraftMedia({ home, uploads }),
    taggedAccount: async ({ home, token, user }) => makeSlackAccountReader({ home, token })({ user }),
    threadReplies: liveThreadReplies,
    userToken: ({ home }) => slackUserToken({ home }),
    wallRun: liveWallRun,
  };
}
