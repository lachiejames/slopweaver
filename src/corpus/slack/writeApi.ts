/**
 * The Slack WRITE seam — the one and only place in this codebase that mutates a Slack workspace.
 *
 * It follows `./api.ts`'s pattern exactly (build one `WebClient`; wrap ONE raw SDK call per method in
 * {@link safeProviderCall} + `orThrow`, so the boundary-residue gate sees each client call inside the
 * paced door), and lives in its own file for one reason worth stating: a reader
 * auditing "what can this program do to Slack?" should answer it by reading a single short file.
 * Read and write are different trust classes, so they are different modules.
 *
 * There is deliberately NO policy here. Each method is one raw call; the decisions about what
 * counts as success and when to retract a message live in `./writeSend.ts`, behind the
 * {@link SlackWriteTransport} interface, so they can be unit-tested with plain fakes.
 *
 * The seam takes an ALREADY-RENDERED payload. It makes no formatting decisions, picks no channel and
 * adds no fields — everything it sends was decided by the pure renderer and shown by `--dry-run`.
 *
 * `correctMessage` is the one method held in another file: `./writeApiCorrect.ts` exports `correctMethods`, which
 * this module imports and spreads into its wiring table. That module imports nothing from this one.
 */
import { safeProviderCall, scopeIdForToken } from "../../lib/providerCall.js";
import { orThrow } from "../../lib/safeBoundary.js";
import type { ConversationMembership } from "../../outbound/slack/dmMembership.js";
import type {
  SlackAssistantAnswerPayload,
  SlackAssistantAnswerPayloadV2,
  SlackCardPayload,
  SlackPollPayload,
} from "../../outbound/slack/types.js";
import { slackWritePrivacy } from "../../outbound/slack/writePrivacy.js";
import type { ImageAdmit } from "../../visualEvidence/admitUploads.js";
import { postingClient } from "./atMostOnceClient.js";
import { GuardedWebClient } from "./guardedWebClient.js";
import { toSdkAttachments } from "./sdkAttachments.js";
import { whoAmIOnce } from "./whoAmIOnce.js";
import { setAssistantStatusCall, setThreadTitleCall } from "./writeApiAssistantThreads.js";
import { canvasCreateCall, canvasDeleteCall, canvasReplaceCall, channelCanvasCreateCall } from "./writeApiCanvas.js";
import type { SlackWriteApi } from "./writeApiContract.js";
import { conversationMethods } from "./writeApiConversations.js";
import { correctMethods } from "./writeApiCorrect.js";
import { postDripMessageCall, postNoFoldCall, updateDripMessageCall } from "./writeApiDrip.js";
import { conversationMembershipCall } from "./writeApiMembership.js";
import {
  addReactionCall,
  conversationInfoCall,
  postPollCall,
  readReactionsCall,
  removeReactionCall,
  userGroupIdsCall,
} from "./writeApiPoll.js";
import { profileMethods, type SlackProfileTransport } from "./writeApiProfile.js";
import {
  deleteMessageCall,
  deleteMessageOnceCall,
  readBackFileCountCall,
  readMessageCall,
  whoAmICall,
} from "./writeApiRead.js";
import { attachRecipeResponseMediaCall, postRecipeResponseCall } from "./writeApiRecipeResponse.js";
import { appendStreamCall, startStreamCall, stopStreamCall } from "./writeApiStream.js";
import { uploadPrivatelyCall } from "./writeApiUpload.js";
import { postCardCall, postTurnCall, updateTurnCall } from "./writeApiWrapped.js";
import type { HighStakesReplySeams } from "./writeGuardHighStakes.js";
import type { PLACEMENT_OUT_OF_SCOPE, PlacementGuardSeams } from "./writeGuardPlacement.js";
import type { RepeatGuardSeams } from "./writeGuardRepeat.js";
import { guardWriteTransport } from "./writeGuards.js";
import { runCompositeSend, runDripCompositeSend } from "./writeSend.js";

