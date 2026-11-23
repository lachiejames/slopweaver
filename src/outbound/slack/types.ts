/**
 * The Slack-SPECIFIC half of an outbound write. Everything here may name Slack; nothing under
 * `src/outbound/artifact/` may. That line is enforced by a unit test, because it is the difference
 * between PR6 (Linear) being "add a renderer" and PR6 being "extract a schema while writing Linear".
 */
import type { AnyChunk, KnownBlock, RichTextBlock } from "@slack/types";
import type { RecordedAskIdentity } from "../../live/ask/identity.js";
import type { MissingUpload } from "./missingMedia.js";
import type { PlacementReport } from "./placement.js";

/**
 * The card's per-person chrome, resolved from `profile.json` — never a literal in code. A different
 * operator wants a different bot name, emoji and banner colour, so these are CONFIGURATION rather
 * than constants. Values for the reference deployment were read off real posted cards.
 */
export interface SlackCardChrome {
  /** The author-row emoji, as a `:shortcode:` — block 0 is mrkdwn, where Slack DOES expand shortcodes. */
  readonly authorEmoji: string;
  /** The bot's display name in the author row. */
  readonly authorLabel: string;
  /** The wrapper's left banner bar. Required for the card's identity, though not for the fold. */
  readonly bannerColor: string;
  /** Block 4's label. Cosmetic and configurable — `*More*` behaves identically. Its POSITION matters. */
  readonly detailLabel: string;
  /** `metadata.event_type`, so a later edit (PR5.2) can recognise its own cards. */
  readonly metadataEventType: string;
}

/**
 * The exact `chat.postMessage` / `chat.update` arguments the renderer emits.
 *
 * `text` is the EMPTY STRING, deliberately present rather than omitted: a non-empty top-level `text`
 * renders a duplicate body ABOVE the card. `blocks` is absent at the top level for the same reason —
 * every block lives inside the single wrapper, which is what makes the fold fire.
 */
export interface SlackCardPayload {
  readonly text: "";
  readonly attachments: readonly [SlackCardWrapper];
  readonly metadata: SlackCardMetadata;
  readonly unfurl_links: boolean;
  readonly unfurl_media: boolean;
}

/**
 * The legacy `attachments[]` container — "the card wrapper", never "the attachment". It holds NO
 * files. It draws the coloured bar and, measured across a twelve-variant matrix, it is what makes
 * the fold work: the identical six blocks posted at top level do not fold.
 */
export interface SlackCardWrapper {
  readonly color: string;
  readonly fallback: string;
  readonly blocks: readonly KnownBlock[];
}

/**
 * Top-level `metadata` — NOT a wrapper field. Nested inside the wrapper Slack silently ignores it,
 * and the "a later edit re-renders the same shape" purpose quietly fails.
 *
 * It carries what PR5.2 needs to re-render a card for an edit, and nothing else: no prose, no target
 * ids. The chrome is snapshotted so a profile change cannot silently alter an edited card.
 */
export interface SlackCardMetadata {
  readonly event_type: string;
  readonly event_payload: {
    readonly schemaVersion: 1;
    readonly artifactKind: "update";
    readonly renderer: "slack-card-v1";
    readonly artifactFingerprint: string;
  };
}

/**
 * Top-level `metadata` for a NO-FOLD message.
 *
 * Structurally the card's own {@link SlackCardMetadata} with two literals changed, and deliberately its own
 * type rather than a widened one: `artifactKind` and `renderer` are what a later reader uses to decide
 * whether a stored message is one this repository can re-render, and a union on those fields would make
 * "which form is this" a question every consumer had to ask instead of one the compiler answers.
 */
export interface SlackNoFoldMetadata {
  readonly event_type: string;
  readonly event_payload: {
    readonly schemaVersion: 1;
    readonly artifactKind: "no-fold";
    readonly renderer: "slack-no-fold-v1";
    readonly artifactFingerprint: string;
  };
}

