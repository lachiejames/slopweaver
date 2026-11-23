/**
 * The bot's own ANSWER message — the same measured content as the operator card (`../slack/render.ts`),
 * wrapped in the SAME `attachments` bar and now carrying the SAME full chrome: the author-row byline, the
 * dividers, the `*Details*` label. Full chrome, everywhere, not a stripped-down variant.
 *
 * This reversed an earlier, deliberate hard line — accent-only, never the rest of the card's identity — set
 * after the owner rejected the card's whole identity for the owner's own bot turn: a response from the bot
 * must not show teal banners inside Slack. Real-world usage changed that: every bot message now reads exactly
 * like the operator's own card, chrome included.
 *
 * This module is still a SECOND renderer over the SAME measured content, not a call into `renderUpdateCard`
 * itself — reusing `renderChromeBlocks`, `renderDetail` and (through it) `renderLeadBlock` verbatim is what
 * makes that a fact rather than a claim: the chrome layout, the paragraph-gap rules, the table-split, the
 * fold-avoidance arithmetic all live in exactly one place, and this module never touches any of it.
 * `renderUpdateCard` and `SlackCardPayload` are UNCHANGED and stay reserved for the `slack post` operator
 * verb, which the owner explicitly wants kept for the rare moment it is needed — this module never calls it
 * and never inherits anything beyond the chrome blocks it renders.
 *
 * `text` is the literal empty string, exactly like the card's, and for the identical reason: a non-empty
 * top-level `text` beside `attachments` renders a DUPLICATE body above the wrapper. The wrapper's own
 * `fallback` field carries the push notification, sidebar preview and screen-reader line instead.
 */
import type { KnownBlock } from "@slack/types";

import type { RecordedAskIdentity } from "../../live/ask/identity.js";
import type { IndexStyle, UpdateArtifact } from "../artifact/types.js";
import { answerFormFingerprint, artifactFingerprint } from "../slack/fingerprint.js";
import { redactWrapper } from "../slack/piiRedaction.js";
import { FOLD_AFTER_BLOCKS } from "../slack/preview.js";
import { type ResolvedMentions, renderChromeBlocks, renderDetail } from "../slack/render.js";
import { withSearchableFallback } from "../slack/searchableFallback.js";
import type {
  SlackAssistantAnswerPayloadV1,
  SlackAssistantAnswerPayloadV2,
  SlackCardChrome,
  SlackCardWrapper,
} from "../slack/types.js";
import type { AnswerFormAnswer } from "./answerForm.js";
import { evidenceTrailFor, renderEvidenceTrail } from "./evidence.js";

/** The V1 `metadata.event_payload.renderer` — a generic handover delivery or a turn's held/failure notice. */
const ASSISTANT_ANSWER_RENDERER = "slack-assistant-answer-v1";

/** The V2 renderer — every actual answer, carrying which ask it answers. */
const ASSISTANT_ANSWER_RENDERER_V2 = "slack-assistant-answer-v2";

/**
 * `metadata.event_type` for a V1 assistant message — distinct from the card's, the progress message's, the
 * poll's and the turn's, for the same reason those differ from one another: it is what would let a future
 * edit or sweep recognise its own message.
 */
export const ASSISTANT_ANSWER_EVENT_TYPE = "slopweaver_assistant_answer_v1";

/** `metadata.event_type` for a V2 assistant answer — an actual answer, carrying `askIdentity`. */
export const ASSISTANT_ANSWER_EVENT_TYPE_V2 = "slopweaver_assistant_answer_v2";

/** The wrapper every answer message shares: the accent bar, never the card's author-row/divider chrome. */
function answerWrapper({
  blocks,
  fallback,
  bannerColor,
}: {
  blocks: readonly KnownBlock[];
  fallback: string;
  bannerColor: string;
}): SlackCardWrapper {
  // Every answer message crosses the PII pass HERE, which is the one place all three answer renderers below
  // share. Nothing masks in what the bot READS, and the redaction lands at the post.
  // This path IS the post, and `renderUpdateCard`'s own pass does not reach it — none of these renderers
  // goes through `renderUpdateCard`, which is how the bot's own answers were missed on the first attempt.
  // The fallback also carries every GitHub object the blocks cite, because search never reads inside the wrapper.
  return redactWrapper({ wrapper: withSearchableFallback({ wrapper: { blocks, color: bannerColor, fallback } }) });
}

/**
 * How an update artifact's index renders. `UpdateArtifact.indexStyle` is optional and declares an unset one as
 * Slack's own bulleted list (the default) — a composer opts INTO `plain` or `ordered`.
 */
