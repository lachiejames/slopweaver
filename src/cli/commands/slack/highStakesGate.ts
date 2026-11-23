/**
 * The high-stakes channel gate as every lane that can put a top-level message in a channel asks it: the card
 * lane after admission, the as-me lane inside `./wallCheck.ts`'s `planDripChecked` (so a fresh send, a draft
 * recorder and a draft release all ask it), `slack poll`, `slack edit` on both lanes, and the bot's turn lane at
 * `turn brief` (`../turn/briefHighStakes.ts`), whose every post replies under the thread that brief names.
 * Whatever lane a reply comes from, the write transport confirms its thread before the wire
 * (`../../../corpus/slack/writeGuardHighStakes.ts`).
 *
 * The policy is `../../../outbound/slack/highStakesChannel.ts`; this file only reads the two hatches, the
 * profile, a `--thread-ts`'s parent and — only for a send the undefended check let through — the channel's last day.
 */
import { hatchOpen } from "../../../hatch/open.js";
import type { Result } from "../../../lib/result.js";
import {
  type ChannelClaim,
  type FleetHistory,
  type HighStakesChannel,
  highStakesChannelOf,
  secondPostRefusal,
  type ThreadAnchor,
  topLevelPostsOf,
  undefendedPostRefusal,
  unlistedChannelRefusal,
} from "../../../outbound/slack/highStakesChannel.js";
import type { HighStakesConfig, ProfileReadError } from "../../../profileStore.js";
import type { SlackDripPlan } from "./dripCore.js";

/** The reads this gate performs, and nothing else. Live wiring: `./highStakesRead.ts`'s `liveHighStakesDeps`. */
export interface HighStakesDeps {
  /**
   * The install's high-stakes channels and the user ids the fleet posts as, from `profile.json`
   * (`slackHighStakes`, `slackBot`). A corrupt profile is `err`, which the gate refuses on.
   */
  readonly highStakes: (args: { home: string }) => Result<HighStakesConfig, ProfileReadError>;
  /**
   * The fleet's own top-level posts in one high-stakes channel over the last day, live. Asked only for a
   * top-level send the undefended check let through; an unreadable history is `unread`, which refuses.
   */
  readonly fleetHistory: (args: {
    token: string;
    channel: string;
    fleetUserIds: readonly string[];
    nowMs: number;
  }) => Promise<FleetHistory>;
  /** Whether a `--thread-ts` into a high-stakes channel is a real top-level message there, live. */
  readonly threadAnchor: (args: { token: string; channel: string; threadTs: string }) => Promise<ThreadAnchor>;
  /**
   * The channel's claim (`../../../outbound/slack/highStakesClaim.ts`): TAKEN by a live send before it reads the
   * day, only looked at otherwise, so two sends reading the same empty day cannot both post.
   */
  readonly channelClaim: (args: { home: string; channel: string; nowIso: string; take: boolean }) => ChannelClaim;
  /** Drop the claim this send took, by its id, once the day it read has refused the send. */
  readonly releaseChannelClaim: (args: { home: string; channel: string; claimId: string }) => void;
}

/** The one line a refusal of a profile that cannot be read carries. */
function unreadableProfileLine({ error }: { error: ProfileReadError }): string {
  return `the high-stakes channel list could not be read, so nothing was posted: ${error.message}`;
}

/**
 * Refuse a top-level post to a high-stakes channel that is not a finding card, or that follows another fleet
 * top-level post there inside a day.
 *
 * A profile that cannot be read REFUSES, naming why: the answer decides what may be sent, and a corrupt profile
 * read as "no channels are high-stakes" is the open gate this exists to close, and so does a home with no profile
 * at all, for any send to a channel. A `--thread-ts` exempts a send only once Slack confirms it names a top-level
 * message in that channel; one naming nothing, or one that could not be read, is judged as the top-level post it
 * may become.
 *
 * Every lane asks this twice. Before its dry-run branch it only LOOKS at the channel's claim; right before the
 * live send it asks again with `claim: true`, which takes the claim ahead of the day read, so a second send racing
 * it is refused rather than reading the same empty day.
 *
 * @param deps the profile read, the channel claim and the live channel reads
 * @param env the environment the two hatches are read from
 * @param home the Slopweaver home, for the profile, the claims and the journalled hatch grants
 * @param channel where the send is aimed, as the caller spelled it
 * @param threadTs the thread it replies into, absent for a top-level post
 * @param formKind the bot form kind, absent for an as-me post
 * @param token the token this send will use, which the live reads go out under
 * @param claim true only immediately before a live send: take the channel's claim rather than look at it
 * @param topLevelPosts how many top-level posts this one send makes (`topLevelPostsOf`); a card or a poll makes one
 * @returns the refusal lines, or empty when the send may proceed
 */
