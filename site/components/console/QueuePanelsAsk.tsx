/**
 * A recorded ask's panel, the places an ask row points (shared with a decision hand step's panel), and the picture an
 * ask card carries.
 */
import { type ReactElement, type ReactNode } from "react";

import { prLabel } from "../../lib/askLinks";
import { askedOptions } from "../../lib/askOffered";
import { isInboxTriageSlug } from "../../lib/cardMailVerb";
import { type QueueAskBoardRow } from "../../lib/detachedAskRow";
import { drawnTexts, notInline } from "../../lib/inlineCitations";
import { askMailThread, type MailThreadRef } from "../../lib/mailAnchor";
import { waitWord } from "../../lib/ownerAsks";
import { privateTermProposalIdsIn } from "../../lib/privateTermProposalIds";
import { askTexts } from "../../lib/queueAskRow";
import { reasonBeyondQuestion } from "../../lib/queueCardAsk";
import { type QueueRow } from "../../lib/queueRows";
import { type RecordLine, recordLine, recordLink, recordMaybe } from "../../lib/recordLines";
import { type NamedDraft } from "../../lib/slackDraftIds";
import { type BoardRow } from "../live/read";
import { mailReplyOf } from "../live/readAction";
import { type HeldDraft } from "../live/readThread";
import { SlideOver } from "../live/SlideOver";
import { type LiveState } from "../live/useLive";
import { CardMail } from "./CardMail";
import { HandShot } from "./HandShot";
import { MailActionPreview } from "./MailActionPreview";
import { MailThread } from "./MailThread";
import { NamedDrafts } from "./NamedDrafts";
import { Reasoning } from "./PanelReasoning";
import { PrivateTermProposals } from "./PrivateTermProposals";
import { MailField, QueueCardBody } from "./QueueCardBody";
import { HeldDraftsThread } from "./QueuePanelMarks";
import { type PanelCommon, RECORD_SUMMARY, refusedProps } from "./QueuePanelsCommon";
import { RecordLines } from "./RecordLines";
import { SlackActionPreview } from "./SlackActionPreview";
import { StaleMark } from "./StaleMark";

/**
 * Every place an ask row points, as record lines — its pull requests the card never names inline, the thread it
 * was asked in, and an anchor that is an address. Shared by the ask's own panel and a decision hand step's, so
 * the two cannot drift apart.
 *
 * None is a chip row: a pull request the card names is its own number in the heading or the what, so only the ones it never names are lines here.
 *
 * @param boardRow the ask row
 * @param card the card drawn above, whose sentences already cite some of the pull requests
 * @param thread the Slack thread the row names, when it names one
 * @param mail the Gmail thread the row names, when it was born from an email
 * @returns the lines, in that order
 */
export function askPlaces({
  boardRow,
  card,
  thread,
  mail,
}: {
  boardRow: BoardRow;
  card: QueueRow["card"];
  thread: string | undefined;
  mail: MailThreadRef | undefined;
}): RecordLine[] {
  const unnamed = notInline({ prUrls: boardRow.prUrls, texts: drawnTexts({ card }) });
  const places = unnamed.map((url) => recordLink({ label: "pull request", text: prLabel({ url }), url }));
  if (thread !== undefined) {
    places.push(recordLink({ label: "Slack thread", text: "the thread it was asked in", url: thread }));
  }
  if (mail !== undefined) {
    places.push(recordLink({ label: "Gmail thread", text: "the mail it was asked from", url: mail.url }));
  }
  const anchor = boardRow.anchor;
  const anchorDrawn = anchor === thread || (mail !== undefined && anchor?.includes(mail.id) === true);
  if (anchor !== undefined && !anchorDrawn && anchor.startsWith("https://")) {
    places.push(recordLink({ label: "asked at", text: "where you asked it", url: anchor }));
  }
  return places;
}

/**
 * The recorded ask's panel: the card, the thread it came out of, and the board row folded beneath.
 *
 * No press on the ask itself: `handover answer` is gated on the run's writer session, which this page is not, so
 * option A names the supervisor chat rather than offering a button that would always be refused. The one press it
 * carries is per private word, on a card naming proposals (`./PrivateTermProposals.tsx`).
 *
 * @returns the panel
 */
