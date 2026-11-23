/**
 * Which `metadata.event_type` each kind of message this bot posts carries — the ONE table `slack delete` accepts
 * from and `slack edit --as bot` sorts its target by. One table for both verbs, because two lists drifted before:
 * delete was widened to the assistant answer while edit was not (`./lifecycleRunEdit.ts`), and the
 * turn checklist and poll the same way, which is what this module's edit half closes.
 *
 * Edit reads ownership against EVERY kind, then refuses by kind: a progress spinner or a notice has no renderer
 * (`./lifecycleEditErrors.ts`), and a message of another kind than the form names is re-drawn only by its own.
 * Reading the narrow list instead answered such a target "event_type … which this operation does not accept",
 * naming no route.
 */
import type { PostedMessage, SlackWriteTransport } from "../../../corpus/slack/writeTransport.js";
import {
  ASSISTANT_ANSWER_EVENT_TYPE,
  ASSISTANT_ANSWER_EVENT_TYPE_V2,
} from "../../../outbound/assistant/answerMessage.js";
import type { ReadSlackMessage } from "../../../outbound/slack/lifecycleGuards.js";
import { NOTICE_METADATA_EVENT_TYPE } from "../../../outbound/slack/noticeMetadata.js";
import {
  DEFAULT_POLL_METADATA_EVENT_TYPE,
  DEFAULT_PROGRESS_METADATA_EVENT_TYPE,
  DEFAULT_TURN_METADATA_EVENT_TYPE,
} from "../../../profile.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import { type BotMessageKind, SlackEditTargetErrors } from "./lifecycleEditErrors.js";
import { acceptedCardEventTypes, requireOwnership } from "./lifecycleRunGuards.js";
import { usage } from "./lifecycleRunShared.js";
import type { LifecycleDeps } from "./lifecycleRunTypes.js";

/** The slice of the lifecycle world the table is read from. */
type EventTypeDeps = Pick<LifecycleDeps, "cardChrome" | "pollEventType" | "standaloneProgressEventType">;

/**
 * Every event type each kind of bot message may carry, in the order a target is sorted by.
 *
 * The stock progress and poll types ride beside the profile's own, for the migration reason `cardEventTypes` keeps
 * the stock card type: a renamed profile must still reach messages posted before the rename. The checklist carries
 * only the stock turn type, because `turnChromeFrom` stamps it on every frame whatever the card type is. A kind
 * missing here is one `slack delete` cannot retract, however `KNOWN_RENDERERS` reads: ownership refuses on the
 * event type before it looks at the renderer. A poll is a live thing people click, so a mis-posted one must come
 * down; a notice is here because one stood in Slack after they asked for it gone twice.
 *
 * @param deps the profile reads for the card, progress and poll types
 * @param home the state home the profile is read from
 * @returns per kind, the event types a message of that kind carries
 */
export function botMessageEventTypes({
  deps,
  home,
}: {
  deps: EventTypeDeps;
  home: string;
}): Readonly<Record<BotMessageKind, readonly string[]>> {
  return {
    answer: [ASSISTANT_ANSWER_EVENT_TYPE, ASSISTANT_ANSWER_EVENT_TYPE_V2],
    card: acceptedCardEventTypes({ chrome: deps.cardChrome({ home }) }),
    checklist: [DEFAULT_TURN_METADATA_EVENT_TYPE],
    notice: [NOTICE_METADATA_EVENT_TYPE],
    poll: [deps.pollEventType({ home }), DEFAULT_POLL_METADATA_EVENT_TYPE],
    progress: [deps.standaloneProgressEventType({ home }), DEFAULT_PROGRESS_METADATA_EVENT_TYPE],
  };
}

/**
 * The renderers a message of each kind is laid out by: the second witness beside the event type. A message whose
 * event type says poll and whose renderer says card is one whose kind cannot be told, and re-drawing it through
 * either renderer would swap one shape for another; and where a profile reuses one event
 * type for two kinds, the renderer is what still tells them apart. A card-typed message is laid out by the
 * card or the no-fold renderer, both of which the card form re-draws.
 */