export async function highStakesRefusals({
  deps,
  env,
  home,
  channel,
  threadTs,
  formKind,
  token,
  claim,
  topLevelPosts = 1,
}: {
  deps: HighStakesDeps;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  channel: string;
  threadTs: string | undefined;
  formKind: string | undefined;
  token: string;
  claim: boolean;
  topLevelPosts?: number;
}): Promise<readonly string[]> {
  const config = deps.highStakes({ home });
  if (config.isErr()) {
    return [unreadableProfileLine({ error: config.error })];
  }
  const unlisted = unlistedChannelRefusal({ channel, listGap: config.value.listGap });
  if (unlisted.length > 0) {
    return unlisted;
  }
  const target = highStakesChannelOf({ channel, channels: config.value.channels });
  if (target === undefined) {
    return [];
  }
  const anchorNote = threadTs === undefined ? [] : await unanchoredReplyNote({ deps, target, threadTs, token });
  if (anchorNote === undefined) {
    return [];
  }
  const refusals = await topLevelRefusals({
    claim,
    deps,
    env,
    fleetGap: config.value.fleetGap,
    fleetUserIds: config.value.fleetUserIds,
    formKind,
    home,
    target,
    token,
    topLevelPosts,
  });
  return refusals.length === 0 ? [] : [...anchorNote, ...refusals];
}

/**
 * Why a reply is judged as a top-level post, or undefined when its thread is real and the reply is exempt.
 *
 * @param target the high-stakes channel the reply is aimed at
 * @param threadTs the thread it says it replies into
 * @returns the one line naming the unconfirmed thread, or undefined for a confirmed one
 */
async function unanchoredReplyNote({
  deps,
  target,
  threadTs,
  token,
}: {
  deps: HighStakesDeps;
  target: HighStakesChannel;
  threadTs: string;
  token: string;
}): Promise<readonly string[] | undefined> {
  const anchor = await deps.threadAnchor({ channel: target.id, threadTs, token });
  if (anchor.kind === "present") {
    return undefined;
  }
  const why = anchor.kind === "absent" ? "names no top-level message there" : `could not be read (${anchor.reason})`;
  return [`--thread-ts ${threadTs} in ${target.name} ${why}, so this send is judged as a top-level post`];
}

/**
 * The undefended check, then — only when it passes and the second-post hatch is shut — a send that would itself
 * make several top-level posts, the channel's claim and the live day read. A claim this send took is dropped again
 * when the day refuses it, since nothing was attempted.
 */
async function topLevelRefusals({
  claim,
  deps,
  env,
  fleetGap,
  fleetUserIds,
  formKind,
  home,
  target,
  token,
  topLevelPosts,
}: {
  claim: boolean;
  deps: HighStakesDeps;
  env: Readonly<Record<string, string | undefined>>;
  fleetGap: string | undefined;
  fleetUserIds: readonly string[];
  formKind: string | undefined;
  home: string;
  target: HighStakesChannel;
  token: string;
  topLevelPosts: number;
}): Promise<readonly string[]> {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const undefended = undefendedPostRefusal({
    allowUndefended: hatchOpen({ env, home, id: "high-stakes-undefended", nowIso }),
    formKind,
    target,
  });
  if (undefended.length > 0) {
    return undefended;
  }
  const allowSecondPost = hatchOpen({ env, home, id: "high-stakes-second-post", nowIso });
  if (allowSecondPost) {
    return [];
  }
  if (topLevelPosts > 1) {
    return secondPostRefusal({ allowSecondPost, history: { kind: "several", posts: topLevelPosts }, target });
  }
  if (fleetGap !== undefined) {
    return secondPostRefusal({ allowSecondPost, history: { kind: "unread", reason: fleetGap }, target });
  }
  const held = deps.channelClaim({ channel: target.id, home, nowIso, take: claim });
  const history = await historyUnderClaim({ deps, fleetUserIds, held, nowMs, target, token });
  const refusals = secondPostRefusal({ allowSecondPost, history, target });
  if (refusals.length > 0 && held.kind === "held") {
    deps.releaseChannelClaim({ channel: target.id, claimId: held.claimId, home });
  }
  return refusals;
}