/**
 * The exact `chat.postMessage` arguments for a message that must render entirely above the fold.
 *
 * The important thing about this type is what it does NOT have, exactly as with
 * {@link SlackDripMessagePayload}. There is **no `attachments` key**, so the card wrapper — the coloured
 * banner, the author row, and the fold — is not merely discouraged here, it is UNREPRESENTABLE. And
 * `blocks` is a one-element TUPLE, so a second block cannot be added by a later edit without changing this
 * line first.
 *
 * Both narrowings rest on the one part of the fold matrix that SURVIVED measurement: the
 * wrapper is what makes a message fold, and the identical blocks at top level do not. The block-count half
 * of that matrix is refuted — a THREE-block attachment folds — which is why the guarantee here is
 * structural (no wrapper) rather than numeric (few blocks). See `./noFold.ts`.
 *
 * `text` is the notification fallback and is NOT empty, unlike the card's. The card sets `text: ""` because
 * a non-empty top-level `text` renders a duplicate body above an ATTACHMENT; with `blocks` at top level and
 * no attachment, Slack uses `text` only for the push notification, the sidebar preview and screen readers,
 * so leaving it empty would silently cost all three.
 */
export interface SlackNoFoldPayload {
  readonly text: string;
  readonly blocks: readonly [RichTextBlock];
  readonly metadata: SlackNoFoldMetadata;
  readonly unfurl_links: boolean;
  readonly unfurl_media: boolean;
}

/**
 * Whether a no-fold message's words may recur in its place by design — carried BESIDE the payload, never in
 * it, because the payload is the literal `chat.postMessage` arguments.
 *
 * `once` is every no-fold message a person composes, and the repeat guard (`corpus/slack/writeGuardRepeat.ts`)
 * judges it. `automation-prompt` is a recipe's standing question, posted verbatim at every firing into the
 * one private prompt conversation: the recurrence IS the point, so the guard does not read for it. Measured:
 * `datadog-regression-hunt-daily` was refused on its second firing, and the store held the row.
 */
export type NoFoldRecurrence = "once" | "automation-prompt";

/**
 * What a write returns. NEVER `void` — the archive's shared write returned nothing, threw away the
 * message timestamp, and consequently could never edit or delete anything across 18 integrations.
 * PR5.2's edit/delete/progress flow is impossible without `ts`.
 */
export interface SlackSendResult {
  readonly ok: true;
  readonly channel: string;
  readonly ts: string;
  readonly fileIds: readonly string[];
  /**
   * The uploads that never became attachable, so the message went out SAYING so instead of not going out.
   *
   * Empty on the ordinary path. Non-empty means the message is posted, correct and honest about what is
   * absent — a degraded delivery a caller should record, never a failure it should retract.
   */
  readonly missingMedia: readonly MissingUpload[];
  /** Where the message was read back to be, and any repair — absent when the transport did not read it back. */
  readonly placement?: PlacementReport | undefined;
}

/**
 * ONE message of an AS-ME drip, exactly as `chat.postMessage` takes it — or one plain bot line (a notice or a
 * responder refusal) sent through the same seam.
 *
 * The important thing about this type is what it does NOT have. There is no `attachments` key on either
 * arm, so the card wrapper — the coloured banner, the author row, the `>5-block` fold — is not merely
 * discouraged in the human lane, it is UNREPRESENTABLE. That is the difference between a rule a reviewer
 * enforces and one the compiler does. The `rich` arm's `blocks` is a one-element TUPLE for the same
 * reason: the fold is a function of block count and fires past five, so a message that can only ever hold
 * one block can never fold.
 *
 * `form` is ours, not Slack's, and the transport drops it — the two arms take genuinely different API
 * arguments, and a discriminant beats an optional `blocks?` that every call site has to test.
 */
export type SlackDripMessagePayload = SlackRichMessagePayload | SlackPlainMessagePayload;

/** A structured drip message: one `rich_text` block holding one section. */
export interface SlackRichMessagePayload {
  readonly form: "rich";
  /**
   * The NOTIFICATION fallback, never a second copy of the body: with `blocks` present Slack renders the
   * blocks and uses `text` only for the push notification, the sidebar preview and screen readers. PR5's
   * card sets `text` EMPTY because a non-empty `text` alongside `attachments` renders a duplicate body
   * above the card — a different case with the opposite answer, which is why it is spelled out here.
   */
  readonly text: string;
  readonly blocks: readonly [RichTextBlock];
  readonly unfurl_links: boolean;
  readonly unfurl_media: boolean;
}

