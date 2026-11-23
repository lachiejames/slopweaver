/**
 * The holds `slack draft record` weighs on WHO a recording reaches, after its message is prepared and before
 * anything is read or stored for the row: whether a chase should reach the team at all (`./draftSettledChase.ts`),
 * whether an as-me finding may carry their name, and whether a review ask is a second one to the same person in a day.
 * Each reads only what its own rule needs, and only once it applies.
 */
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { foldSlackDraftLog, parseSlackDraftLog } from "../../../outbound/slack/draftLog.js";
import type { BotCannotPost } from "../../../outbound/slack/draftRegister.js";
import {
  pullRequestsLinked,
  reviewAskDmChannels,
  samePersonDayRefusal,
} from "../../../outbound/slack/draftSamePersonDay.js";
import {
  findingIdentityApplies,
  findingIdentityRefusal,
  readBotMembership,
  undeclaredKindRefusal,
} from "../../../outbound/slack/findingIdentity.js";
import type { ConversationSurface, SlackDripMessagePayload } from "../../../outbound/slack/types.js";
import type { DraftRecordOptions } from "./draftCore.js";
import { NOTHING_PARKED } from "./draftMedia.js";
import type { ConversationAnswer } from "./draftRecordReads.js";
import type { SlackDraftDeps } from "./draftRun.js";
import { settledChaseHold } from "./draftSettledChase.js";

/**
 * Every hold, in the order a recording meets them: a chase on a closed or merged pull request first (it spends the team's
 * attention for nothing), a second review ask to one person next, then whether an as-me
 * finding may carry their name.
 *
 * @param deps the injected world, for the pull-request read, the register, the clock, the `D…` member reads and the
 * bot's membership
 * @param options the parsed record
 * @param payload the one message the draft would post
 * @param readInfo `conversations.info` on the recording's own channel, memoised
 * @param token the user token any member read goes out under
 * @returns the reason the bot cannot post there, nothing when no rule applies, or the first refusal
 */
export async function whoItReachesHolds({
  deps,
  options,
  payload,
  readInfo,
  token,
}: {
  deps: Pick<
    SlackDraftDeps,
    "botMembership" | "botToken" | "conversationInfo" | "nowIso" | "pullRequestState" | "readLog"
  >;
  options: DraftRecordOptions;
  payload: SlackDripMessagePayload;
  readInfo: () => Promise<ConversationAnswer>;
  token: string;
}): Promise<Result<BotCannotPost | undefined>> {
  const settled = await settledChaseHold({ deps, options, payload });
  if (settled.isErr()) {
    return err(settled.error);
  }
  const samePerson = await samePersonDayHold({ deps, options, payload, readInfo, token });
  if (samePerson.length > 0) {
    return err(samePerson);
  }
  return asMeIdentity({ deps, options, readSurface: async () => (await readInfo()).surface });
}

/**
 * Whether an as-me recording may carry their name — owner rule: a finding shared at the top level of a
 * channel posts as the bot, and as them only where the bot cannot post.
 *
 * A top-level recording outside a DM must declare `--kind`, decided off the channel id, so a forgotten flag cannot
 * pass a finding off by its why's words. Anything else that is not a top-level finding reads nothing. A finding
 * refuses outright in a public channel (the bot posts into one it never joined), and in a private one asks Slack,
 * under the BOT token, whether the bot is in it: a `not-member` answer is recorded on the row as why it may be their,
 * and every other answer — the bot is there, or nobody could say — refuses (`../../../outbound/slack/findingIdentity.ts`).
 *
 * @param deps the injected world, for the bot token and the membership read
 * @param options the parsed record
 * @param readSurface the conversation's kind, off the recording's own memoised info read — asked only for a finding
 * @returns the reason the bot cannot post there, nothing when the rule does not apply, or the refusal
 */