export function AskPanel({
  boardRow,
  row,
  gone,
  head,
  known,
  drafts,
  named,
}: PanelCommon & {
  boardRow: QueueAskBoardRow;
  drafts: LiveState<readonly HeldDraft[]>;
  named: readonly NamedDraft[];
}): ReactElement {
  const thread = row.threadUrl;
  // The fake terminal that stood here printed the row's whole `question` and its whole `reason` as running
  // prose — and those two strings are the same string on every row waiting on the owner (`reasonBeyondQuestion`),
  // so one disclosure carried the same paragraph twice. The doc's own path is where the paragraph still is.
  // The row's own `question` is not a line here: it is the drawer's heading, and the rest of it is WHAT.
  // `reason` is left with only what it says BEYOND the question, which on most rows is four words.
  let asked = "";
  if (boardRow.question !== undefined) {
    asked = boardRow.question;
  }
  const beyond = reasonBeyondQuestion({ question: asked, reason: boardRow.reason });
  let parked: string | undefined;
  if (beyond.length > 0) {
    parked = beyond;
  }
  // Built here rather than passed unconditionally: the body draws a `draft` label the moment the slot is
  // defined, and `SlackActionPreview` answers null on a row that offers no action — which is most of them —
  // so passing the element always would leave a labelled empty cell on nearly every ask.
  let offered: ReactNode;
  if (boardRow.action.kind === "mail") {
    offered = <MailActionPreview mail={boardRow.action.mail} slug={boardRow.slug} whole={false} />;
  } else if (boardRow.action.kind !== "none") {
    offered = <SlackActionPreview action={boardRow.action} />;
  }
  // A draft the ask names by id in its prose is drawn too, beside one it offers as an action: the id is the
  // exact token `slack draft` mints, and an ask naming one without drawing it leaves the owner a card they cannot check.
  let preview: ReactNode;
  if (offered !== undefined || named.length > 0) {
    preview = (
      <>
        {offered}
        {named.length > 0 && <NamedDrafts drafts={named} />}
      </>
    );
  }
  // An ask born from an email draws its mail thread the way a Slack-born one draws its thread, read live with the
  // owner's Gmail draft under it, so the actual email referred to is visible.
  const replyTo = mailReplyOf({ action: boardRow.action });
  const mail = askMailThread({ replyTo, row: boardRow });
  const places = askPlaces({ boardRow, card: row.card, mail, thread });
  // An inbox-triage card draws the mail it pinned under its problem line, from the copy stored beside the pin
  // so the owner sees the message someone already sent and the live thread is not drawn twice.
  const triage = isInboxTriageSlug({ slug: boardRow.slug });
  // A card offering a REPLY draws the thread it answers under its problem, not folded in the details: the reply
  // is unreadable without the mail it answers, and a card without it reads as having no email at all.
  // A recorded reply target wins over a triage pin, so the thread drawn is always the one a press replies inside.
  let cardMail: ReactNode;
  if (replyTo !== undefined && mail !== undefined) {
    cardMail = (
      <MailField>
        <MailThread id={mail.id} key={mail.id} />
      </MailField>
    );
  } else if (triage) {
    cardMail = <CardMail slug={boardRow.slug} />;
  }
  // A card asking the owner to confirm private words draws those words under its problem, each with its own Yes and
  // No. The card names them by proposal id only. The words are read from the owner's own machine while the card is
  // open and go nowhere else: not the row, not a reading, not a log.
  const proposalIds = privateTermProposalIdsIn({
    texts: askTexts({ options: askedOptions({ action: boardRow.action, options: boardRow.options }), row: boardRow }),
  });
  const underProblem = (
    <>
      {cardMail}
      {proposalIds.length > 0 && <PrivateTermProposals ids={proposalIds} />}
    </>
  );
  // The thread the ask is about leads the card rather than closing it, so the owner sees the Slack message itself
  // rather than a telling of it: it is the body's `thread`, never one of these details.
  const details = (
    <>
      {mail !== undefined && cardMail === undefined && <MailThread id={mail.id} key={mail.id} />}
      <RecordLines
        known={known}
        summary={RECORD_SUMMARY}
        lines={[
          // No slug, section, kind or priority: the slug is an internal name, and the rest is the properties'.
          ...places,
          recordMaybe({
            absent: "the reason says nothing the question did not already say",
            label: "parked",
            value: parked,
          }),
          recordLine({ label: "waiting on", value: waitWord({ row: boardRow }) }),
        ]}
      />
    </>
  );
  // No act bar: the owner answers aloud or in the call's chat, and a line saying so on every ask would be stray prose
  // at the foot of the card.
  return (
    <SlideOver {...head}>
      <QueueCardBody
        card={row.card}
        source={row.source}
        known={known}
        {...refusedProps({ row })}
        preview={preview}
        // No field of its own: the UI has one text input, the supervisor. The owner answers aloud or in the
        // supervisor, and the open card is what "this" means there.
        details={details}
        underProblem={underProblem}
        thread={thread === undefined ? undefined : <HeldDraftsThread id={thread} drafts={drafts} />}
        // The screenshot the ask is about, boxed where to look (`handover shot`) — or the line saying it did not read.
        figure={askFigure({ boardRow })}
        // A detached ask's doc that would not read: the card's sentence is the console's, the read's reason beneath it.
        {...(boardRow.reasonWhy === undefined ? {} : { reasonWhy: boardRow.reasonWhy })}
        aside={
          <Reasoning
            card={row}
            gone={gone}
            goneWord="the board no longer carries a question on this row; it was answered or swept"
          />
        }
      />
    </SlideOver>
  );
}

/**
 * An ask card's picture: the boxed screenshot its row carries, a staleness mark when the row published one that did
 * not read, or nothing on an ask with none — never the unreadable one drawn as if the ask had no picture at all.
 *
 * @param boardRow the board's row
 * @returns the figure, or `undefined` when the row carries no picture
 */
function askFigure({ boardRow }: { boardRow: BoardRow }): ReactNode {
  if (boardRow.shot !== undefined) {
    return <HandShot shot={boardRow.shot} subject="ask" />;
  }
  if (boardRow.shotUnreadable) {
    return (
      <StaleMark
        facts={[
          {
            subject: "the screenshot this ask carries",
            why: `its boxes did not read, so it is not drawn: slopweaver handover shot ${boardRow.slug} records it again`,
          },
        ]}
        block
      />
    );
  }
  return undefined;
}