function artifactIndexStyle({ artifact }: { artifact: UpdateArtifact }): IndexStyle {
  const { indexStyle } = artifact;
  if (indexStyle === undefined) {
    return "bullet";
  }
  return indexStyle;
}

/**
 * How an answer form's index renders. The form's `indexStyle` is optional and, matching the update artifact's,
 * reads an unset one as bullets — a plain prose answer never names a style at all.
 */
function answerIndexStyle({ answer }: { answer: AnswerFormAnswer }): IndexStyle {
  const { indexStyle } = answer;
  if (indexStyle === undefined) {
    return "bullet";
  }
  return indexStyle;
}

/** The blocks shared by every `UpdateArtifact`-shaped render — the card's full chrome plus detail. */
function artifactBlocks({
  artifact,
  chrome,
  mentions,
}: {
  artifact: UpdateArtifact;
  chrome: SlackCardChrome;
  mentions: ResolvedMentions;
}): readonly KnownBlock[] {
  return [
    ...renderChromeBlocks({
      chrome,
      citations: artifact.citations,
      index: artifact.index,
      indexStyle: artifactIndexStyle({ artifact }),
      mentions,
      primaryLink: artifact.primaryLink,
      tldr: artifact.tldr,
    }),
    ...renderDetail({ citations: artifact.citations, detail: artifact.detail, mentions }),
  ];
}

/**
 * Render an `update` artifact as a V1 assistant message — a generic handover delivery, or a turn's
 * held/failure NOTICE. NEVER an actual answer as of H6: those go through {@link renderAssistantAskMessage}
 * or {@link renderAssistantAnswer} instead, so that a message H9 could ever read as "answered" always
 * carries `askIdentity`.
 *
 * @param artifact the validated artifact
 * @param mentions identity-map keys already resolved to Slack user ids
 * @param chrome the operator's card chrome, from `chromeFromProfile({home})` — the one chrome source every
 *   bot message now shares
 * @returns the exact `chat.postMessage` arguments, minus the channel
 */
export function renderAssistantMessage({
  artifact,
  mentions,
  chrome,
}: {
  artifact: UpdateArtifact;
  mentions: ResolvedMentions;
  chrome: SlackCardChrome;
}): SlackAssistantAnswerPayloadV1 {
  const blocks = artifactBlocks({ artifact, chrome, mentions });
  return {
    attachments: [answerWrapper({ bannerColor: chrome.bannerColor, blocks, fallback: artifact.tldr })],
    metadata: {
      event_payload: {
        artifactFingerprint: artifactFingerprint({ artifact }),
        renderer: ASSISTANT_ANSWER_RENDERER,
        schemaVersion: 1,
      },
      event_type: ASSISTANT_ANSWER_EVENT_TYPE,
    },
    text: "",
    unfurl_links: false,
    unfurl_media: false,
  };
}

/**
 * Neutral filler so the evidence trail always starts PAST the fold, never as a byproduct of how long the
 * reply happens to be. Rule 7 says the evidence goes below the fold; measured against a real send, that was
 * false for anything short — a bare "yo" put `renderEvidenceTrail`'s three blocks (couldNotSee, provenance,
 * and sometimes more) in plain view, because `lead + body` alone never reached the five-block threshold
 * a card's `Details` label sits at (`FOLD_AFTER_BLOCKS`, `../slack/preview.js` — a chrome landmark, not a
 * fold prediction).
 *
 * Plain `divider`s, not more chrome: `precedingBlockCount` now includes `renderChromeBlocks`'s own five
 * fixed blocks (author row, divider, lead, divider, detail label), so in practice this returns nothing for
 * every real reply — the chrome alone reaches the fold threshold. It stays as a correctness backstop rather
 * than being deleted, because nothing about the chrome's block count is a compile-time guarantee.
 *
 * @param precedingBlockCount how many blocks come before the evidence trail (the chrome, plus the body)
 * @returns exactly enough `divider` blocks that the evidence trail starts at index {@link FOLD_AFTER_BLOCKS}
 *   or later, or none at all once the reply is already long enough on its own
 */
function evidenceFoldPadding({ precedingBlockCount }: { precedingBlockCount: number }): readonly KnownBlock[] {
  const needed = Math.max(0, FOLD_AFTER_BLOCKS - precedingBlockCount);
  return Array.from({ length: needed }, () => ({ type: "divider" }));
}

