/**
 * The panels for what waits on the owner's word as a held thing: a held reply, a parked as-me draft, a parked review of a
 * colleague's pull request, and a question a store import staged.
 */
import { type ReactElement } from "react";

import { prLabel } from "../../lib/askLinks";
import { threadPeopleOf } from "../../lib/cardProperties";
import { readsConversation } from "../../lib/draftReads";
import { recordLine, recordLink } from "../../lib/recordLines";
import { type ImportQuestionView } from "../live/readImportQuestions";
import { type ParkedReview } from "../live/readReviewDrafts";
import { type ParkedDraft } from "../live/readSlackDrafts";
import { type HeldDraft } from "../live/readThread";
import { SLIDE_FOOT_NOTE, SlideFoot, SlideOver } from "../live/SlideOver";
import { type LiveState } from "../live/useLive";
import { DraftComparison } from "./DraftComparison";
import { useCardReferences } from "./InlineText";
import { Reasoning } from "./PanelReasoning";
import { QueueCardBody } from "./QueueCardBody";
import { type PanelCommon, RECORD_SUMMARY, refusedProps } from "./QueuePanelsCommon";
import { RecordLines } from "./RecordLines";
import { ReviewDraft } from "./ReviewDraft";
import { DraftReleaseNote } from "./SlackDraft";
import { SlackThread } from "./SlackThread";
import { threadLinks } from "./threadLinks";
import { useDraftContext } from "./useDraftContext";

/** The held reply: the card, the thread it answers, and the composer holding the draft. */
export function DraftPanel({
  draft,
  drafts,
  row,
  gone,
  head,
  known,
}: PanelCommon & { draft: HeldDraft; drafts: LiveState<readonly HeldDraft[]> }): ReactElement {
  let held: readonly HeldDraft[] | undefined = [draft];
  if (drafts.phase === "ready") {
    held = drafts.value;
  }
  // The thread and the held reply under it sit in the card's draft slot, above the options that decide it.
  const details = (
    <>
      <RecordLines
        known={known}
        summary={RECORD_SUMMARY}
        // No id or channel id: internals the card never shows; the thread above says where it lands.
        lines={[
          recordLine({ label: "asked by", value: draft.askedBy }),
          recordLine({ label: "question", value: draft.question }),
          recordLine({ label: "held because", value: draft.reason }),
        ]}
      />
    </>
  );
  const footer = (
    <SlideFoot>
      <details className={SLIDE_FOOT_NOTE}>
        <summary className="cursor-pointer">how to release or drop it</summary>
        <code>slopweaver queue release {draft.id}</code> posts it through the door with the withhold recorded as waived;{" "}
        <code>queue drop {draft.id}</code> discards it. Neither is a press here yet; the release needs its own dry-run
        in front of you first.
      </details>
    </SlideFoot>
  );
  return (
    <SlideOver {...head} footer={footer}>
      <QueueCardBody
        card={row.card}
        source={row.source}
        known={known}
        {...refusedProps({ row })}
        preview={<SlackThread id={`${draft.channel}:${draft.threadTs}`} drafts={held} />}
        details={details}
        aside={
          <Reasoning
            card={row}
            gone={gone}
            goneWord="the register no longer holds this reply; it was released through the door or dropped"
          />
        }
      />
    </SlideOver>
  );
}

/**
 * The parked as-me draft: the card, the message drawn as Slack would draw it inside the conversation it lands in
 * (read live when the card opens), and the send command.
 */
