/**
 * The Slack write TRANSPORT — one method per raw mutation, and nothing else.
 *
 * This interface exists so the composite send's ORCHESTRATION (see `./writeSend.ts`) is testable
 * with plain fakes. The orchestration is where the dangerous decisions live: when to delete a
 * message, what counts as success, what to do when a partial failure leaves Slack dirty. Those
 * branches were previously unreachable from a test because they sat behind a concrete `WebClient`,
 * and a failure sequence cannot be recorded either — Polly matches on method + pathname, so repeated
 * calls to one endpoint replay a single fixed response.
 *
 * Every method here is a single raw API call. No policy, no retries beyond the shared wrapper, no
 * decisions. All the judgement is one layer up, where it can be exercised.
 */
import type { AnyChunk } from "@slack/types";
import type { AssistantStatusArgs, AssistantStatusOutcome } from "../../outbound/assistant/status.js";
import type { AssistantTitleArgs, AssistantTitleOutcome } from "../../outbound/assistant/title.js";
import type { CorrectedMessage } from "../../outbound/slack/claimCorrection.js";
import type { ReadSlackMessage, SlackSelfIdentity } from "../../outbound/slack/lifecycleGuards.js";
import type { PlacementReport } from "../../outbound/slack/placement.js";
import type { SlackRecipeResponsePayload } from "../../outbound/slack/recipeResponse.js";
import type {
  ConversationSurface,
  NoFoldRecurrence,
  SlackAssistantAnswerPayload,
  SlackAssistantAnswerPayloadV2,
  SlackCardPayload,
  SlackDripMessagePayload,
  SlackNoFoldPayload,
  SlackPollPayload,
  SlackStreamClosePayload,
  SlackStreamOpenPayload,
  SlackStreamRecipient,
  SlackTurnPayload,
} from "../../outbound/slack/types.js";
import type { InviteOutcome, JoinedChannel, OpenedConversation } from "./writeApiConversations.js";

/** One file to attach: its bytes and the name Slack shows. */
export interface SlackUpload {
  readonly filename: string;
  readonly bytes: Uint8Array;
}

/** The identity of a posted message. Returned, never discarded — PR5.2 edits by `ts`. */
export interface PostedMessage {
  readonly channel: string;
  readonly ts: string;
  /**
   * What the post's read-back found (`./writeGuardPlacement.ts`) — set on a post the placement guard wrapped,
   * absent on a fake, an out-of-scope transport, or an identity passed in to edit. When the guard MOVED the
   * message, `channel`/`ts` above are already the repost's.
   */
  readonly placement?: PlacementReport | undefined;
}

/**
 * What ONE `chat.delete` attempt actually did.
 *
 * Three arms rather than a boolean because a caller journalling the act has to be able to say which
 * happened. `gone` is this call removing the message; `already-gone` is Slack reporting there was nothing
 * at that timestamp to remove, which is a success for the CALLER's goal and evidence of nothing about what
 * this call did; `failed` carries the provider's own words rather than collapsing a permission refusal, a
 * rate limit and a network fault into one indistinguishable `false`.
 */
export type DeleteMessageOutcome =
  { readonly kind: "gone" } | { readonly kind: "already-gone" } | { readonly kind: "failed"; readonly reason: string };