/**
 * Render a parsed answer FORM as the bot's own top-level answer message — the full operator-card chrome,
 * and — unlike {@link renderAssistantMessage} — an evidence trail appended after the body, naming what
 * actually grounded the reply. This is the entrypoint `turn answer` and a fresh queue release use for every
 * route; `renderAssistantMessage` stays reserved for the notice builders (`turnFailureForm`, `turnHeldForm`)
 * that still produce a plain `UpdateArtifact`.
 *
 * V2, always: this function renders an actual answer, never a notice, so it always carries `askIdentity` —
 * exact for a fresh turn, `quality: "thread-only"` for a queue row that never earned a `messageTs`.
 *
 * `images` is intentionally never read here: it is the upload INPUT to the composite sender, never a
 * rendered field, so a caller cannot accidentally emit it as content.
 *
 * @param answer the validated answer form
 * @param askIdentity which ask this message answers
 * @param mentions identity-map keys already resolved to Slack user ids
 * @param chrome the operator's card chrome, from `chromeFromProfile({home})` — the one chrome source every
 *   bot message now shares
 * @returns the exact `chat.postMessage` arguments, minus the channel
 */
export function renderAssistantAnswer({
  answer,
  askIdentity,
  mentions,
  chrome,
}: {
  answer: AnswerFormAnswer;
  askIdentity: RecordedAskIdentity;
  mentions: ResolvedMentions;
  chrome: SlackCardChrome;
}): SlackAssistantAnswerPayloadV2 {
  const primaryLink =
    answer.answering === undefined ? undefined : { label: answer.answering.quote, url: answer.answering.permalink };
  const trail = evidenceTrailFor({ answer });
  const chromeAndBody: readonly KnownBlock[] = [
    ...renderChromeBlocks({
      chrome,
      citations: answer.citations,
      index: answer.index,
      indexStyle: answerIndexStyle({ answer }),
      mentions,
      primaryLink,
      tldr: answer.lead,
    }),
    ...renderDetail({ citations: answer.citations, detail: answer.body, mentions }),
  ];
  const blocks: readonly KnownBlock[] = [
    ...chromeAndBody,
    ...evidenceFoldPadding({ precedingBlockCount: chromeAndBody.length }),
    ...renderEvidenceTrail({ measurements: answer.measurements, provenance: answer.grounding.provenance, trail }),
  ];
  return {
    attachments: [answerWrapper({ bannerColor: chrome.bannerColor, blocks, fallback: answer.lead })],
    metadata: {
      event_payload: {
        artifactFingerprint: answerFormFingerprint({ answer }),
        askIdentity,
        renderer: ASSISTANT_ANSWER_RENDERER_V2,
        schemaVersion: 2,
      },
      event_type: ASSISTANT_ANSWER_EVENT_TYPE_V2,
    },
    text: "",
    unfurl_links: false,
    unfurl_media: false,
  };
}

/**
 * Render a card queue draft — a plain `UpdateArtifact` rather than a structured answer form —
 * as the bot's own V2 answer message. This IS an answer, unlike {@link renderAssistantMessage}'s notices,
 * so it carries `askIdentity` the same way {@link renderAssistantAnswer} does; it differs only in reading an
 * `UpdateArtifact` rather than an `AnswerFormAnswer`, because that is the shape a card draft has.
 *
 * @param artifact the validated card draft
 * @param askIdentity which ask this message answers (always `quality: "thread-only"` in practice — a card
 *   draft is a schema-1 row, which records no addressing timestamp)
 * @param mentions identity-map keys already resolved to Slack user ids
 * @param chrome the operator's card chrome, from `chromeFromProfile({home})`
 * @returns the exact `chat.postMessage` arguments, minus the channel
 */
export function renderAssistantAskMessage({
  artifact,
  askIdentity,
  mentions,
  chrome,
}: {
  artifact: UpdateArtifact;
  askIdentity: RecordedAskIdentity;
  mentions: ResolvedMentions;
  chrome: SlackCardChrome;
}): SlackAssistantAnswerPayloadV2 {
  const blocks = artifactBlocks({ artifact, chrome, mentions });
  return {
    attachments: [answerWrapper({ bannerColor: chrome.bannerColor, blocks, fallback: artifact.tldr })],
    metadata: {
      event_payload: {
        artifactFingerprint: artifactFingerprint({ artifact }),
        askIdentity,
        renderer: ASSISTANT_ANSWER_RENDERER_V2,
        schemaVersion: 2,
      },
      event_type: ASSISTANT_ANSWER_EVENT_TYPE_V2,
    },
    text: "",
    unfurl_links: false,
    unfurl_media: false,
  };
}