export function PostPanel({ post, row, gone, head, known }: PanelCommon & { post: ParkedDraft }): ReactElement {
  // The conversation it lands in is read ONCE here, so the draft's slot and the "In thread" property are the same reading.
  const context = useDraftContext({ id: post.id, reads: readsConversation({ draft: post }) });
  const references = useCardReferences();
  let properties = row.properties;
  if (properties.thread?.kind === "loading") {
    properties = { ...properties, thread: threadPeopleOf({ people: references.people, state: context }) };
  }
  // The draft sits in the card's own draft slot, above the options, never down among the record's fields: the
  // options are choices about it, and one the owner has to scroll past the card to find is one the card did not show. Who it
  // tags is the "Tags" property, and its id, channel id and digest are internals the card never shows.
  const details = (
    <RecordLines known={known} summary={RECORD_SUMMARY} lines={[recordLine({ label: "for", value: post.why })]} />
  );
  const footer = (
    <SlideFoot>
      <details className={SLIDE_FOOT_NOTE}>
        <summary className="cursor-pointer">how to send or drop it</summary>
        <DraftReleaseNote draft={post} />; <code>slack draft drop {post.id} --note &quot;…&quot;</code> discards it.
        Neither is a press here: it would go out under your own name, so the act stays a command you run.
      </details>
    </SlideFoot>
  );
  return (
    <SlideOver {...head} footer={footer}>
      <QueueCardBody
        card={row.card}
        source={row.source}
        known={known}
        {...refusedProps({ row })}
        {...threadLinks({ pages: row.card.pages, post })}
        preview={<DraftComparison draft={post} context={context} />}
        details={details}
        aside={
          <Reasoning
            card={{ ...row, properties }}
            gone={gone}
            goneWord="the register no longer holds this draft; it was sent or dropped"
          />
        }
      />
    </SlideOver>
  );
}

/** The parked review of a colleague's pull request: the card, every comment drawn on its hunk, and the post command. */
export function ReviewPanel({ review, row, gone, head, known }: PanelCommon & { review: ParkedReview }): ReactElement {
  const details = (
    <RecordLines
      known={known}
      summary={RECORD_SUMMARY}
      // The pull request alone: its id, head commit and digest are internals the card never shows.
      lines={[recordLink({ label: "pull request", text: prLabel({ url: review.url }), url: review.url })]}
    />
  );
  const footer = (
    <SlideFoot>
      <details className={SLIDE_FOOT_NOTE}>
        <summary className="cursor-pointer">how to drop it</summary>
        <code>github review-draft drop {review.id} --note &quot;…&quot;</code> discards it. Neither posting nor dropping
        is a press here: the review would land under your own name on a colleague&apos;s pull request, so the act stays
        a command you run.
      </details>
    </SlideFoot>
  );
  return (
    <SlideOver {...head} footer={footer}>
      <QueueCardBody
        card={row.card}
        source={row.source}
        known={known}
        {...refusedProps({ row })}
        preview={<ReviewDraft review={review} />}
        details={details}
        aside={
          <Reasoning
            card={row}
            gone={gone}
            goneWord="the register no longer holds this review; it was posted or dropped"
          />
        }
      />
    </SlideOver>
  );
}

/**
 * A question a store import staged: the card, whose options each print the exact `store import-resolve` command, and
 * the staged row's own fields folded under the record. No press: an answer changes this installation's store, so it
 * stays a command the owner runs.
 */
export function ImportPanel({
  question,
  row,
  gone,
  head,
  known,
}: PanelCommon & { question: ImportQuestionView }): ReactElement {
  const details = (
    <RecordLines
      known={known}
      summary={RECORD_SUMMARY}
      lines={[
        recordLine({ label: "batch", value: question.batchId }),
        recordLine({ label: "part", value: question.part }),
        recordLine({ label: "key", value: question.key }),
        recordLine({ label: "kind", value: question.kind }),
        recordLine({ label: "imported", value: question.imported }),
        ...(question.current === undefined ? [] : [recordLine({ label: "current", value: question.current })]),
        recordLine({ label: "staged", value: question.stagedAtIso }),
      ]}
    />
  );
  const footer = (
    <SlideFoot>
      <details className={SLIDE_FOOT_NOTE}>
        <summary className="cursor-pointer">how to answer it</summary>
        <code>slopweaver store import-resolve --question {question.questionId} --action &lt;answer&gt;</code> records
        one answer, each option above printing its own. None is a press here: an answer changes this installation&apos;s
        store, so the act stays a command you run.
      </details>
    </SlideFoot>
  );
  return (
    <SlideOver {...head} footer={footer}>
      <QueueCardBody
        card={row.card}
        source={row.source}
        known={known}
        {...refusedProps({ row })}
        details={details}
        aside={
          <Reasoning
            card={row}
            gone={gone}
            goneWord="the import-question register no longer holds this question; it was answered"
          />
        }
      />
    </SlideOver>
  );
}