export async function asMeIdentity({
  deps,
  options,
  readSurface,
}: {
  deps: Pick<SlackDraftDeps, "botMembership" | "botToken">;
  options: DraftRecordOptions;
  readSurface: () => Promise<ConversationSurface | undefined>;
}): Promise<Result<BotCannotPost | undefined>> {
  const { channel, kind, threadTs } = options;
  const undeclared = undeclaredKindRefusal({ channel, kind, threadTs });
  if (undeclared.length > 0) {
    return err([...undeclared, NOTHING_PARKED]);
  }
  // Past the declaration check, only a DM or a thread reply lacks a kind, and neither is governed.
  const isFinding = kind === "finding";
  if (!isFinding || threadTs !== undefined) {
    return ok(undefined);
  }
  const surface = await readSurface();
  if (!findingIdentityApplies({ isFinding, surface, threadTs })) {
    return ok(undefined);
  }
  // Only a private channel can be one the bot cannot post in, so nothing else costs the membership read.
  const botToken = deps.botToken({ home: options.home });
  const botMembership = await readBotMembership({ botToken, channel, read: deps.botMembership, surface });
  const refusal = findingIdentityRefusal({ actor: "me", botMembership, channel, isFinding, surface, threadTs });
  if (refusal.length > 0) {
    return err([...refusal, NOTHING_PARKED]);
  }
  return ok("not-in-channel");
}

/**
 * Review asks to one person inside a day are ONE batch DM (`../../../outbound/slack/draftSamePersonDay.ts` holds the
 * rule and the owner's words): a top-level `--act review-ask` in a 1:1 DM refuses beside one already held for that
 * person, or as a single beside one already sent them today. Runs after the preparation, because `--form -` is only
 * read there and a batch is told apart by the pull requests its prepared message links. A `D…` row Slack cannot
 * resolve is left out, and said so on stderr rather than guessed.
 *
 * @param deps the injected world, for the register, the clock and the `D…` member reads
 * @param options the parsed record
 * @param payload the one message the draft would post
 * @param readInfo `conversations.info` on the recording's own channel, memoised
 * @param token the user token any member read goes out under
 * @returns the hold's lines, or nothing when the ask may park or the rule does not apply
 */
export async function samePersonDayHold({
  deps,
  options,
  payload,
  readInfo,
  token,
}: {
  deps: Pick<SlackDraftDeps, "conversationInfo" | "nowIso" | "readLog">;
  options: DraftRecordOptions;
  payload: SlackDripMessagePayload;
  readInfo: () => Promise<ConversationAnswer>;
  token: string;
}): Promise<readonly string[]> {
  const { act, actor, channel, home, supersedes, threadTs } = options;
  if (act !== "review-ask" || actor !== "me" || threadTs !== undefined) {
    return [];
  }
  let member: string | undefined;
  if (/^[UW][A-Z0-9]+$/.test(channel)) {
    member = channel;
  } else if (/^D[A-Z0-9]+$/.test(channel)) {
    member = (await readInfo()).user;
    if (member === undefined) {
      logger.warn({
        msg: `slack draft record: could not resolve whose DM ${channel} is, so the one-batch-per-person rule was not applied`,
      });
    }
  }
  if (member === undefined) {
    return [];
  }
  const nowIso = deps.nowIso();
  const items = foldSlackDraftLog({ log: parseSlackDraftLog({ lines: deps.readLog({ home }) }) });
  const dmUsers = new Map<string, string>();
  for (const dm of reviewAskDmChannels({ items, nowIso })) {
    const { user } = await deps.conversationInfo({ channel: dm, token });
    if (user === undefined) {
      logger.warn({
        msg: `slack draft record: could not resolve whose DM ${dm} is, so its review asks were not weighed`,
      });
    } else {
      dmUsers.set(dm, user);
    }
  }
  const refusal = samePersonDayRefusal({
    dmUsers,
    items,
    member,
    nowIso,
    pullRequests: pullRequestsLinked({ payload }),
    supersedes,
  });
  if (refusal.length === 0) {
    return [];
  }
  return [...refusal, NOTHING_PARKED];
}
