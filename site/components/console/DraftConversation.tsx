"use client";

/*
 * A parked draft drawn INSIDE the conversation it lands in, read live when the card opens: a
 * draft on a queue card drawn alone leaves the owner stepping into Slack to see what came before it, so the card
 * draws the thread (a reply's whole thread, or a post's channel tail) above the draft, native-Slack, every member
 * named, with a link out to the thread itself.
 *
 * Only a HELD draft reads: a sent or dropped one is history, and a live read of where it went answers nothing the
 * owner still has to decide. The read goes through the door (`slack draft context`, `../../app/api/draft-context`) —
 * never a browser and never the corpus, whose copy of a thread is as old as its last export.
 *
 * Rule 7 holds on the card as anywhere: the last few messages are drawn, and everything earlier is FOLDED behind a
 * line that says how many — a thread's root stays drawn, since the reply answers it.
 *
 * A re-ask reads in time order: when our earlier ask is in the conversation it is drawn in place
 * at the top, what was said between folds behind an ellipsis, then the latest messages, then the draft
 * (`../../lib/draftChronology.ts`).
 */

import type { ReactElement, ReactNode } from "react";
import { clauseAfter } from "../../lib/clauseJoin";
import { type ChronologySegment, draftChronology, priorAskInConversation } from "../../lib/draftChronology";
import { readsConversation } from "../../lib/draftReads";
import { consoleHref } from "../../lib/localPageHref";
import type { ContextMessage, DraftContext } from "../live/readDraftContext";
import type { ParkedDraft } from "../live/readSlackDrafts";
import type { RunLabels } from "./DraftLines";
import { PriorAskCard } from "./DraftPriorAsk";
import { ReadingIndicator } from "./ReadingIndicator";
import { SinceDraftedDetails } from "./SinceDraftedDetails";
import { draftChannelNames, Parent, SlackDraft } from "./SlackDraft";
import { counted, LINK, NOTE, SlackMessageRow, sentAt } from "./SlackMessageRow";
import { StaleMark } from "./StaleMark";
import { type DraftContextState, useDraftContext } from "./useDraftContext";

/**
 * One message of the conversation, drawn as Slack draws it, its files COUNTED rather than fetched — a card opened a
 * dozen times a day reads no bytes. The earlier ask a draft repeats is tagged as such.
 */
function Message({
  message,
  labels,
  anchor = false,
}: {
  message: ContextMessage;
  labels: RunLabels;
  anchor?: boolean;
}): ReactElement {
  let files: ReactElement | null = null;
  if (message.fileCount > 0) {
    files = (
      <p className={NOTE}>
        {counted({ count: message.fileCount, many: "files", one: "file" })} attached, not fetched. Open it in Slack to
        see {message.fileCount === 1 ? "it" : "them"}.
      </p>
    );
  }
  return (
    <SlackMessageRow anchor={anchor} files={files} hasFiles={message.fileCount > 0} labels={labels} message={message} />
  );
}

/** What a fold's line says: how many earlier messages, or — between the earlier ask and the latest — an ellipsis. */
function foldSummary({ count, place }: { count: number; place: "earlier" | "between" }): string {
  if (place === "between") {
    return `… ${counted({ count, many: "messages", one: "message" })} between`;
  }
  return counted({ count, many: "earlier messages", one: "earlier message" });
}

/** One stretch of the conversation: a message drawn open, a fold, or the note that nothing was said since. */
function Segment({ segment, labels }: { segment: ChronologySegment<ContextMessage>; labels: RunLabels }): ReactElement {
  if (segment.kind === "quiet-since") {
    return <p className={NOTE}>Nothing has been said since.</p>;
  }
  if (segment.kind === "message") {
    return <Message anchor={segment.anchor} labels={labels} message={segment.message} />;
  }
  return (
    <details className="text-[0.8rem]" data-fold={segment.place}>
      <summary className="cursor-pointer text-muted-foreground">
        {foldSummary({ count: segment.messages.length, place: segment.place })}
      </summary>
      <div className="mt-[0.4rem] grid gap-[0.4rem]">
        {segment.messages.map((message) => (
          <Message key={message.ts} labels={labels} message={message} />
        ))}
      </div>
    </details>
  );
}

/** A stable key for a segment: its first message's ts, or the quiet note's own name. */
function segmentKey({ segment }: { segment: ChronologySegment<ContextMessage> }): string {
  if (segment.kind === "quiet-since") {
    return "quiet-since";
  }
  if (segment.kind === "message") {
    return segment.message.ts;
  }
  return `fold-${segment.place}-${segment.messages[0].ts}`;
}

/**
 * The conversation, read: where it is, when it was read, and its messages in time order with the earlier ones folded —
 * the earlier ask a draft repeats drawn in place when it is here.
 */
