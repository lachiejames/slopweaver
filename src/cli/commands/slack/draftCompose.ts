/**
 * The PURE half of `slopweaver slack draft record`: what a recording composes, with nothing that reads a
 * clock, mints an id, touches Slack or writes a file.
 *
 * Split out of `./draftRun.ts` so the three decisions that actually bind a draft — which drip options a
 * recording is allowed to be, which mentions survive a round trip, and what the owner's approval binds —
 * can be tested by calling them, rather than by driving a verb with a fake world around it.
 */
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type SlackDraftError, SlackDraftErrors } from "../../../outbound/slack/draftErrors.js";
import { receiptLinks } from "../../../outbound/slack/draftReceipts.js";
import {
  type BotCannotPost,
  type ParkedDraftKind,
  type ParkedDraftPayload,
  type ParkedMention,
  type ParkedPriorAsk,
  type ParkedReadThrough,
  type ParkedSlackDraft,
  type ParkedSlackDraftMedia,
  type ParkedThreadParent,
  parkedDraftDigest,
  THREAD_PARENT_MAX_CHARS,
} from "../../../outbound/slack/draftRegister.js";
import type { MentionResolution } from "../../../outbound/slack/mentionIndex.js";
import type { ParkedDraftReceipts } from "../../../outbound/slack/receiptsLine.js";
import { slackPermalink } from "../../../outbound/slack/renderCheck.js";
import type { ReviewerContext, ReviewerDeclaration } from "../../../outbound/slack/reviewAskShape.js";
import type { SlackDripOptions } from "./coreTypes.js";
import type { DraftRecordOptions } from "./draftCore.js";

/**
 * The drip options one recording composes.
 *
 * Every field but the ones the invocation carries is fixed, and that is the register's contract rather
 * than a default: a recording is always ONE message as them — a top-level `post`, or a `reply` under
 * `--thread-ts` — never a dry run, never a resend, and carries no media PATHS: a draft's attachments are
 * admitted and stored as bytes at recording (`./draftMedia.ts`), and a release serves those verified bytes
 * rather than reopening any path. A reply is `shape: "thread"` because `./dripRun.ts`'s `threadFor` drops
 * the thread from a `top-level` message, which is how a thread row would otherwise post into the channel.
 *
 * @param options the parsed invocation
 * @returns the options `prepareDrip` runs against
 */
export function recordDripOptions({ options }: { options: DraftRecordOptions }): SlackDripOptions {
  return {
    actor: "me",
    channel: options.channel,
    dryRun: false,
    home: options.home,
    json: options.json,
    media: [],
    resendUnconfirmed: false,
    reviewer: recordedReviewer({ reviewer: options.reviewer }),
    source: { json: options.formSource, kind: "form" },
    ...placementOptions({ threadTs: options.threadTs }),
  };
}

/**
 * The reviewer a recording hands the gate. A recording owes the declaration a DM review ask needs, so absent
 * reads `undeclared` here and only here, a Codex candidate prepared off that recording included: a direct post and a
 * release pass none.
 *
 * @param reviewer what `--reviewer` declared, if anything
 * @returns the declaration, or `undeclared`
 */
export function recordedReviewer({ reviewer }: { reviewer: ReviewerContext | undefined }): ReviewerDeclaration {
  if (reviewer === undefined) {
    return "undeclared";
  }
  return reviewer;
}

/**
 * The verb, shape and thread one parked message sends as — shared by the recording and the release, so the
 * two cannot disagree about where a row goes.
 *
 * @param threadTs the thread root, for a reply
 * @returns a top-level post, or a one-message reply into that thread
 */
export function placementOptions({
  threadTs,
}: {
  threadTs: string | undefined;
}): Pick<SlackDripOptions, "shape" | "verb" | "threadTs"> {
  if (threadTs === undefined) {
    return { shape: "top-level", verb: "post" };
  }
  return { shape: "thread", threadTs, verb: "reply" };
}