// Re-exported so callers keep reading "every Slack write's own outcome-vs-throw predicates" off this one
// file, per its own header — `startStreamCall`/`appendStreamCall`/`stopStreamCall` live in `./writeApiStream.js`,
// `postDripMessageCall`/`updateDripMessageCall` live in `./writeApiDrip.js`,
// `postRecipeResponseCall`/`attachRecipeResponseMediaCall` live in `./writeApiRecipeResponse.js`, the poll
// calls live in `./writeApiPoll.js`, the read-back/ownership calls live in `./writeApiRead.js`, and the two
// `assistant.threads.*` calls live in `./writeApiAssistantThreads.js`, and the private upload lives in
// `./writeApiUpload.js`, purely to stay under
// `file-size-ratchet`'s cap (`MAX_FILE_LINES` in `src/devLint/fileSizeRatchet.ts`), not because any of them
// is a different seam.
export { fileCountOf, isAlreadyGone, isAlreadyGoneThrowable, pickReadMessage } from "./writeApiRead.js";
export { isAlreadyStopped } from "./writeApiStream.js";

import { optStr } from "./shape.js";
import type { PostedMessage, SlackWriteTransport, UploadReadiness } from "./writeTransport.js";

/**
 * `chat.update` with the SAME attachments plus `file_ids` — the step that attaches media, to a card or to an
 * answer. The two differ only in payload type and the operation they are paced and traced under.
 */