function Conversation({
  context,
  anchorTs,
  staleWhy,
  channels,
}: {
  context: DraftContext;
  anchorTs: string | undefined;
  staleWhy: string | undefined;
  channels: ReadonlyMap<string, string>;
}): ReactElement {
  const labels: RunLabels = { channels, mentions: [], people: context.people };
  const segments = draftChronology({ anchorTs, messages: context.messages, scope: context.scope });
  const where = context.scope === "thread" ? "The thread it replies in" : "The channel it posts into";
  let empty: ReactElement | undefined;
  if (context.messages.length === 0) {
    empty = <p className={NOTE}>Nothing has been said here yet. The draft would be the first message.</p>;
  }
  return (
    <section
      aria-label="the conversation it lands in, read live"
      className="grid gap-[0.4rem] border-b border-border pb-[0.6rem]"
    >
      <div className={`${NOTE} flex flex-wrap items-baseline gap-x-2`}>
        <span>
          {where}, read live at {sentAt({ iso: context.observedAtIso })}
        </span>
        {staleWhy !== undefined && (
          <StaleMark
            facts={[{ observedAtIso: context.observedAtIso, subject: "the conversation it lands in", why: staleWhy }]}
          />
        )}
        <a className={LINK} href={consoleHref({ url: context.link })} rel="noreferrer" target="_blank">
          open in Slack →
        </a>
        <SinceDraftedDetails context={context} />
      </div>
      {empty}
      {context.earlierWithheld && <p className={NOTE}>Older messages than these are in Slack.</p>}
      {segments.map((segment) => (
        <Segment key={segmentKey({ segment })} labels={labels} segment={segment} />
      ))}
    </section>
  );
}

/**
 * The space the conversation takes above the draft, the same height whether it is reading, read or failed: the live thread must reserve its space with a placeholder where it will land, never insert itself above
 * the draft later and push it down. It scrolls inside itself, opening on its newest message, which sits right above
 * the draft; unfolding the earlier messages unfolds them inside it.
 */
function ConversationSlot({ children }: { children: ReactNode }): ReactElement {
  return (
    <div data-conversation-slot="" className="flex h-[17rem] flex-col-reverse overflow-y-auto">
      <div className="grid gap-[0.6rem]">{children}</div>
    </div>
  );
}

/** Where a message will land while the conversation reads: the slot's own height, so nothing moves when it lands. */
function ConversationLoading(): ReactElement {
  return (
    <div className="grid gap-[0.6rem]" aria-busy="true">
      <ReadingIndicator label="Reading the conversation it lands in, live from Slack" />
      {[0, 1, 2].map((at) => (
        <div key={at} className="flex animate-pulse gap-2 motion-reduce:animate-none" aria-hidden="true">
          <span className="size-9 flex-none rounded-[6px] bg-muted" />
          <span className="grid flex-1 gap-[0.35rem] pt-[0.2rem]">
            <span className="h-[0.7rem] w-[30%] rounded bg-muted" />
            <span className="h-[0.7rem] w-[85%] rounded bg-muted" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** The ts of the earlier ask a draft repeats, when it declared one. */
function priorAskTs({ draft }: { draft: ParkedDraft }): string | undefined {
  if (draft.priorAsk?.kind !== "prior") {
    return undefined;
  }
  return draft.priorAsk.ours.ts;
}

/**
 * A held draft, with the conversation it lands in drawn above it in its reserved slot. An earlier ask it repeats opens
 * the slot, since it came first — or, once the read finds it in the conversation, is drawn there in time order
 * instead. Either way the change stays inside the slot, so the draft below never moves.
 */
function InConversation({ draft, state }: { draft: ParkedDraft; state: DraftContextState }): ReactElement {
  const anchorTs = priorAskTs({ draft });
  let slot = <ConversationLoading />;
  let priorAskInPlace = false;
  if (state.phase === "ready") {
    // The live messages keep no written channel names, so their chips can name only what the draft knows.
    slot = (
      <Conversation
        anchorTs={anchorTs}
        channels={draftChannelNames({ draft })}
        context={state.context}
        staleWhy={state.stale?.why}
      />
    );
    priorAskInPlace = priorAskInConversation({ anchorTs, messages: state.context.messages });
  } else if (state.phase === "not-measured") {
    slot = (
      <>
        <StaleMark
          facts={[
            {
              subject: "The conversation it lands in",
              why: clauseAfter({ clause: "only the draft is drawn", joint: ";", reason: state.why }),
            },
          ]}
        />
        <Parent draft={draft} />
      </>
    );
  }
  const exchange = priorAskInPlace ? null : (
    <PriorAskCard part="exchange" people={draft.people} prior={draft.priorAsk} />
  );
  return (
    <SlackDraft
      conversation={
        <ConversationSlot>
          {exchange}
          {slot}
        </ConversationSlot>
      }
      draft={draft}
    />
  );
}

/** A held draft that reads its own conversation, for a caller that does not hold the reading itself. */
function HeldInConversation({ draft }: { draft: ParkedDraft }): ReactElement {
  return <InConversation draft={draft} state={useDraftContext({ id: draft.id, reads: true })} />;
}

/**
 * A parked draft as a queue card draws it: a held one inside its live conversation, anything else alone, as the
 * register recorded it.
 *
 * @param draft the parked draft
 * @param context the conversation already read, when the panel reads it once for the draft and its properties alike
 * @returns the draft, in its conversation when it is still waiting on the owner
 */
export function DraftInConversation({
  draft,
  context,
}: {
  draft: ParkedDraft;
  context?: DraftContextState;
}): ReactElement {
  if (!readsConversation({ draft })) {
    return <SlackDraft draft={draft} />;
  }
  if (context !== undefined) {
    return <InConversation draft={draft} state={context} />;
  }
  return <HeldInConversation draft={draft} key={draft.id} />;
}
