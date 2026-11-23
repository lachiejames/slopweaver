/** The hand step's panel: the step's own card, and the two verbs that act on it. */
import { type ReactElement, type ReactNode } from "react";

import { HAND_DONE_WORDS, HAND_SNOOZE_BUTTONS } from "../../lib/actVerbs";
import { drawnThreadOf } from "../../lib/cardLoading";
import {
  ASK_PENDING_SUBJECT,
  type AskPending,
  type LinkedHandDecision,
  type OpenedAskOffer,
} from "../../lib/handStepAsk";
import { askMailThread } from "../../lib/mailAnchor";
import { type ActCardForm } from "../../lib/queueActRow";
import { type ReasonWords } from "../../lib/quotedReason";
import { type RecordLine, recordLine } from "../../lib/recordLines";
import { type NamedDraft } from "../../lib/slackDraftIds";
import { type HandStep } from "../live/read";
import { mailReplyOf } from "../live/readAction";
import { type HeldDraft } from "../live/readThread";
import { SlideFoot, SlideOver } from "../live/SlideOver";
import { type LiveState } from "../live/useLive";
import { BUTTON, BUTTON_PRIMARY } from "./controls";
import { HandShot } from "./HandShot";
import { MailActionPreview } from "./MailActionPreview";
import { MailThread } from "./MailThread";
import { NamedDrafts } from "./NamedDrafts";
import { Reasoning } from "./PanelReasoning";
import { Outcome, usePress } from "./press";
import { QueueCardBody } from "./QueueCardBody";
import { HeldDraftsThread } from "./QueuePanelMarks";
import { askPlaces } from "./QueuePanelsAsk";
import { type PanelCommon, RECORD_SUMMARY } from "./QueuePanelsCommon";
import { ReadingIndicator } from "./ReadingIndicator";
import { RecordLines } from "./RecordLines";
import { SecretFields } from "./SecretFields";
import { SlackActionPreview } from "./SlackActionPreview";
import { StaleMark } from "./StaleMark";

/**
 * The hand step's panel: the step's own card, and the two verbs that act on it.
 *
 * `hand done` needs `--did` — what actually happened — so the footer collects it rather than inventing one.
 * Not now is one button per snooze answer — never a bare dismiss: `hand snooze` takes the native note down until
 * the chosen time and leaves the step OPEN, which each button's title says.
 * Nothing here restates the step: its fields are the card's rows, and a folded copy of them, or a footer sentence
 * the same on every step, is boilerplate.
 *
 * @returns the panel
 */
export function HandPanel({
  step,
  decision,
  drafts,
  named,
  offer,
  askPending,
  form,
  row,
  gone,
  head,
  known,
}: PanelCommon & {
  step: HandStep;
  decision: LinkedHandDecision | undefined;
  drafts: LiveState<readonly HeldDraft[]>;
  named: readonly NamedDraft[];
  offer: OpenedAskOffer | undefined;
  askPending: AskPending | undefined;
  form: ActCardForm;
}): ReactElement {
  const { press, state } = usePress({ settles: row.key });
  const busy = state.phase === "sending";
  // A decision step points at the ask that holds its choice: the ask's own document first, then every place
  // the ask names — the context the owner needs to decide.
  let context: RecordLine[] = [];
  let preview: ReactNode;
  if (decision !== undefined) {
    context = [
      recordLine({
        label: "decision",
        value: `~/.slopweaver/handovers/${decision.ask.slug}.md`,
      }),
      ...askPlaces({
        boardRow: decision.ask,
        card: row.card,
        mail: askMailThread({ replyTo: mailReplyOf({ action: decision.ask.action }), row: decision.ask }),
        thread: decision.threadUrl,
      }),
    ];
  }
  // The message the opened ask offers is drawn as the ask's own card draws it, so a step whose ask carries a reply
  // never leaves the card drawing none of it.
  let offered: ReactNode;
  if (askPending?.phase === "reading") {
    // Not yet known is a spinner, never an empty slot, a missing draft, or the invalid offer of a reading being
    // replaced — pending is only ever set over an offer carrying no message.
    offered = <ReadingIndicator label={`Reading ${ASK_PENDING_SUBJECT}`} block />;
  } else if (askPending?.phase === "not-measured") {
    offered = <StaleMark facts={[{ subject: ASK_PENDING_SUBJECT, why: askPending.why }]} block />;
  } else if (offer?.action.kind === "mail") {
    // A reply is drawn under the thread it answers, as the ask's own card draws it, so the press never claims a
    // thread the card does not show.
    const { replyTo } = offer.action.mail;
    offered = (
      <>
        {replyTo !== undefined && <MailThread id={replyTo} key={replyTo} />}
        <MailActionPreview mail={offer.action.mail} slug={offer.slug} whole={false} />
      </>
    );
  } else if (offer !== undefined && offer.action.kind !== "none") {
    offered = <SlackActionPreview action={offer.action} />;
  }
  // Only when there is one: the body draws a labelled cell the moment the slot is defined. Whether or not the
  // step opens a shaped ask — a plain step naming a draft is a card asking the owner to react to it all the same.
  if (offered !== undefined || named.length > 0) {
    preview = (
      <>
        {offered}
        {named.length > 0 && <NamedDrafts drafts={named} />}
      </>
    );
  }
  // Only a decision step folds anything: the ask's document and the places it names, which the card does not draw.
  let details: ReactNode;
  if (context.length > 0) {
    details = <RecordLines known={known} summary={RECORD_SUMMARY} lines={context} />;
  }
  let refused: ReasonWords | undefined;
  if (form.kind === "refused") {
    refused = form.why;
  }
  // A decision step floats the ask's own card, so the thread that ask is about leads it the same way.
  const threadUrl = drawnThreadOf({ row });
  let thread: ReactNode;
  if (threadUrl !== undefined) {
    thread = <HeldDraftsThread id={threadUrl} drafts={drafts} />;
  }
  const footer = (
    <SlideFoot>
      <button
        type="button"
        className={BUTTON_PRIMARY}
        disabled={busy || gone}
        onClick={() =>
          void press({ readsSlug: "hands", slots: { did: HAND_DONE_WORDS, id: step.id }, slug: "hand-done" })
        }
      >
        Mark done <span className="font-normal">records “{HAND_DONE_WORDS}”</span>
      </button>
      {HAND_SNOOZE_BUTTONS.map(({ slug, label }) => (
        <button
          key={slug}
          type="button"
          className={BUTTON}
          disabled={busy || gone}
          onClick={() => void press({ readsSlug: "hands", slots: { id: step.id }, slug })}
          title="not now: the note comes back then, and the step stays open"
        >
          {label}
        </button>
      ))}
      <Outcome state={state} />
    </SlideFoot>
  );
  return (
    <SlideOver {...head} busy={busy} footer={footer}>
      <QueueCardBody
        card={row.card}
        source={row.source}
        known={known}
        preview={preview}
        details={details}
        refused={refused}
        thread={thread}
        aside={<Reasoning card={row} gone={gone} goneWord="the register no longer holds this step; it is settled" />}
        // The provider page, boxed where to look, scrolling with the card above the fields pinned beneath it.
        figure={step.shot === undefined ? undefined : <HandShot shot={step.shot} subject="step" />}
      />
      {/* Every secret the step has the owner store gets a field here, so they paste it rather than finding a terminal —
          open for as long as the card is, settled or not: `secrets set` gates the name, never the step, so the boxes
          stay usable after the row leaves the queue. */}
      <SecretFields names={step.secrets} />
    </SlideOver>
  );
}