/**
 * The escape hatch on the wire: the operator's own bytes as a plain `text` message, with NO blocks.
 *
 * Deliberately not rendered through `rich_text`. Inside `rich_text` markdown is inert, so a `*bold*` or a
 * `<@U…>` that the operator typed themselves would render as literal punctuation — the exact opposite of
 * "exactly what I typed". A bare `text` message is what the Slack client itself sends, so mrkdwn, mentions
 * and emoji all behave the way they do when the owner types them into the box.
 */
export interface SlackPlainMessagePayload {
  readonly form: "plain";
  readonly text: string;
  readonly unfurl_links: boolean;
  readonly unfurl_media: boolean;
  /**
   * Present only on a line the BOT posts for itself — never on the operator's own words. Without it a bot line
   * is unretractable: `slack delete` refuses a message carrying no slopweaver metadata, and the stranded lane's
   * re-dispatch notice stood in `C0SYN000018` after the owner asked for it gone twice.
   */
  readonly metadata?: SlackNoticeMetadata;
}

/**
 * Top-level `metadata` for a plain bot NOTICE — one sentence the bot posts about its own lifecycle, such as the
 * stranded lane's re-dispatch line. Its own type for the reason {@link SlackNoFoldMetadata} gives: `renderer`
 * names a shape, and `slack delete` keys on it. Nothing re-renders a notice, so `slack edit` never accepts one.
 * Built by `./noticeMetadata.ts`.
 */
export interface SlackNoticeMetadata {
  readonly event_type: "slopweaver_notice_v1";
  readonly event_payload: {
    readonly schemaVersion: 1;
    readonly artifactKind: "notice";
    readonly renderer: "slack-notice-v1";
  };
}

/**
 * The conversation shape a drip takes, and it is a REQUIRED caller decision with no default.
 *
 * The owner declined to make it a rule: it depends on the context, such as a channel where several people want
 * threads for different conversations, and is decided at the time of sending. A default would be the
 * code quietly making a judgement the owner reserved for the moment of sending, so there is none. A LEARNED
 * per-conversation default is the PR10 belief layer's job and is deliberately out of scope here.
 */
export type DripShape = "top-level" | "thread";

/** WHOSE name the message goes out under. Explicit on every send; there is no default. */
export type SlackActor = "me" | "bot";

/**
 * What KIND of surface a conversation id names, as Slack's own flags answer it.
 *
 * Three arms rather than two because two different doors ask this question and they need different cuts of
 * it. A poll's footer only cares whether a vote is visible to more than one person, so it treats both
 * channel arms alike. The as-me door cares specifically about a *very public place* — the owner's own words
 * about `#dev-team` — so it has to tell a public channel from a private one, and Slack gives both a `C`
 * id, which is why this is ASKED rather than derived from the id.
 *
 * There is deliberately no `unknown` member: "could not be established" is `undefined` at the call, so a
 * caller cannot accidentally pattern-match it as a surface and must handle the absence explicitly.
 */
export type ConversationSurface = "direct-message" | "private-channel" | "public-channel";

/**
 * What ONE drip message's send returns. Never `void` — a resumed drip needs the `ts` it already got.
 *
 * `fileIds` is the attachment's own read-back proof, exactly as {@link SlackSendResult} carries it: a drip
 * message that was asked to carry media returns the ids that were verified onto it, and one that was not
 * returns an empty list. Reporting the count rather than a boolean is what lets the send report say "2
 * file(s) attached and read back" instead of implying the upload from the fact that nothing threw.
 */
export interface SlackDripSendResult {
  readonly channel: string;
  readonly ts: string;
  readonly fileIds: readonly string[];
  /** Where the message was read back to be, and any repair — absent when the transport did not read it back. */
  readonly placement?: PlacementReport | undefined;
}

