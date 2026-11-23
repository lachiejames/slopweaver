/** The panel for one row, whichever register it came from: its header built once, and the register's own panel. */
import { Fragment, type ReactElement, useContext } from "react";

import { ageOf } from "../../lib/ageOf";
import { cardAddresses } from "../../lib/cardAddresses";
import { askPendingNow, cardLoading, ownRegisterWait, threadDraftsWait } from "../../lib/cardLoading";
import { openedCardProperties } from "../../lib/cardProperties";
import { panelSubtitleParts } from "../../lib/drawerHead";
import { inlinePlain } from "../../lib/inlineCitations";
import { withLookedUpPull } from "../../lib/queueActRow";
import { liveActNotices } from "../../lib/queueCardActLinks";
import { type QueueRow } from "../../lib/queueRows";
import { type NamedDraft, namedDrafts } from "../../lib/slackDraftIds";
import { readWorkstreamsReading, type WorkstreamsReading } from "../../lib/workstreamsReading";
import { type Board, type HandStep } from "../live/read";
import { type AutonomyRow } from "../live/readAutonomy";
import { type ImportQuestionReading } from "../live/readImportQuestions";
import { type LandingReading } from "../live/readLanding";
import { type ParkedReview } from "../live/readReviewDrafts";
import { type ParkedDraft } from "../live/readSlackDrafts";
import { type HeldDraft } from "../live/readThread";
import { type LiveState, useLive } from "../live/useLive";
import { CardDefer } from "./CardDefer";
import { DepartureIndicator } from "./CardDepartureNote";
import { CardSubject } from "./CardHeadParts";
import { CardSteers } from "./CardLaps";
import { InlineText, useCardReferences } from "./InlineText";
import { LoadingPanel } from "./LoadingPanel";
import { ProofGapLead } from "./ProofGapLead";
import { PressHold } from "./press";
import { ActPanel, PrPanel } from "./QueuePanelsAct";
import { AskPanel } from "./QueuePanelsAsk";
import { type Head } from "./QueuePanelsCommon";
import { DraftPanel, ImportPanel, PostPanel, ReviewPanel } from "./QueuePanelsDrafts";
import { HandPanel } from "./QueuePanelsHand";
import { StoppingElsewhere } from "./QueueStoppingLines";
import { KINDS } from "./queueKinds";
import { useActPull } from "./useActPull";
import { boardRereadOf } from "./useQueueRows";
import { FindingMark } from "./workContextState";

/**
 * The panel for one row, whichever register it came from.
 *
 * `snapshot` is the row as it was when opened, kept so the panel does not vanish when an act removes it
 * from the register — the reader still wants to see what they just did. `gone` says the current reading
 * no longer holds it.
 *
 * @returns the panel
 */