/** A conversation id a permalink can name — a channel, a private group or a DM — never a `U…` member id. */
const CONVERSATION_ID = /^[CGD][A-Z0-9]+$/;

/**
 * The thread root with its Slack permalink on it, when the recording's `auth.test` named a workspace and the
 * destination is a conversation id. A DM recorded against a member id would give `archives/U…`, an address Slack
 * does not serve, so that row keeps no link rather than a wrong one. The link names the ROOT, so it opens the
 * channel at the message with its thread beside it — the messages before and after, which is what the card is for.
 *
 * @param parent the root as the recording read it, or nothing on a top-level row
 * @param channel the conversation the reply goes into
 * @param threadTs the root's `ts`
 * @param workspaceUrl `auth.test`'s `url`, absent when Slack did not say
 * @returns the root, with its permalink when one can be built
 */
export function withThreadPermalink({
  parent,
  channel,
  threadTs,
  workspaceUrl,
}: {
  parent: ParkedThreadParent | undefined;
  channel: string;
  threadTs: string | undefined;
  workspaceUrl: string | undefined;
}): ParkedThreadParent | undefined {
  if (parent === undefined || threadTs === undefined || workspaceUrl === undefined) {
    return parent;
  }
  if (!CONVERSATION_ID.test(channel) || !workspaceUrl.startsWith("https://")) {
    return parent;
  }
  return { ...parent, permalink: slackPermalink({ channel, threadTs: undefined, ts: threadTs, workspaceUrl }) };
}

/**
 * The thread root a reply is recorded under, off the first page `conversations.replies` answered for it — or
 * why the named `ts` is not one a reply can go under.
 *
 * Slack answers a thread's replies with the ROOT first, so a first message whose `ts` is not the one asked for
 * means the caller named a reply inside the thread rather than its root; a reply posted under that `ts` would
 * not land where the recorder meant. An empty answer means there is no such message in this channel.
 *
 * @param channel the conversation, for the refusal
 * @param messages the page's messages, unparsed, in Slack's order
 * @param threadTs the root the recorder named
 * @returns the root's author and text, cut to {@link THREAD_PARENT_MAX_CHARS}, or the refusal
 */
export function threadParentFrom({
  channel,
  messages,
  threadTs,
}: {
  channel: string;
  messages: readonly unknown[];
  threadTs: string;
}): Result<ParkedThreadParent, SlackDraftError> {
  const [root] = messages;
  if (!isRecord(root)) {
    return err(SlackDraftErrors.threadNotFound({ channel, threadTs }));
  }
  const ts = root["ts"];
  if (ts !== threadTs) {
    return err(SlackDraftErrors.threadNotRoot({ rootTs: String(ts), threadTs }));
  }
  const text = typeof root["text"] === "string" ? root["text"] : "";
  const user = root["user"];
  return ok({
    text: text.length > THREAD_PARENT_MAX_CHARS ? `${text.slice(0, THREAD_PARENT_MAX_CHARS - 1)}…` : text,
    ...(typeof user === "string" ? { userId: user } : {}),
  });
}

/**
 * Flatten a mention resolution into the rows a parked draft carries.
 *
 * The Maps do not survive JSON, and a draft whose mentions were dropped would render as plain text on
 * release while looking identical here. A group the index could not address contributes nothing rather
 * than a row pointing at no one.
 *
 * @param resolution every mention the form named, already resolved
 * @returns one row per addressable person and group, people first
 */
export function parkedMentions({ resolution }: { resolution: MentionResolution }): readonly ParkedMention[] {
  const people = [...resolution.resolved].map(([key, target]): ParkedMention => ({
    key,
    kind: "person",
    target: target.slackId,
  }));
  const groups = [...resolution.groupAddresses].flatMap(([key, address]): readonly ParkedMention[] => {
    if (address.kind !== "addressable") {
      return [];
    }
    return [{ key, kind: "group", target: address.group.id }];
  });
  return [...people, ...groups];
}