/**
 * A poll's `metadata`. Its `event_type` is distinct from the card's and the progress message's for the same
 * reason theirs differ from each other: it is what lets `slack delete` recognise a poll as slopweaver's own
 * work and refuse anything else. Without it a poll would be unmutable — and a poll that cannot be deleted is
 * a poll you cannot take back after posting it wrong.
 */
interface SlackPollMetadata {
  readonly event_type: string;
  readonly event_payload: {
    readonly schemaVersion: 1;
    readonly renderer: "slack-poll-v1";
    /** Correlates the message with its local poll record. Opaque: no prose, no option text. */
    readonly pollId: string;
  };
}

/**
 * The exact `chat.postMessage` arguments for a poll.
 *
 * Wrapped in full bot chrome. The question and ballot share the one above-fold content block, so the sixth
 * footer block may collapse without hiding anything a reader needs in order to vote.
 */
export interface SlackPollPayload {
  /** Empty, like the card's: a non-empty `text` beside `attachments` renders a duplicate body above them. */
  readonly text: string;
  /**
   * ONE wrapper carrying the configured author row, dividers, Details label and coloured stripe.
   */
  readonly attachments: readonly [SlackCardWrapper];
  readonly metadata: SlackPollMetadata;
  readonly unfurl_links: boolean;
  readonly unfurl_media: boolean;
}

/**
 * The TURN fallback uses the exact same full bot chrome as every other wrapped bot message.
 */
export type TurnChrome = SlackCardChrome;

/**
 * A turn message's `metadata`. Its `event_type` is distinct from the card's, the progress message's and the
 * poll's for the same reason those differ from each other: it is what lets an edit recognise its own
 * message and refuse anything else. `turnId` correlates the message with the turn that owns it.
 */
export interface SlackTurnMetadata {
  readonly event_type: string;
  readonly event_payload: {
    readonly schemaVersion: 1;
    readonly renderer: "slack-turn-v1";
    /** Opaque; carries no prose, no question text and no channel id. */
    readonly turnId: string;
  };
}

/**
 * The exact `chat.postMessage` / `chat.update` arguments for a TURN message.
 *
 * The wrapper carries full chrome and ownership metadata from the initial post onward. Task plus checklist
 * stay in one above-fold content block, with timestamp and provenance below Details.
 */
export interface SlackTurnPayload {
  /** Empty beside attachments to prevent a duplicate body above the wrapper. */
  readonly text: "";
  readonly attachments: readonly [SlackCardWrapper];
  readonly metadata: SlackTurnMetadata;
  readonly unfurl_links: boolean;
  readonly unfurl_media: boolean;
}

/**
 * An ASSISTANT ANSWER message's `metadata`, V1 — no ask identity. Emitted only for a generic handover
 * delivery or a turn's held/failure NOTICE, never for an actual answer as of H6: those two are not
 * something H9's recovery may ever read as "answered", so keeping them on the pre-identity shape is what
 * stops that misreading rather than merely making it less likely.
 *
 * `renderer` is distinct from the card's `"slack-card-v1"` — deliberately, so the card's edit/sweep
 * machinery (`lifecycleGuards.ts`'s `KNOWN_RENDERERS`) never mistakes one for the other, even though both
 * now carry an `attachments` wrapper.
 */
interface SlackAssistantAnswerMetadataV1 {
  readonly event_type: string;
  readonly event_payload: {
    readonly schemaVersion: 1;
    readonly renderer: "slack-assistant-answer-v1";
    readonly artifactFingerprint: string;
  };
}

/**
 * An ASSISTANT ANSWER message's `metadata`, V2 — every actual answer, carrying which ask it answers.
 *
 * `askIdentity` is `RecordedAskIdentity` rather than `AskIdentity`: a schema-1 queue release genuinely does
 * not have an exact addressing timestamp to report, and inventing one here would be the reconstruction this
 * whole contract exists to forbid, just moved into the metadata itself. `quality: "thread-only"` says exactly
 * that rather than a caller silently pretending it does not matter.
 */