export function QueuePanel({
  snapshot: opened,
  index,
  gone,
  onClose,
  drafts,
  board,
  landing,
  posts,
  reviews,
  imports,
  hands,
  acts,
}: {
  snapshot: QueueRow;
  index: number | undefined;
  gone: boolean;
  onClose: () => void;
  drafts: LiveState<readonly HeldDraft[]>;
  board: LiveState<Board>;
  landing: LiveState<LandingReading>;
  posts: LiveState<readonly ParkedDraft[]>;
  reviews: LiveState<readonly ParkedReview[]>;
  imports: LiveState<ImportQuestionReading>;
  hands: LiveState<readonly HandStep[]>;
  acts: LiveState<readonly AutonomyRow[]>;
}): ReactElement {
  // A finding act's pull request is looked up by branch when its card opens, because a merged one is in no
  // reading the queue polls (`../../lib/actPullVerb.ts`). Every other row looks nothing up.
  const lookup = useActPull({ branch: opened.record.kind === "act" ? opened.record.lookupBranch : undefined });
  const kept = useContext(PressHold) === "kept";
  const snapshot = withLookedUpPull({ lookup, row: opened });
  let age: string | undefined;
  if (snapshot.whenIso !== undefined) {
    age = ageOf({ iso: snapshot.whenIso });
  }
  // Every address the row carries, whichever register it came from, so a `#N`, `acme-admin 17564` or key its
  // heading, subtitle or body names without the address still links.
  const known = cardAddresses({ row: snapshot });
  const references = useCardReferences();
  // The workstreams register, read only while a card is open, so a workstream property reads as its name and progress.
  const workstreams = useLive<WorkstreamsReading>({
    read: (payload) => readWorkstreamsReading({ payload }),
    slug: "workstreams",
  });
  // An ask's and a hand step's subject is its board slug — no id on a card, as the closed row already does.
  let subject: string | undefined;
  if (snapshot.kind !== "ask" && snapshot.kind !== "hand") {
    subject = snapshot.card.subject;
  }
  const head: Head = {
    // The dialog's accessible name is the ONE place the register still leads: a screen reader announces
    // what kind of thing opened before it reads what it says.
    label: `${KINDS[snapshot.kind].label}: ${inlinePlain({ known, references, text: snapshot.card.question })}`,
    meta: panelSubtitleParts({ age, subject }).map((part, at) => (
      <Fragment key={part.kind}>
        {at > 0 && " · "}
        {part.kind === "subject" && <CardSubject card={snapshot.card} text={part.text} known={known} />}
        {part.kind !== "subject" && part.text}
      </Fragment>
    )),
    note: (
      <>
        {/* The row's placement mark, as the loading panel draws it, so a card the default rule placed says so once loaded. */}
        <FindingMark placement={snapshot.placement} />
        <StoppingElsewhere row={snapshot} />
        <DepartureIndicator />
        <CardDefer row={snapshot} onClose={onClose} />
        <CardSteers rowKey={snapshot.key} />
      </>
    ),
    onClose,
    // The ASK, never the register's word for itself. `drawerHead.ts` carries why. No kind
    // tile, pill, placement or action badge beside it: each would be a label the owner reads before the ask.
    title: (
      <>
        {index !== undefined && (
          <span className="inline-grid h-[1.4rem] min-w-[1.4rem] flex-none place-items-center rounded-[6px] bg-primary/25 text-[0.74rem] font-bold">
            {index}
          </span>
        )}
        <span>
          {/* The owner's unmet proof ask on a pull request this card is about, in their words, ahead of the question. */}
          <ProofGapLead row={snapshot} opened />
          <InlineText text={snapshot.card.question} known={known} />
        </span>
      </>
    ),
  };
  // Keyed by the row, so moving the panel from one row to another starts its state — the typed words, a
  // press's outcome — afresh rather than carrying one row's outcome onto the next.
  // A read the card is derived from still in flight draws ONE loading state, never a partial card (`cardLoading`).
  const waits = [
    ...ownRegisterWait({ registers: { acts, board, drafts, hands, imports, landing, posts, reviews }, row: opened }),
    ...cardLoading({ board, landing, lookup, posts, row: opened }),
    ...threadDraftsWait({ drafts, row: opened }),
  ];
  if (waits.length > 0) {
    return <LoadingPanel key={`${snapshot.key}:loading`} row={snapshot} waits={waits} onClose={onClose} />;
  }
  const record = snapshot.record;
  const common = {
    // A card drawn from an earlier reading holds every press as a gone one does; the column says which it is.
    gone: gone || kept,
    head,
    known,
    row: {
      ...snapshot,
      properties: openedCardProperties({ board, people: references.people, row: snapshot, workstreams }),
    },
  };
  // A snapshot's draft marks were taken when it was opened, so the drafts register as the page holds it NOW decides
  // what each named id draws: a card left open after its row went never shows a settled read as reading.
  let named: readonly NamedDraft[] = [];
  if (record.kind === "hand" || record.kind === "ask") {
    named = namedDrafts({ ids: record.drafts.map((one) => one.id), posts });
  }
  if (record.kind === "hand") {
    return (
      <HandPanel
        key={snapshot.key}
        {...common}
        step={record.step}
        decision={record.decision}
        drafts={drafts}
        named={named}
        offer={record.offered}
        askPending={askPendingNow({
          askPending: record.askPending,
          board,
          gone,
          reread: boardRereadOf({ key: snapshot.key }),
          stale: record.boardStale,
        })}
        form={record.form}
      />
    );
  }
  if (record.kind === "ask") {
    return <AskPanel key={snapshot.key} {...common} boardRow={record.row} drafts={drafts} named={named} />;
  }
  if (record.kind === "draft") {
    return <DraftPanel key={snapshot.key} {...common} draft={record.draft} drafts={drafts} />;
  }
  if (record.kind === "post") {
    return <PostPanel key={snapshot.key} {...common} post={record.post} />;
  }
  if (record.kind === "review") {
    return <ReviewPanel key={snapshot.key} {...common} review={record.review} />;
  }
  if (record.kind === "import") {
    return <ImportPanel key={snapshot.key} {...common} question={record.question} />;
  }
  if (record.kind === "pr") {
    return <PrPanel key={snapshot.key} {...common} landingRow={record.row} reading={record.reading} />;
  }
  return (
    <ActPanel
      key={snapshot.key}
      {...common}
      act={record.act}
      earlier={record.earlier}
      form={record.form}
      links={liveActNotices({ board, landing, links: record.links })}
      lookup={lookup}
    />
  );
}