async function attachMediaCall({
  client,
  posted,
  payload,
  fileIds,
  scopeId,
  operation,
}: {
  client: GuardedWebClient;
  posted: PostedMessage;
  payload: SlackCardPayload | SlackAssistantAnswerPayload;
  fileIds: readonly string[];
  scopeId: string;
  operation: "slack.chat.update" | "slack.chat.update.assistant";
}): Promise<void> {
  orThrow({
    result: await safeProviderCall({
      execute: () =>
        client.chat.update({
          attachments: toSdkAttachments({ wrapper: payload.attachments[0] }),
          channel: posted.channel,
          file_ids: [...fileIds],
          text: payload.text,
          ts: posted.ts,
        }),
      operation,
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
  });
}

/**
 * Rebuild an assistant-answer metadata value as a FRESH object literal, structurally matching the SDK's own
 * `MessageMetadata` — a plain `{[key: string]: string|number|boolean|...}` index signature.
 *
 * Our own `SlackAssistantAnswerMetadataV1`/`SlackAssistantAnswerMetadataV2` are nominal
 * interfaces with named fields, never an index signature, so passing one through AS A VALUE (not a fresh
 * literal) is not structurally assignable to the SDK's type even though every field is itself a compatible
 * primitive or nested primitive-only object — TypeScript's freshness check for index-signature targets only
 * applies to object literals written in place, not to typed values flowing through a variable. Spreading
 * here, at the exact SDK boundary, is what re-establishes that freshness rather than casting past the check.
 */
function sdkAssistantMetadata({ metadata }: { metadata: SlackAssistantAnswerPayload["metadata"] }) {
  return {
    event_payload:
      "askIdentity" in metadata.event_payload
        ? { ...metadata.event_payload, askIdentity: { ...metadata.event_payload.askIdentity } }
        : { ...metadata.event_payload },
    event_type: metadata.event_type,
  };
}

/**
 * `chat.postMessage` with the bot's own ANSWER message. Returns the created message's identity.
 *
 * Non-retrying like every other post here (`postingClient`): an at-most-once send is the correct posture
 * for an irreversible `chat.postMessage`, and this is one. Sends `attachments` exactly like `postCardCall`,
 * via the same {@link toSdkAttachments} conversion — the answer's accent wrapper is the same wire shape as
 * the card's, just without the card's author-row/divider content inside it.
 */
async function postAssistantMessageCall({
  client,
  channel,
  payload,
  threadTs,
  scopeId,
}: {
  client: GuardedWebClient;
  channel: string;
  payload: SlackAssistantAnswerPayload;
  threadTs: string | undefined;
  scopeId: string;
}): Promise<PostedMessage> {
  const res = orThrow({
    result: await safeProviderCall({
      // AT-MOST-ONCE: `retryMode: "never"` AND the NON-RETRYING `client` — see `postingClient`.
      execute: () =>
        client.chat.postMessage({
          attachments: toSdkAttachments({ wrapper: payload.attachments[0] }),
          channel,
          metadata: sdkAssistantMetadata({ metadata: payload.metadata }),
          text: payload.text,
          unfurl_links: payload.unfurl_links,
          unfurl_media: payload.unfurl_media,
          ...(threadTs !== undefined ? { thread_ts: threadTs } : {}),
        }),
      operation: "slack.chat.postMessage.assistant",
      provider: "slack",
      retryMode: "never",
      scopeId,
    }),
  });
  const postedChannel = optStr({ value: res.channel });
  const ts = optStr({ value: res.ts });
  if (postedChannel === undefined || ts === undefined) {
    throw new Error("slack.chat.postMessage returned no channel/ts");
  }
  return { channel: postedChannel, ts };
}

/**
 * `chat.update` with a whole re-rendered card — a correction.
 *
 * `file_ids` is re-sent whenever the message had any. `chat.update` omitting it DETACHES the media, so an
 * edit of a card carrying a screenshot would silently drop the screenshot; the caller reads the ids back
 * first and passes them through here.
 */
async function updateCardCall({
  client,
  posted,
  payload,
  fileIds,
  scopeId,
}: {
  client: GuardedWebClient;
  posted: PostedMessage;
  /**
   * A card, ANSWER or POLL payload. `chat.update` reads the same four fields off each, so the union is
   * carried down to this call rather than collapsed at a cast: the metadata shapes genuinely differ and the
   * SDK is handed whichever one the caller actually built.
   */
  payload: SlackCardPayload | SlackAssistantAnswerPayloadV2 | SlackPollPayload;
  fileIds: readonly string[];
  scopeId: string;
}): Promise<void> {
  orThrow({
    result: await safeProviderCall({
      execute: () =>
        client.chat.update({
          attachments: toSdkAttachments({ wrapper: payload.attachments[0] }),
          channel: posted.channel,
          metadata: sdkUpdateMetadata({ metadata: payload.metadata }),
          text: payload.text,
          ts: posted.ts,
          ...(fileIds.length > 0 ? { file_ids: [...fileIds] } : {}),
        }),
      operation: "slack.chat.update",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
  });
}

/**
 * The live transport over a real `WebClient`. Pure wiring — every call lives in its own function.
 *
 * @param token the bot token the transport writes as
 * @param home the state home the calling lane resolved — its `--home` when it took one. Required, so no composer
 *   can leave the high-stakes reply door reading a different home's channel list than the lane it serves.
 * @param repeatSeams what the repeat guard reads its place, clock and hatch through; the live ones for this
 *   token when absent. A cassette or a replay passes its own, since neither recorded the guard's reads.
 * @param highStakesSeams what the high-stakes reply guard reads its channel list and hatch through; `home`'s
 *   profile when absent
 * @param placementSeams what the post read-back reads threads and journals through; the live ones when absent,
 *   `PLACEMENT_OUT_OF_SCOPE` from a cassette or replay that recorded no read-back
 * @returns the transport; each method is its own function so a single call can be traced and rate-classed
 */
// max-lines-exempt: a flat one-line-per-method wiring table; each method already lives in its own function
export function makeSlackWriteTransport({
  token,
  home,
  repeatSeams,
  highStakesSeams,
  placementSeams,
}: {
  token: string;
  home: string;
  repeatSeams?: RepeatGuardSeams;
  highStakesSeams?: HighStakesReplySeams;
  placementSeams?: PlacementGuardSeams | typeof PLACEMENT_OUT_OF_SCOPE;
}): SlackWriteTransport {
  // devlint: sdk-factory -- the repeatable-call write client (update/delete/upload/read-back), guarded against a dead Datadog host
  const client = new GuardedWebClient({ privacy: slackWritePrivacy({ home }), token });
  const posting = postingClient({ privacy: slackWritePrivacy({ home }), token });
  // Slack's quota is per-WORKSPACE and one bot token belongs to one workspace, so the token's digest is a
  // correct workspace key for the shared 429 block — and costs no extra `auth.test` round trip.
  const scopeId = scopeIdForToken({ token });
  // `auth.test` is asked once and reused: the sweep needs our bot id for every message it inspects, and
  // re-asking per message would spend a call per candidate to learn a value that cannot change mid-run.
  const identity = whoAmIOnce({ ask: () => whoAmICall({ client, scopeId }) });
  // Every write door wraps HERE, the only place a live transport is built (`./writeGuards.ts`).
  return guardWriteTransport({
    highStakesSeams,
    home,
    placementSeams,
    repeatSeams,
    token,
    transport: {
      addReaction: ({ posted, name }) => addReactionCall({ client, name, posted, scopeId }),
      appendStream: ({ posted, chunks }) => appendStreamCall({ chunks, client, posted, scopeId }),
      attachAssistantMedia: ({ posted, payload, fileIds }) =>
        attachMediaCall({ client, fileIds, operation: "slack.chat.update.assistant", payload, posted, scopeId }),
      attachMedia: ({ posted, payload, fileIds }) =>
        attachMediaCall({ client, fileIds, operation: "slack.chat.update", payload, posted, scopeId }),
      attachRecipeResponseMedia: ({ posted, payload, fileIds }) =>
        attachRecipeResponseMediaCall({ client, fileIds, payload, posted, scopeId }),
      conversationInfo: ({ channel }) => conversationInfoCall({ channel, client, scopeId }),
      createCanvas: ({ title, markdown }) => canvasCreateCall({ client: posting, markdown, scopeId, title }),
      createChannelCanvas: ({ channel, title, markdown }) =>
        channelCanvasCreateCall({ channel, client: posting, markdown, scopeId, title }),
      deleteCanvas: ({ canvasId }) => canvasDeleteCall({ canvasId, client, scopeId }),
      deleteMessage: ({ posted }) => deleteMessageCall({ client, posted, scopeId }),
      // The NON-retrying client, and the compiler holds it there: `posting` is the only `AtMostOnceClient`
      // in scope, which is what `deleteMessageOnceCall` asks for. Why a second attempt at this particular
      // delete is not the harmless repeat the retrying client assumes: `./atMostOnceClient.ts`.
      deleteMessageOnce: ({ posted }) => deleteMessageOnceCall({ client: posting, posted, scopeId }),
      ...conversationMethods({ client, posting, scopeId }),
      ...correctMethods({ client, scopeId }),
      postAssistantMessage: ({ channel, payload, threadTs }) =>
        postAssistantMessageCall({ channel, client: posting, payload, scopeId, threadTs }),
      postCard: ({ channel, payload, threadTs }) =>
        postCardCall({ channel, client: posting, payload, scopeId, threadTs }),
      postDripMessage: ({ channel, payload, threadTs }) =>
        postDripMessageCall({ channel, client: posting, payload, scopeId, threadTs }),
      postNoFold: ({ channel, payload, threadTs }) =>
        postNoFoldCall({ channel, client: posting, payload, scopeId, threadTs }),
      postPoll: ({ channel, payload }) => postPollCall({ channel, client: posting, payload, scopeId }),
      postRecipeResponse: ({ channel, payload, threadTs }) =>
        postRecipeResponseCall({ channel, client: posting, payload, scopeId, threadTs }),
      postTurn: ({ channel, payload, threadTs }) =>
        postTurnCall({ channel, client: posting, payload, scopeId, threadTs }),
      readBackFileCount: ({ posted }) => readBackFileCountCall({ client, posted, scopeId }),
      readMessage: ({ posted }) => readMessageCall({ client, posted, scopeId }),
      readReactions: ({ posted }) => readReactionsCall({ client, posted, scopeId }),
      removeReaction: ({ posted, name }) => removeReactionCall({ client, name, posted, scopeId }),
      replaceCanvas: ({ canvasId, markdown }) => canvasReplaceCall({ canvasId, client, markdown, scopeId }),
      setAssistantStatus: ({ args }) => setAssistantStatusCall({ args, client, scopeId }),
      setThreadTitle: ({ args }) => setThreadTitleCall({ args, client, scopeId }),
      startStream: ({ channel, threadTs, payload, recipient }) =>
        startStreamCall({ channel, client: posting, payload, recipient, scopeId, threadTs }),
      stopStream: ({ posted, payload }) => stopStreamCall({ client, payload, posted, scopeId }),
      updateCard: ({ posted, payload, fileIds }) => updateCardCall({ client, fileIds, payload, posted, scopeId }),
      updateDripMessage: ({ posted, payload, fileIds }) =>
        updateDripMessageCall({ client, fileIds, payload, posted, scopeId }),
      updateTurn: ({ posted, payload }) => updateTurnCall({ client, payload, posted, scopeId }),
      uploadPrivately: ({ upload }) => uploadPrivatelyCall({ client, scopeId, upload }),
      userGroupIds: () => userGroupIdsCall({ client, scopeId }),
      whoAmI: identity,
    },
  });
}

/**
 * The live transport for the owner's own status and presence (`slopweaver slack status`).
 *
 * Built here rather than in `./writeApiProfile.ts` so this file stays the one place a Slack write client is
 * constructed; the calls themselves live there.
 *
 * @param token the USER token — a status is the owner's, and the bot has no profile to set
 * @param home the state home the verb resolved, whose private terms a status write is judged under
 * @returns the profile transport
 */
export function makeSlackProfileTransport({ token, home }: { token: string; home: string }): SlackProfileTransport {
  // devlint: sdk-factory -- the profile/presence client: the owner's own status, user token only
  const client = new GuardedWebClient({ privacy: slackWritePrivacy({ home }), token });
  return profileMethods({ client, scopeId: scopeIdForToken({ token }) });
}

/**
 * The live read of who is in a conversation an as-me message posts into (`./writeApiMembership.ts`).
 *
 * Built here for the reason {@link makeSlackProfileTransport} is: this file stays the one place a Slack write client
 * is constructed.
 *
 * @param token the token the message would post under, so membership is read as its author sees it
 * @param home the state home the verb resolved; the client requires its privacy capability, though a read never loads it
 * @returns the membership reader
 */
export function makeSlackMembershipReader({
  token,
  home,
}: {
  token: string;
  home: string;
}): (args: { channel: string }) => Promise<ConversationMembership> {
  // devlint: sdk-factory -- the membership read an as-me preparation asks: conversations.info + conversations.members
  const client = new GuardedWebClient({ privacy: slackWritePrivacy({ home }), token });
  const scopeId = scopeIdForToken({ token });
  return async ({ channel }) => conversationMembershipCall({ channel, client, scopeId });
}

/**
 * Build the production Slack WRITE seam.
 *
 * @param token the Slack bot token
 * @param home the state home the calling lane resolved, whose profile the write doors judge against
 * @param readiness the injected upload-readiness poll
 * @param admit the image-admission seam every attachment crosses before it is uploaded
 * @returns the live write seam
 */
export function makeSlackWriteApi({
  token,
  home,
  readiness,
  admit,
}: {
  token: string;
  home: string;
  readiness: UploadReadiness;
  admit: ImageAdmit;
}): SlackWriteApi {
  const transport = makeSlackWriteTransport({ home, token });
  return {
    sendComposite: async ({ channel, payload, threadTs, uploads }) =>
      runCompositeSend({ admit, channel, payload, readiness, threadTs, transport, uploads }),
    deleteOwnMessage: async ({ channel, ts }) => transport.deleteMessage({ posted: { channel, ts } }),
    readOwnMessage: async ({ channel, ts }) => {
      const stored = await transport.readMessage({ posted: { channel, ts } });
      if (stored === undefined) {
        return undefined;
      }
      const self = await transport.whoAmI();
      return {
        ...(stored.blocks === undefined ? {} : { blocks: stored.blocks }),
        ...(self.workspaceUrl === undefined ? {} : { workspaceUrl: self.workspaceUrl }),
      };
    },
    sendDripMessage: async ({ channel, payload, threadTs, uploads }) =>
      runDripCompositeSend({ admit, channel, payload, readiness, threadTs, transport, uploads }),
    sendNoFold: async ({ channel, payload, recurrence, threadTs }) => {
      const posted = await transport.postNoFold({ channel, payload, recurrence, threadTs });
      return { channel: posted.channel, fileIds: [], missingMedia: [], ok: true, ts: posted.ts };
    },
  };
}

export type { SlackWriteApi } from "./writeApiContract.js";

/**
 * The SDK-shaped metadata for whichever payload an in-place edit was handed.
 *
 * An answer's metadata carries a nested `askIdentity`, which is a nominal interface rather than an index
 * signature, so it needs {@link sdkAssistantMetadata}'s fresh-literal rebuild at the SDK boundary for the
 * reason that function states. A card's metadata is already assignable. Dispatching on the presence of the
 * answer's own field rather than on the event type keeps this true of both answer versions at once.
 *
 * @param payload the card or answer being re-sent
 * @returns the metadata as the SDK's `MessageMetadata`
 */
function sdkUpdateMetadata({
  metadata,
}: {
  metadata: SlackCardPayload["metadata"] | SlackAssistantAnswerPayloadV2["metadata"] | SlackPollPayload["metadata"];
}) {
  const eventPayload = metadata.event_payload;
  if ("askIdentity" in eventPayload) {
    return {
      event_payload: { ...eventPayload, askIdentity: { ...eventPayload.askIdentity } },
      event_type: metadata.event_type,
    };
  }
  return { event_payload: { ...eventPayload }, event_type: metadata.event_type };
}