/**
 * Assemble the row, digest included, from what the preparation and the two reads answered.
 *
 * The digest is computed HERE, over the very object the row spreads, so the bytes their approval binds and
 * the bytes the console draws cannot come apart.
 *
 * @param advisory the voice findings that did not refuse
 * @param authorId the Slack user id `auth.test` named, which the digest binds this draft's identity to — the bot's
 *   own id on a `--as bot` row
 * @param botCannotPost why an as-me top-level finding in a channel may carry their name — see `asMeIdentity`
 * @param channelName what the conversation is called, when the info read could say
 * @param groupDm whether the info read answered `is_mpim`, stamped only when it did — bound into the digest when set
 * @param form the form JSON the preparation actually READ — never `--form -`'s stdin sentinel, which no
 *   release could re-prepare
 * @param id the register id this row is filed under
 * @param kind what the row is, when the recording could say — a bot `finding` form, or `--kind`
 * @param media the stored attachments, in attach order — empty adds no field, so the row and its digest
 *   read exactly as a text-only draft always has
 * @param options the parsed invocation — its `--act` and `--row` ride onto the row outside the digest
 * @param payload the exact bytes a release would post
 * @param priorAsk whether the message's question was asked before, as `./draftPriorAsk.ts` judged it — absent for a
 *   draft that asks nothing and declared nothing
 * @param readThrough how far a reply's recording read its thread, and what a person had written there — absent on a
 *   top-level row, outside the digest: it is what a release re-reads against, never what they approves
 * @param receipts what the card brings for its claim, as `./draftRecordReceipts.ts` judged it off the rendered message — an
 *   `attached` one is re-read here off the bytes and files actually stored, outside the digest
 * @param resolution every mention the form named, already resolved
 * @param threadParent the root a reply goes under, as the recording read it — absent on a top-level row
 * @param tsIso when the recording happened
 * @param workspaceUrl `auth.test`'s workspace URL, which a thread row's permalink is built on
 * @returns the row, ready to append
 */
export function composeParkedDraft({
  advisory,
  authorId,
  botCannotPost,
  channelName,
  form,
  groupDm,
  id,
  kind,
  media,
  options,
  payload,
  priorAsk,
  readThrough,
  receipts,
  resolution,
  threadParent,
  tsIso,
  workspaceUrl,
}: {
  advisory: readonly string[];
  authorId: string | undefined;
  botCannotPost: BotCannotPost | undefined;
  channelName: string | undefined;
  form: string;
  groupDm: true | undefined;
  id: string;
  kind: ParkedDraftKind | undefined;
  media: readonly ParkedSlackDraftMedia[];
  options: DraftRecordOptions;
  payload: ParkedDraftPayload;
  priorAsk?: ParkedPriorAsk | undefined;
  readThrough?: ParkedReadThrough | undefined;
  receipts?: ParkedDraftReceipts | undefined;
  resolution: MentionResolution;
  threadParent: ParkedThreadParent | undefined;
  tsIso: string;
  workspaceUrl: string | undefined;
}): ParkedSlackDraft {
  const content = approvedContent({ authorId, groupDm, media, options, payload, priorAsk, resolution });
  return {
    ...content,
    advisory,
    ...(options.actor === "bot" ? { actor: "bot" as const } : {}),
    ...(botCannotPost === undefined ? {} : { botCannotPost }),
    channelName,
    digest: parkedDraftDigest({ draft: content }),
    form,
    id,
    ...filingFields({ kind, options }),
    ...placementFields({ options, threadParent, workspaceUrl }),
    ...(readThrough === undefined ? {} : { readThrough }),
    ...storedReceipts({ media, payload, receipts }),
    tsIso,
    why: options.why,
  };
}