/** The raw mutations a Slack write can perform. */
export interface SlackWriteTransport {
  /** `files.uploadV2` with `channel_id` OMITTED — the whole private upload. Returns the file id. */
  uploadPrivately(args: { upload: SlackUpload }): Promise<string>;
  /** `chat.postMessage` with the rendered card. */
  postCard(args: { channel: string; payload: SlackCardPayload; threadTs: string | undefined }): Promise<PostedMessage>;
  /**
   * `chat.postMessage` with the bot's own ANSWER message — the same accent-only `attachments` wrapper as
   * the card, minus the card's author-row/divider content.
   *
   * Separate from {@link SlackWriteTransport.postCard} rather than a widened parameter, for the same reason
   * {@link SlackWriteTransport.postDripMessage} is separate from it: the metadata shapes genuinely differ
   * (card vs. assistant-answer renderer ids), even though the wire shape they post is now the same. At-most-
   * once, like every other post.
   */
  postAssistantMessage(args: {
    channel: string;
    payload: SlackAssistantAnswerPayload;
    threadTs: string | undefined;
  }): Promise<PostedMessage>;
  /** `chat.update` with the SAME attachments plus `file_ids` — the step that attaches media. */
  attachMedia(args: { posted: PostedMessage; payload: SlackCardPayload; fileIds: readonly string[] }): Promise<void>;
  /**
   * `chat.update` with the SAME attachments plus `file_ids` — the answer's own twin of
   * {@link SlackWriteTransport.attachMedia}.
   */
  attachAssistantMedia(args: {
    posted: PostedMessage;
    payload: SlackAssistantAnswerPayload;
    fileIds: readonly string[];
  }): Promise<void>;
  /**
   * `chat.postMessage` with a scheduled recipe's own response message — the same accent-only `attachments`
   * wrapper, carrying `RecipeResponseMetadata` instead of an ask's own identity. At-most-once, like every
   * other post; the recipe protocol's own idempotency is the durable `response-intended` lifecycle record
   * plus this message's metadata (`../../live/automation/recover.ts`'s own header), never this transport.
   */
  postRecipeResponse(args: {
    channel: string;
    payload: SlackRecipeResponsePayload;
    threadTs: string | undefined;
  }): Promise<PostedMessage>;
  /** `chat.update` with the SAME attachments plus `file_ids` — the recipe response's own twin of {@link SlackWriteTransport.attachMedia}. */
  attachRecipeResponseMedia(args: {
    posted: PostedMessage;
    payload: SlackRecipeResponsePayload;
    fileIds: readonly string[];
  }): Promise<void>;
  /** Read the message back and count its files. The only real proof media attached. */
  readBackFileCount(args: { posted: PostedMessage }): Promise<number>;
  /** `chat.delete`. Best effort — reports whether it succeeded, never throws. */
  deleteMessage(args: { posted: PostedMessage }): Promise<boolean>;
  /**
   * `chat.delete`, AT MOST ONCE, reporting which of three things happened — see `deleteMessageOnceCall`.
   *
   * A SECOND method rather than a widened first one, and the split is the contract rather than tidiness:
   * {@link SlackWriteTransport.deleteMessage} retries at two layers and answers a boolean, which is right
   * for a card this turn itself posted seconds ago and wrong for a message a decision was taken about
   * earlier. Anything deleting on the strength of a judgement made before the call takes this one.
   */
  deleteMessageOnce(args: { posted: PostedMessage }): Promise<DeleteMessageOutcome>;
  /**
   * `chat.postMessage` with ONE as-me drip message, or one plain bot line — a bot notice carries `metadata`.
   *
   * Separate from {@link SlackWriteTransport.postCard} rather than a widened parameter, because the two
   * genuinely send different arguments: the card posts `attachments` with an empty `text`, and a drip
   * message posts either a single top-level `blocks` array or a bare `text` with no blocks at all. One
   * method taking a union would have to branch on that union inside the seam, and the seam's whole
   * contract is that it holds no decisions.
   */
  postDripMessage(args: {
    channel: string;
    payload: SlackDripMessagePayload;
    threadTs: string | undefined;
  }): Promise<PostedMessage>;
  /**
   * `chat.postMessage` with a NO-FOLD bot message — top-level `blocks`, `metadata`, and NO attachment.
   *
   * Separate from {@link SlackWriteTransport.postCard} rather than a widened parameter, for the reason this
   * interface gives about every other split: the arguments genuinely differ, and here the difference IS the
   * feature. `SlackNoFoldPayload` has no `attachments` field, so the wrapper measured to make a Slack
   * message fold cannot be sent through this method at any price. At-most-once, like every other post.
   * `recurrence` is not sent to Slack; it is what the repeat guard wrapping this method reads.
   */
  postNoFold(args: {
    channel: string;
    payload: SlackNoFoldPayload;
    threadTs: string | undefined;
    recurrence: NoFoldRecurrence;
  }): Promise<PostedMessage>;
  /**
   * `chat.postMessage` with a POLL frame, carrying metadata so the poll can later be deleted.
   * At-most-once, like every other post.
   */
  postPoll(args: { channel: string; payload: SlackPollPayload }): Promise<PostedMessage>;
  /**
   * `reactions.add` — seed one ballot chip. IDEMPOTENT (Slack answers `already_reacted` for a repeat), so
   * unlike a post this retries; returns whether the chip is on the message.
   */
  addReaction(args: { posted: PostedMessage; name: string }): Promise<boolean>;
  /**
   * `reactions.remove` — take one reaction back off a message. IDEMPOTENT the same direction as
   * {@link addReaction}: Slack answers `no_reaction` when the name was never there, which this treats as
   * success (the desired end state — that reaction absent — already holds), never as a failure to report.
   */
  removeReaction(args: { posted: PostedMessage; name: string }): Promise<boolean>;
  /**
   * `reactions.get` — the LIVE vote read. `undefined` when the message is gone from Slack, which is a
   * different answer from "no reactions" and must not collapse into it.
   */
  readReactions(args: {
    posted: PostedMessage;
  }): Promise<
    readonly { readonly name: string; readonly count: number; readonly users: readonly string[] }[] | undefined
  >;
  /**
   * `conversations.info` — whether a conversation is a 1:1 DM, a private channel or a public one, and what
   * it is CALLED. A poll's footer states truthfully who can see a vote, the as-me door tells a very public
   * place from a small one, and the parked-draft recorder prints `#name`. Each half is `undefined` when it
   * cannot be established.
   *
   * ONE method, not two. A surface-only call and a surface-plus-name call are the same round trip, and the
   * gates that want only the surface read it off this answer — a second method would be a second way to
   * spend the same request. `user` is the member on the other end of a 1:1 DM, off the same response, so an
   * approved reviewer pick can tell whose a held `D…` ask is. `groupDm` is `true` only on an `is_mpim` answer, since a
   * group DM's `C…` id and private surface cannot say it.
   */
  conversationInfo(args: { channel: string }): Promise<{
    surface: ConversationSurface | undefined;
    name: string | undefined;
    user?: string | undefined;
    isMember?: boolean | undefined;
    groupDm?: true | undefined;
  }>;
  /** `usergroups.list` — handle→id for resolving an `@engineers`-style ping. */
  userGroupIds(): Promise<ReadonlyMap<string, string>>;
  /** `chat.postMessage` with the initial metadata-bearing TURN frame. At-most-once. */
  postTurn(args: { channel: string; payload: SlackTurnPayload; threadTs: string | undefined }): Promise<PostedMessage>;
  /** `chat.update` with a new metadata-bearing TURN frame — every checklist tick and terminal correction. */
  updateTurn(args: { posted: PostedMessage; payload: SlackTurnPayload }): Promise<void>;
  /**
   * `assistant.threads.setTitle` — name the agent thread, so the container's side panel is navigable.
   *
   * Returns an OUTCOME rather than throwing, and that is the contract's one interesting clause. The SDK
   * raises on an API-level error and buries the body on `error.data`, which is where a `missing_scope`'s
   * `needed` field lives — the single most useful thing a refusal carries. Unwrapping it belongs in the
   * adapter, visibly, rather than in a catch block at the call site; and a title is the one write a turn may
   * lose and still be correct, so a refusal must be reportable without being fatal.
   */
  setThreadTitle(args: { args: AssistantTitleArgs }): Promise<AssistantTitleOutcome>;
  /**
   * `assistant.threads.setStatus` — the native "is doing something" indicator.
   *
   * Same OUTCOME-not-throw contract as {@link SlackWriteTransport.setThreadTitle}, and for the same reason:
   * the SDK raises on `ok:false` and buries the body — including a `missing_scope` refusal's `needed` field —
   * on `error.data`. It is never load-bearing: a turn whose status call is refused must still answer, so the
   * caller reports the outcome and carries on rather than treating a refusal as fatal.
   */
  setAssistantStatus(args: { args: AssistantStatusArgs }): Promise<AssistantStatusOutcome>;
  /**
   * `chat.update` with a whole re-rendered CARD — a correction.
   *
   * Distinct from {@link SlackWriteTransport.attachMedia} rather than a widened parameter, because that
   * method means "the SAME attachments plus file_ids" and omits `metadata` and the unfurl flags. Sending a
   * card edit through it would drop the metadata, and a later edit would then be refused for having no
   * recognisable renderer. `fileIds` is re-sent because `chat.update` WITHOUT it detaches whatever media
   * the message already had — the edit would silently lose the files.
   */
  updateCard(args: {
    posted: PostedMessage;
    /**
     * The re-rendered message. An ANSWER or POLL payload is accepted beside a card one because the three differ
     * in nothing but which renderer built `blocks` and which metadata they stamp, and `slack edit` re-renders
     * each shape in place. Widened here rather than given a second method so `chat.update`'s one real
     * requirement — re-send the file ids or the media detaches — stays stated once.
     */
    payload: SlackCardPayload | SlackAssistantAnswerPayloadV2 | SlackPollPayload;
    fileIds: readonly string[];
  }): Promise<void>;
  /**
   * `chat.update` with a re-rendered AS-ME message — no `attachments`, no `metadata`, and no ownership
   * check upstream of this call. The human lane's authorisation is the USER TOKEN itself: `chat.update`
   * only ever lets that token touch a message it posted, so there is no ownership decision left for this
   * program to make. `blocks` is sent explicitly either way (the rendered array for a rich message, an
   * empty one for the plain escape hatch) so an edit that changes form always replaces the old one rather
   * than leaving stale blocks behind it. `fileIds` is re-sent for the same reason `updateCard` re-sends
   * them: `chat.update` without them detaches whatever the message already had.
   */
  updateDripMessage(args: {
    posted: PostedMessage;
    payload: SlackDripMessagePayload;
    fileIds: readonly string[];
  }): Promise<void>;
  /**
   * `chat.update` with a message's OWN stored content, one claim struck and a Correction line added
   * (`../../outbound/slack/claimCorrection.ts`) — `slack correct`. Its own method rather than a widened
   * `updateCard`, because the body is the stored message rewritten rather than a re-render from a form, so it
   * carries whichever of `blocks` and `attachments` the message already had and the metadata exactly as stored.
   * `fileIds` is re-sent for the reason every `chat.update` here re-sends it.
   */
  correctMessage(args: {
    posted: PostedMessage;
    corrected: CorrectedMessage;
    fileIds: readonly string[];
  }): Promise<void>;
  /**
   * Read ONE message back, normalised. The basis of the ownership check, so it must surface who posted it
   * and what metadata it carries — not merely whether it exists.
   */
  readMessage(args: { posted: PostedMessage }): Promise<ReadSlackMessage | undefined>;
  /** `auth.test` — who this token is. The comparison target for ownership. */
  whoAmI(): Promise<SlackSelfIdentity>;
  /**
   * `chat.startStream` — open a new streamed message. Returns its identity, same shape as any other post:
   * the stream's `ts` IS the message ts from the first flush onward, so nothing downstream needs to know a
   * message came from a stream rather than `chat.postMessage`.
   */
  startStream(args: {
    channel: string;
    threadTs: string;
    payload: SlackStreamOpenPayload;
    recipient?: SlackStreamRecipient | undefined;
  }): Promise<PostedMessage>;
  /**
   * `chat.appendStream` — append chunks to an ALREADY OPEN stream. Repeatable like every other advance in
   * this file: `task_update` chunks are keyed by a stable id, so re-sending an unchanged step updates its
   * own card in place rather than duplicating anything.
   */
  appendStream(args: { posted: PostedMessage; chunks: readonly AnyChunk[] }): Promise<void>;
  /**
   * `chat.stopStream` — finalize a stream. This is the ONLY point a stream can carry `metadata`, because
   * `chat.startStream` does not accept one (see {@link SlackStreamOpenPayload}'s
   * own doc). Reports whether the stream is STOPPED, which includes "it already was" — measured live, a
   * second `chat.stopStream` on the same message fails with `message_not_in_streaming_state` rather than
   * succeeding as a no-op, so that code is read as the desired state rather than a failure, the same
   * pattern {@link SlackWriteTransport.deleteMessage} already uses for "already gone".
   */
  stopStream(args: { posted: PostedMessage; payload?: SlackStreamClosePayload | undefined }): Promise<boolean>;
  /**
   * `conversations.create` — mint a channel. AT-MOST-ONCE, like every post here: a retry after a lost
   * response mints a second real channel, and nothing downstream could tell the two apart.
   */
  createChannel(args: { name: string; isPrivate: boolean }): Promise<OpenedConversation>;
  /**
   * `conversations.open` — the DM or group DM for a set of people, minted if it does not stand yet. The
   * one method here that is idempotent by the PROVIDER's guarantee rather than by its end state: one user
   * set always resolves to one conversation id.
   */
  openConversation(args: { userIds: readonly string[] }): Promise<OpenedConversation>;
  /**
   * `conversations.invite` — put people in a channel, reporting per-person rather than all-or-nothing.
   * Returns an OUTCOME because it is sent with Slack's own `force`, so one bad id no longer sinks the batch.
   */
  inviteToChannel(args: { channel: string; userIds: readonly string[] }): Promise<InviteOutcome>;
  /**
   * `conversations.join` — put the TOKEN'S OWN account in a public channel. Idempotent in its end state (a join
   * of a channel already held answers with Slack's `already_in_channel` warning), yet sent ONCE: `confirm` runs
   * synchronously inside the request, after any rate-limit wait and right before the dispatch, and a `false` sends
   * nothing and throws. Slack refuses a private channel outright; the policy that never asks it to is the caller's
   * (`../../cli/commands/slack/releaseJoin.ts`).
   */
  joinChannel(args: { channel: string; confirm: () => boolean }): Promise<JoinedChannel>;
  /** `conversations.setPurpose` — returns the purpose SLACK stored, which its own truncation may shorten. */
  setChannelPurpose(args: { channel: string; purpose: string }): Promise<string | undefined>;
  /** `conversations.setTopic` — separate from the purpose because `*:write.topic` is its own grant. */
  setChannelTopic(args: { channel: string; topic: string }): Promise<string | undefined>;
  /**
   * `conversations.archive` — the only retraction Slack offers for a channel, so it is what the recording
   * lane uses to avoid leaving one behind per lap. Reports whether it is archived, "already was" included.
   */
  archiveChannel(args: { channel: string }): Promise<boolean>;
  /** `canvases.create` — a STANDALONE canvas. AT-MOST-ONCE; a retry mints a second unfindable document. */
  createCanvas(args: { title: string; markdown: string }): Promise<string>;
  /**
   * `conversations.canvases.create` — a canvas attached to a conversation. AT-MOST-ONCE, and MEASURED to
   * need it: a repeat mints a SECOND document rather than being refused or answering with the standing one.
   */
  createChannelCanvas(args: { channel: string; title: string; markdown: string }): Promise<string>;
  /** `canvases.edit` with a single `replace` — set a canvas's whole body. Idempotent, so it retries. */
  replaceCanvas(args: { canvasId: string; markdown: string }): Promise<void>;
  /** `canvases.delete` — the recording lane's retraction. Reports gone, "already was" included. */
  deleteCanvas(args: { canvasId: string }): Promise<boolean>;
}