/** The day's history as the claim leaves it: another send's claim or an unwritable one stands in for the read. */
async function historyUnderClaim({
  deps,
  fleetUserIds,
  held,
  nowMs,
  target,
  token,
}: {
  deps: HighStakesDeps;
  fleetUserIds: readonly string[];
  held: ChannelClaim;
  nowMs: number;
  target: HighStakesChannel;
  token: string;
}): Promise<FleetHistory> {
  if (held.kind === "taken") {
    return { claimedIso: held.claimedIso, kind: "claimed" };
  }
  if (held.kind === "unwritable") {
    return { kind: "unread", reason: `the channel's claim could not be taken or read: ${held.reason}` };
  }
  return deps.fleetHistory({ channel: target.id, fleetUserIds, nowMs, token });
}

/**
 * Refuse an EDIT of a top-level message in a high-stakes channel into anything but a finding card.
 *
 * An edit adds no message, so the second-post rule does not read it; but it can re-render a finding card into
 * an `update` card, or rewrite an as-me message, in place and past the undefended check a new post meets. A
 * message whose Slack `thread_ts` is another message's is a reply, and exempt. Synchronous: the read-back the
 * edit already made says where the message hangs.
 *
 * @param deps the profile read
 * @param env the environment the undefended hatch is read from
 * @param home the Slopweaver home
 * @param channel the channel the edited message sits in, as the caller spelled it
 * @param existing the edited message's own `ts` and, when it is a reply, its `thread_ts`
 * @param formKind the new bot form kind, absent for an as-me edit
 * @returns the refusal lines, or empty when the edit may proceed
 */
export function highStakesEditRefusals({
  deps,
  env,
  home,
  channel,
  existing,
  formKind,
}: {
  deps: Pick<HighStakesDeps, "highStakes">;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  channel: string;
  existing: { readonly ts: string; readonly threadTs?: string | undefined };
  formKind: string | undefined;
}): readonly string[] {
  const config = deps.highStakes({ home });
  if (config.isErr()) {
    return [unreadableProfileLine({ error: config.error })];
  }
  if (existing.threadTs !== undefined && existing.threadTs !== existing.ts) {
    return [];
  }
  const unlisted = unlistedChannelRefusal({ channel, listGap: config.value.listGap });
  if (unlisted.length > 0) {
    return unlisted;
  }
  return undefendedPostRefusal({
    allowUndefended: hatchOpen({ env, home, id: "high-stakes-undefended", nowIso: new Date().toISOString() }),
    formKind,
    target: highStakesChannelOf({ channel, channels: config.value.channels }),
  });
}

/**
 * {@link highStakesRefusals} as an as-me drip asks it right before its live send: TAKING the channel's claim before its
 * day is re-read, counting every top-level post the drip's shape makes.
 *
 * @param plan the drip about to go: its destination, its messages and its shape
 * @returns the refusal lines, or empty when the drip may go
 */
export async function claimDripHighStakes({
  deps,
  env,
  home,
  plan,
  token,
}: {
  deps: HighStakesDeps;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  plan: Pick<SlackDripPlan, "channel" | "messages" | "shape" | "threadTs">;
  token: string;
}): Promise<readonly string[]> {
  return highStakesRefusals({
    channel: plan.channel,
    claim: true,
    deps,
    env,
    formKind: undefined,
    home,
    threadTs: plan.threadTs,
    token,
    topLevelPosts: topLevelPostsOf({ messageCount: plan.messages.length, shape: plan.shape }),
  });
}