/** A row's shape, and the thread root it answers with its permalink when it is a reply. */
function placementFields({
  options,
  threadParent,
  workspaceUrl,
}: {
  options: Pick<DraftRecordOptions, "channel" | "threadTs">;
  threadParent: ParkedThreadParent | undefined;
  workspaceUrl: string | undefined;
}): Pick<ParkedSlackDraft, "shape" | "threadParent"> {
  const { channel, threadTs } = options;
  const parent = withThreadPermalink({ channel, parent: threadParent, threadTs, workspaceUrl });
  const shape = threadTs === undefined ? "top-level" : "thread";
  return parent === undefined ? { shape } : { shape, threadParent: parent };
}

/**
 * The receipts field as stored: absent for none, a declaration as made, and an `attached` one re-read off the payload
 * and the files the store actually kept, so the strict reader's consistency check holds by construction.
 *
 * @param receipts the recording's judged receipts
 * @returns the field, or nothing
 */
function storedReceipts({
  media,
  payload,
  receipts,
}: {
  media: readonly ParkedSlackDraftMedia[];
  payload: ParkedDraftPayload;
  receipts: ParkedDraftReceipts | undefined;
}): Pick<ParkedSlackDraft, "receipts"> {
  if (receipts === undefined) {
    return {};
  }
  if (receipts.kind !== "attached") {
    return { receipts };
  }
  return { receipts: { ...receipts, links: receiptLinks({ payload }), media: media.length } };
}

/**
 * The part of a row their approval binds — who it goes out as, where, to whom, and the exact bytes and files. The
 * digest is computed over exactly this object, and the row spreads it first.
 *
 * @param authorId the Slack user id the digest binds this draft's identity to
 * @param groupDm the `is_mpim` stamp — unset adds no field, so an unstamped row hashes as it always has
 * @param media the stored attachments, in attach order — empty adds no field
 * @param payload the exact bytes a release would post
 * @param priorAsk the re-ask declaration — only a declared change's proof is bound (`parkedDraftDigest`)
 * @param resolution every mention the form named, already resolved
 * @returns the digest-bound content, in the row's own field order
 */
function approvedContent({
  authorId,
  groupDm,
  media,
  options,
  payload,
  priorAsk,
  resolution,
}: {
  authorId: string | undefined;
  groupDm: true | undefined;
  media: readonly ParkedSlackDraftMedia[];
  options: DraftRecordOptions;
  payload: ParkedDraftPayload;
  priorAsk: ParkedPriorAsk | undefined;
  resolution: MentionResolution;
}): Pick<
  ParkedSlackDraft,
  "authorId" | "channel" | "groupDm" | "mentions" | "payload" | "media" | "threadTs" | "priorAsk"
> {
  const { threadTs } = options;
  return {
    authorId,
    channel: options.channel,
    ...(groupDm === true ? { groupDm } : {}),
    mentions: parkedMentions({ resolution }),
    payload,
    ...(media.length > 0 ? { media } : {}),
    ...(threadTs === undefined ? {} : { threadTs }),
    ...(priorAsk === undefined ? {} : { priorAsk }),
  };
}

/**
 * What a row is and where it files — `kind`, `--act`, `--row`, `--followup-of` and `--impact` — beside the content,
 * never in it: the card's badge, the board row it files under, the finding it follows up and the impact it declares
 * are not what they approves.
 *
 * @param kind what the row is, when the recording could say
 * @param options the parsed invocation, whose `--act`, `--row`, `--followup-of` and `--impact` ride onto the row
 * @returns the fields present, in the row's own order
 */
function filingFields({
  kind,
  options,
}: {
  kind: ParkedDraftKind | undefined;
  options: DraftRecordOptions;
}): Pick<ParkedSlackDraft, "kind" | "act" | "row" | "followupOf" | "impact"> {
  return {
    ...(kind === undefined ? {} : { kind }),
    ...(options.act === undefined ? {} : { act: options.act }),
    ...(options.row === undefined ? {} : { row: options.row }),
    ...(options.followupOf === undefined ? {} : { followupOf: options.followupOf }),
    ...(options.impact === undefined ? {} : { impact: options.impact.text }),
  };
}