interface SlackAssistantAnswerMetadataV2 {
  readonly event_type: string;
  readonly event_payload: {
    readonly schemaVersion: 2;
    readonly renderer: "slack-assistant-answer-v2";
    readonly artifactFingerprint: string;
    readonly askIdentity: RecordedAskIdentity;
  };
}

/**
 * The exact `chat.postMessage` arguments for the bot's own answer message — the SAME measured content as
 * {@link SlackCardPayload}, and now the SAME full chrome too: the coloured `attachments` bar, the author
 * row, the divider and the `*Details*` divider label.
 *
 * The owner's earlier rejection of the card's identity for the owner's own bot's turn has itself been reversed
 * twice over: first to want every bot message carrying the same violet accent, then — after further
 * real-world usage — to want the REST of the card's chrome back too (the author byline, the dividers, the
 * detail label). This still reuses {@link SlackCardWrapper} directly rather than {@link SlackCardPayload}
 * itself, because the wire shape genuinely differs in nothing but which renderer built the `blocks` array;
 * `renderUpdateCard` and {@link SlackCardPayload} stay reserved for the `slack post` operator verb, and this
 * shape is built by `../assistant/answerMessage.ts` reusing `renderChromeBlocks` — never by calling
 * `renderUpdateCard` itself, so it inherits the chrome without inheriting anything else that function does.
 *
 * `text` is the literal empty string, exactly like the card's, and for the identical reason: a non-empty
 * top-level `text` beside `attachments` renders a duplicate body above the wrapper. The wrapper's own
 * `fallback` carries the push notification, sidebar preview and screen-reader line instead.
 */
export interface SlackAssistantAnswerPayloadV1 {
  readonly text: "";
  readonly attachments: readonly [SlackCardWrapper];
  readonly metadata: SlackAssistantAnswerMetadataV1;
  readonly unfurl_links: boolean;
  readonly unfurl_media: boolean;
}

/** The V2 payload — identical shape, carrying V2 metadata with the ask it answers. */
export interface SlackAssistantAnswerPayloadV2 {
  readonly text: "";
  readonly attachments: readonly [SlackCardWrapper];
  readonly metadata: SlackAssistantAnswerMetadataV2;
  readonly unfurl_links: boolean;
  readonly unfurl_media: boolean;
}

/** Either payload version — what `chat.postMessage`/`chat.update` actually sent, for a message read back. */
export type SlackAssistantAnswerPayload = SlackAssistantAnswerPayloadV1 | SlackAssistantAnswerPayloadV2;

/**
 * Who a channel-surface stream is FOR — `chat.startStream`'s own requirement, not this repo's invention.
 * Slack refuses `missing_recipient_user_id` / `missing_recipient_team_id` when a stream opens outside a DM;
 * a DM needs neither, because the recipient is implicit in the conversation itself.
 */
export interface SlackStreamRecipient {
  readonly userId: string;
  readonly teamId: string;
}

/**
 * `chat.startStream`'s arguments beyond `channel`/`thread_ts` — what a stream OPENS with.
 *
 * There is no `metadata` field here because `chat.startStream` does not accept one — measured against the
 * live SDK types (`ChatStartStreamArguments` carries no `Metadata` intersection, unlike
 * {@link SlackStreamClosePayload}'s `chat.stopStream`). A stream's ownership metadata can only attach when
 * it is finalized. Production checklists deliberately do not accept that ownership gap; these types remain
 * for direct, explicitly requested use of the generic streaming transport.
 */
export interface SlackStreamOpenPayload {
  readonly chunks: readonly AnyChunk[];
  readonly taskDisplayMode?: "plan" | "timeline" | "dense" | undefined;
}

/**
 * `chat.stopStream`'s arguments beyond `channel`/`ts` — how a stream FINALIZES.
 *
 * Production turn messages use static post/update calls because they require metadata from the first frame.
 * The generic stream can still be finalized with turn metadata in direct transport probes.
 */
export interface SlackStreamClosePayload {
  readonly chunks?: readonly AnyChunk[] | undefined;
  readonly blocks?: readonly KnownBlock[] | undefined;
  readonly metadata?: SlackTurnMetadata | undefined;
}
