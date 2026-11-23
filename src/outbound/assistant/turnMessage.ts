/**
 * The TURN message — the metadata-bearing frame posted and updated throughout a live checklist.
 *
 * Static `chat.postMessage`/`chat.update` gives up Slack's native collapsible plan widget, deliberately. A
 * stream cannot carry ownership metadata until it stops, so a process death can freeze an unrecognisable
 * message that the sanctioned lifecycle door must refuse to delete. Every static frame instead carries the
 * canonical full chrome and metadata from its first visible byte.
 */

import type { RichTextBlock } from "@slack/types";
import { renderFullChromeWrapper } from "../slack/render.js";
import type { SlackTurnMetadata, SlackTurnPayload, TurnChrome } from "../slack/types.js";

import { renderFooter } from "./footer.js";
import { renderLoopBlock, renderTodoBlocks, type TodoStep } from "./todoBlock.js";

/** The `metadata.event_payload.renderer` this module emits. A later edit matches on it. */
export const SLACK_TURN_RENDERER = "slack-turn-v1";

/**
 * The notification fallback — what a push, a sidebar preview or a screen reader gets.
 *
 * Stored on the wrapper, while top-level `text` stays empty so Slack does not duplicate the body.
 *
 * @param chrome the bot's configured name and emoji
 * @param task the current task
 * @returns the fallback text
 */
export function turnFallbackText({ chrome, task }: { chrome: TurnChrome; task: string }): string {
  return `${chrome.authorLabel}: ${task}`;
}

/**
 * The current task followed by the checklist, kept together as the one above-fold content block.
 *
 * ## Why this is NOT the `plan` block, despite the plan block being the owner's own pick
 *
 * The owner compared this `rich_text` checklist, a standalone `task_card`, and a `plan` block across
 * sixty-six live renders and chose the plan block ("plan won") for its one collapsing row. The approved
 * shape was `task_card`s NESTED in a `plan` block's `tasks`; a bare top-level `task_card` was rejected
 * twice in that same session. Rendering the turn card through a plan block was tried and
 * **Slack refused the message**: `chat.update` returned `invalid_attachments`, because this card carries its
 * chrome in an `attachments` container (the violet accent on every bot surface) and `plan` is a
 * top-level block Slack will not accept inside one.
 *
 * That is a live-measured API constraint, not a preference, and the two cannot both be had as things stand:
 * the collapsing row costs the violet chrome, which is its own deliberate decision. So this renderer keeps
 * the chrome and the list, which is the half that carries the SUBSTANCE — ticked lines, each finished step
 * holding its own finding, and the "as of" stamp. Reproduce the refusal by rendering a `plan` block inside
 * `renderTurnMessage`'s attachment and running `slopweaver turn status` against a real card.
 *
 * @param body the rendered checklist
 * @param task the current task, shown above it
 * @returns the one above-fold content block
 */
function turnContentBlock({ body, task }: { body: RichTextBlock; task: string }): RichTextBlock {
  return {
    elements: [
      {
        elements: [{ style: { bold: true }, text: task, type: "text" }],
        type: "rich_text_section",
      },
      ...body.elements,
    ],
    type: "rich_text",
  };
}

/**
 * Render one frame of the turn message.
 *
 * Deterministic: no clock is read, so frame N is byte-comparable in a test and re-rendering the same
 * progress twice produces the same bytes — which is what makes an edit idempotent rather than a
 * cosmetically different message.
 *
 * @param chrome the bot's configured full chrome and metadata event type
 * @param task the current task, shown above the checklist
 * @param turnId the id correlating this message with its turn; opaque, carries no prose
 * @param steps the checklist, in display order
 * @param asOfEpochSeconds when the checklist was last written, in whole seconds
 * @param asOfFallback the literal text to show where the date token cannot be rendered
 * @param modelId the model driving it
 * @param configureUrl the per-channel configure link, omitted when the deployment has none
 * @returns the exact `chat.postMessage` / `chat.update` arguments
 */
export function renderTurnMessage({
  chrome,
  task,
  turnId,
  steps,
  asOfEpochSeconds,
  asOfFallback,
  modelId,
  configureUrl,
}: {
  chrome: TurnChrome;
  task: string;
  turnId: string;
  steps: readonly TodoStep[];
  asOfEpochSeconds: number;
  asOfFallback: string;
  modelId: string;
  configureUrl?: string | undefined;
}): SlackTurnPayload {
  const [body, asOf] = renderTodoBlocks({ asOfEpochSeconds, asOfFallback, steps });
  // The planning loop sits BELOW the Details label: the meter and outline above the fold say where the turn
  // is, and the story of how it got there is one expand away (`AGENTS.md` rule 7).
  const loop = renderLoopBlock({ steps });
  const footer = renderFooter({
    modelId,
    ...(configureUrl === undefined ? {} : { configureUrl }),
  });
  const metadata: SlackTurnMetadata = {
    event_payload: { renderer: SLACK_TURN_RENDERER, schemaVersion: 1, turnId },
    event_type: chrome.metadataEventType,
  };
  const fallback = turnFallbackText({ chrome, task });
  return {
    attachments: [
      renderFullChromeWrapper({
        chrome,
        content: turnContentBlock({ body, task }),
        details: loop === undefined ? [asOf, footer] : [loop, asOf, footer],
        fallback,
      }),
    ],
    metadata,
    text: "",
    unfurl_links: false,
    unfurl_media: false,
  };
}