/**
 * The injected seam for "has this upload finished processing?".
 *
 * A freshly-uploaded file reports an EMPTY mimetype until Slack finishes with it, and attaching one
 * in that state is what produced the old system's broken previews. Measured on a real workspace: a
 * small PNG needed five polls over ~2.9 seconds; a text file was ready on the first.
 *
 * It is a parameter rather than an inline loop because a polling loop CANNOT be recorded — every
 * poll shares one Polly match key, so replay serves one fixed response forever and the loop either
 * never runs or never exits. The still-processing branch is unit-tested instead.
 */
export interface UploadReadiness {
  /** Resolve once the file is ready, or once the wait is spent — reporting WHICH of those happened. */
  waitForFile(args: { fileId: string }): Promise<UploadReadinessOutcome>;
}

/**
 * What a spent readiness wait actually observed — the PHASE, which a boolean could not carry.
 *
 * The distinction is the whole point. `still-processing` means Slack answered every time and the file was
 * simply not finished; `unreadable` means `files.info` itself never succeeded, so nothing is known about the
 * file at all. Those are different faults with different fixes (wait longer vs. look at the token, the scope
 * or the rate limit), and the old `false` collapsed them into one message that named neither.
 *
 * `polls` and `waitedMs` travel with every arm because "it never finished processing" is unactionable
 * without knowing whether the wait was six seconds or two minutes — which is exactly the question the
 * earlier failures could not answer from their own error text.
 */
export type UploadReadinessOutcome =
  | { readonly kind: "ready"; readonly polls: number; readonly waitedMs: number }
  | { readonly kind: "still-processing"; readonly polls: number; readonly waitedMs: number }
  | { readonly kind: "unreadable"; readonly polls: number; readonly waitedMs: number; readonly lastError: string };

/**
 * The reader-facing phrase for a spent wait — one sentence, used in the failure and in the posted note.
 *
 * @param outcome the spent wait
 * @returns the phrase, or the empty string for a `ready` outcome, which has nothing to report
 */
export function readinessFailureReason({ outcome }: { outcome: UploadReadinessOutcome }): string {
  const spent = `${String(outcome.polls)} poll(s) over ${(outcome.waitedMs / 1000).toFixed(1)}s`;
  if (outcome.kind === "ready") {
    return "";
  }
  if (outcome.kind === "unreadable") {
    return `files.info never succeeded in ${spent} (last: ${outcome.lastError})`;
  }
  return `Slack never finished processing it in ${spent}`;
}