const RENDERERS_OF: Readonly<Record<BotMessageKind, readonly string[]>> = {
  answer: ["slack-assistant-answer-v1", "slack-assistant-answer-v2"],
  card: ["slack-card-v1", "slack-no-fold-v1"],
  checklist: ["slack-turn-v1"],
  notice: ["slack-notice-v1"],
  poll: ["slack-poll-v1"],
  progress: ["slack-progress-v1"],
};

/** The order the table is flattened in for delete, and kinds are listed in. */
const KIND_ORDER: readonly BotMessageKind[] = ["card", "answer", "checklist", "poll", "progress", "notice"];

/**
 * Every metadata event type `slack delete --as bot` accepts as one of this bot's own messages: all of them.
 *
 * @param deps the profile reads for the card, progress and poll types
 * @param home the state home the profile is read from
 * @returns the accepted event types, deduplicated
 */
export function deletableEventTypes({ deps, home }: { deps: EventTypeDeps; home: string }): readonly string[] {
  const table = botMessageEventTypes({ deps, home });
  return [...new Set(KIND_ORDER.flatMap((kind) => table[kind]))];
}

/**
 * Every kind of bot message an event type marks. More than one is a profile that reuses a type across kinds (the
 * card type is free text, so `slopweaver_notice_v1` is a valid one): edit lets the renderer settle it, and refuses
 * rather than guess when the renderer does not, because the first match would re-draw a notice as a card.
 *
 * @param eventType the target's `metadata.event_type`
 * @param table per kind, the event types it carries
 * @returns each kind whose types include it, in table order; empty for none
 */
export function botMessageKindsOf({
  eventType,
  table,
}: {
  eventType: string | undefined;
  table: Readonly<Record<BotMessageKind, readonly string[]>>;
}): readonly BotMessageKind[] {
  return KIND_ORDER.filter((kind) => eventType !== undefined && table[kind].includes(eventType));
}

/**
 * Read the edit's target back, refuse it unless this bot posted it, then refuse it unless it is the kind the form
 * re-draws. Ownership failures exit 1 as they always did; a wrong-kind target is the caller's mistake, so exit 2.
 *
 * @param formKind the kind of message the form re-renders
 * @param transport the write transport the read goes through
 * @param posted the message being edited
 * @param deps the profile reads for the event-type table
 * @param home the state home the profile is read from
 * @returns the read-back when it may be edited, else the exit code, having already printed why
 */
export async function requireEditTarget({
  formKind,
  transport,
  posted,
  deps,
  home,
}: {
  formKind: BotMessageKind;
  transport: SlackWriteTransport;
  posted: PostedMessage;
  deps: EventTypeDeps;
  home: string;
}): Promise<{ readonly message: ReadSlackMessage } | { readonly exit: number }> {
  const table = botMessageEventTypes({ deps, home });
  const message = await requireOwnership({
    expectedEventTypes: deletableEventTypes({ deps, home }),
    posted,
    transport,
  });
  if (message === undefined) {
    return { exit: EXIT_ERROR };
  }
  const at = `${posted.channel}/${posted.ts}`;
  const kinds = botMessageKindsOf({ eventType: message.metadataEventType, table });
  // `renderer` is never undefined here: ownership refuses a message naming no known renderer.
  const renderer = message.renderer!;
  const witnessed = kinds.filter((kind) => RENDERERS_OF[kind].includes(renderer));
  if (kinds.length > 1 && witnessed.length !== 1) {
    const ambiguous = SlackEditTargetErrors.ambiguous({ at, eventType: message.metadataEventType!, kinds });
    return { exit: usage({ errors: [ambiguous.message] }) };
  }
  // `kinds` is never empty: ownership already accepted the type, and every accepted type is in the table.
  const kind = kinds.length > 1 ? witnessed[0]! : kinds[0]!;
  if (kind === "progress" || kind === "notice") {
    return { exit: usage({ errors: [SlackEditTargetErrors.unsupported({ at, kind }).message] }) };
  }
  if (kind !== formKind) {
    return { exit: usage({ errors: [SlackEditTargetErrors.formMismatch({ at, formKind, found: kind }).message] }) };
  }
  if (!RENDERERS_OF[kind].includes(renderer)) {
    return { exit: usage({ errors: [SlackEditTargetErrors.rendererMismatch({ at, kind, renderer }).message] }) };
  }
  return { message };
}
