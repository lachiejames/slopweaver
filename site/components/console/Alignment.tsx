"use client";

/**
 * The Alignment page: every question about whether something was, or would be, the right call — off the Queue, and
 * never a prerequisite for any work.
 *
 * It is its own page, out of the owner's queue. Each question leads with a concrete scene and what the fleet did or
 * would do in it, and takes one freeform reaction — no option list, and no box: the owner says it aloud or in the
 * call's chat with the card touched, the console's one text input. Two kinds, in the order the page ranks them
 * (`../../lib/alignmentRank.ts`), the ones most likely to improve fleet behavior first:
 *
 * - **Make it a general ruling?** (`../../lib/alignmentRules.ts`): a kind of act the owner has steered more than
 *   once, their own words quoted back as the provenance. Relayed under `align:rule-<kind>`; nothing becomes a rule
 *   unless the owner says. Beside them, a class of card the owner has sent back on two drafts
 *   (`--feedback no-receipts`), under `align:rule-card-<class>`. Both kinds in one order, most often said first.
 * - **Was this the right call?**: the acts the fleet already took, moved here from the Queue by kind
 *   (`../../lib/alignment.ts`), drawn as one Queue-shaped row per kind of act (`./AlignmentKindRows.tsx`,
 *   `../../lib/alignmentKindCards.ts`) that opens the Queue's slide-over holding that kind's act cards
 *   (`./AlignmentKindPanel.tsx`). The owner's words on a card there are for that one act's ledger line
 *   (`autonomy steer`), and that act only.
 *
 * Between them, **Your voice** (`./AlignmentVoice.tsx`, `../../lib/alignmentVoice.ts`) asks nothing: it draws how the
 * owner writes as measured over the Slack messages they sent, the connect step while Slack is not connected, and the
 * rules they set, labelled as theirs.
 *
 * Above everything sits **Start here**: a pointer to the first question the owner has not answered in that order,
 * saying what one answer could improve and that the order is derived, not a session's judgement. Under it, the
 * **Slack steers** chart (`./SlackSteers.tsx`): what the owner has had to correct on Slack drafts written as them, one
 * line per kind, so a problem that stopped reads as a line gone flat beside their own words. Then **Voice cut-ins**
 * (`./ScriptedCutIns.tsx`): each answer what reads as the console's own progress line cut into, by week. Then **Your
 * steers** (`../live/Steers.tsx`, at `#steers`): every steer the owner gave on a call and whether it is in the app
 * they run, so steers and alignment can be tracked together over time.
 *
 * Above the general-ruling questions, **Your guidance** (`./AlignmentGuidance.tsx`) is one closed fold listing every
 * ruling already in force, ranked doctrine, standing rules, then rulings, asks and memory, each cited, with a count per
 * source above the fold, so the owner can see what is already ruled before being asked for a new one.
 *
 * Nothing here chases the owner: no count here is drawn in the hot tone, nothing floats a note or sends a DM, and
 * nothing waits on it. Its sidebar entry, between the Queue and Pull requests and prominent because the page is one
 * of Slopweaver's most distinctive features, carries a NEUTRAL count of the general-ruling questions the owner has not
 * answered, and the head prints the same number off the same hook (`./useAlignmentWaiting.ts`). An act is listed to
 * look back on and never counted, so it never leads Start here either; until a current board has placed the acts, the
 * page never calls its act list zero.
 */

import { useSearchParams } from "next/navigation";
import { type ReactElement, Suspense, useMemo, useState } from "react";

import { ageOf } from "../../lib/ageOf";
import { alignmentStage } from "../../lib/alignment";
import { alignmentKindCards, focusedAlignmentKey } from "../../lib/alignmentKindCards";
import { type AlignmentOrderItem, alignmentOrder, answeredLast } from "../../lib/alignmentRank";
import {
  type CardFeedback,
  type CardRulingCandidate,
  cardRulingCandidates,
  type RulingCandidate,
  rulingCandidates,
} from "../../lib/alignmentRules";
import { voiceBansOf, voiceMeasuredOf, voiceProfileOf } from "../../lib/alignmentVoice";
import { emptyDrawOf, emptyProvenOf, overlaysReadOf, provenNowOf } from "../../lib/pageEmpty";
import { withoutOpenedBy } from "../../lib/pageVoice";
import { rowForOpen } from "../../lib/queueOpen";
import {
  failedCountFactsOf,
  type SidebarReading,
  sidebarReadOf,
  staleCountFactsOf,
  updatingCountLabelOf,
} from "../../lib/sidebarCountsBasis";
import { settledByStandingRules } from "../../lib/standingRules";
import { panelHref } from "../../lib/workContext";
import { ReadMark, ReadStandIn } from "../live/LiveMarks";
import {
  type AlignmentAnswer,
  readAlignmentAnswers,
  readTriageFeedback,
  readVoiceProfile,
  readVoiceRules,
  type VoiceCohort,
  type VoiceRules,
} from "../live/readAlignment";
import { Steers } from "../live/Steers";
import { type LiveState, readyValueOf, useLive } from "../live/useLive";
import { usePageReading } from "../voice/voiceContext";
import { AlignmentGuidance, useGuidance } from "./AlignmentGuidance";
import { AlignmentKindPanel } from "./AlignmentKindPanel";
import { AlignmentKindRows } from "./AlignmentKindRows";
import { GeneralRuling, generalRulingKeys } from "./AlignmentRulings";
import { StageStrip, StartHere } from "./AlignmentStart";
import { VoiceProfile } from "./AlignmentVoice";
import { useSharedAlignmentWaiting } from "./alignmentWaitingShared";
import { CHIP } from "./controls";
import { PageEmpty } from "./PageEmpty";
import { PAGE_BODY, PageHead } from "./PageHead";
import { ReadingIndicator } from "./ReadingIndicator";
import { ScriptedCutInsSection } from "./ScriptedCutIns";
import { SlackSteersSection } from "./SlackSteers";
import { StaleMark } from "./StaleMark";
import { StandingChip, StandingRulesFold } from "./StandingRules";
import { alignmentNextWords } from "./useAlignmentAutoRefresh";
import { useQueueRows } from "./useQueueRows";
import { useSlackConnection } from "./useSlackConnection";

/** A section's heading. */
const SECTION_HEAD = "mt-[1.6rem] mb-[0.6rem] text-[0.95rem] font-[650]";

/** The live reading behind every answer the owner has given here, so a sent answer reads back at once. */
const ANSWERS_SLUG = "alignment-answers";

/** The plain line a section draws when only a reading kept over a failed or refreshing read emptied it. */
const PLAIN_EMPTY = "m-0 text-[0.84rem] text-muted-foreground";

/** The live reading behind the owner's named feedback on drafts they sent back. */
const FEEDBACK_SLUG = "triage-feedback";

/**
 * The page body: what leads, the charts and the indicator, then general rulings in the order
 * `../../lib/alignmentRank.ts` states, the voice learnt from the owner's Slack, and the acts.
 *
 * @returns the page
 */
function AlignmentBody(): ReactElement {
  // The sidebar badge's own number, and what the console is doing about a failed read behind it, off the console's one
  // instance of the hook (`./alignmentWaitingShared.tsx`).
  const { recovery, waiting } = useSharedAlignmentWaiting();
  const reading = useQueueRows();
  const { acts, alignment, settled } = reading;
  // Whether the act cards are placed by a current board: until then the act list is empty for want of a board, not of
  // acts, so it never draws its empty state nor tells the voice a number.
  const cardsCurrent = sidebarReadOf({ state: reading.board }).phase === "ready";
  const profile = useLive<readonly VoiceCohort[]>({ read: readVoiceProfile, slug: "voice-profile" });
  const rules = useLive<VoiceRules>({ read: readVoiceRules, slug: "voice-rules" });
  const answers = useLive<readonly AlignmentAnswer[]>({ read: readAlignmentAnswers, slug: ANSWERS_SLUG });
  // One read of the owner's guidance, for the guidance section and every act card's related-guidance sidebar.
  const guidance = useGuidance();
  const answered = readyValueOf({ state: answers });
  // Whether a Slack token is present: the voice is learnt from the owner's Slack, so a known "no" draws Slack's connect step.
  const slack = useSlackConnection({ key: "alignment-voice", wanted: true });
  let slackConnected: boolean | undefined;
  if (slack.phase === "ready") {
    slackConnected = slack.tokenPresent;
  }
  const cohorts = readyValueOf({ state: profile });
  const voiceView = cohorts === undefined ? undefined : voiceProfileOf({ cohorts, slackConnected });
  const voiceRules = readyValueOf({ state: rules });
  const stage = alignmentStage({ voiceMeasured: cohorts !== undefined && voiceMeasuredOf({ cohorts }) });
  const ledger = readyValueOf({ state: acts });
  const candidates = useMemo(() => (ledger === undefined ? undefined : rulingCandidates({ acts: ledger })), [ledger]);
  const feedback = useLive<readonly CardFeedback[]>({ read: readTriageFeedback, slug: FEEDBACK_SLUG });
  const sentBack = readyValueOf({ state: feedback });
  const register = readyValueOf({ state: reading.posts });
  const cardCandidates = useMemo(
    () =>
      sentBack === undefined || register === undefined
        ? undefined
        : cardRulingCandidates({ drafts: register, feedback: sentBack }),
    [register, sentBack],
  );
  // The rulings' empty state stands only on readings whose LATEST read answered: one kept over a failed read proves
  // nothing now.
  const rulingsCurrent = [acts, feedback, reading.posts].every((state) => provenNowOf({ state }));
  // The acts' empty state: an act row is hidden by the spoken cards and by a held steer the steers reading has not yet
  // confirmed, and placed by the board and the landing reading, so an emptied ledger stands only while each of those
  // is current too.
  const actOverlays = [reading.board, reading.landing, reading.spoken, reading.steered.reading];
  const actsEmptyProven = emptyProvenOf({ overlays: actOverlays, source: acts });
  // An overlay on its first read draws the busy block rather than any empty line; one re-reading a reading it was handed
  // is in hand, so the section draws that with a refresh mark (`overlaysReadOf`).
  const actOverlaysRead = overlaysReadOf({ overlays: actOverlays });
  const standing = useMemo(() => settledByStandingRules({ rows: settled }), [settled]);
  // The general rulings, card classes and act kinds together, in the page's derived order, answered last
  // (`../../lib/alignmentRank.ts`). Each read that has arrived is ordered; one still on its way adds nothing yet.
  let actRulings: readonly RulingCandidate[] = [];
  if (candidates !== undefined) {
    actRulings = candidates;
  }
  let cardRulings: readonly CardRulingCandidate[] = [];
  if (cardCandidates !== undefined) {
    cardRulings = cardCandidates;
  }
  const rulingOrder = answeredLast({
    answered,
    items: alignmentOrder({ actRulings, acts: [], answered: [], cardRulings }),
  });
  // Each section's empty draw: designed when proven now, a plain line when only a kept reading emptied it.
  const rulingsInHand = candidates !== undefined && cardCandidates !== undefined;
  const rulingsDraw = emptyDrawOf({ empty: rulingOrder.length === 0, inHand: rulingsInHand, proven: rulingsCurrent });
  const actsDraw = emptyDrawOf({
    empty: alignment.length === 0,
    inHand: acts.phase === "ready" && actOverlaysRead.inHand,
    proven: actsEmptyProven && cardsCurrent,
  });
  // What leads the page: the first general-ruling question the owner has not answered, ordered only once every reading
  // the count is made from is current, so a partial order never names a first — a count marked stale, its readings
  // handed over from the page before, included. Acts are not counted, so none leads: a measured zero above an act named
  // first would contradict itself.
  let first: AlignmentOrderItem | undefined;
  const orderable = waiting.phase === "measured" && waiting.stale === undefined;
  if (orderable && answered !== undefined) {
    first = alignmentOrder({ actRulings, acts: [], answered, cardRulings }).at(0);
  }
  // One card per kind of act, each opening that kind's acts in a slide-over (`../../lib/alignmentKindCards.ts`).
  const kindCards = useMemo(
    () =>
      alignmentKindCards({
        rows: alignment.flatMap((row) =>
          row.record.kind === "act" ? [{ act: row.record.act, earlier: row.record.earlier, row }] : [],
        ),
      }),
    [alignment],
  );
  const params = useSearchParams();
  const asked = params.get("open");
  // A link naming an act — the Queue's address, redirected here — opens its kind's slide-over on that act's card,
  // scrolled to, and outranks a kind opened by a press until the link is cleared.
  const target = asked === null ? undefined : rowForOpen({ open: asked, rows: alignment });
  // The kind the owner opened by pressing its row; a link naming an act opens that act's kind instead.
  const [pressedKind, setPressedKind] = useState<{ kind: string } | undefined>(undefined);
  let openedKind: string | undefined;
  if (target?.record.kind === "act") {
    openedKind = target.record.act.kind;
  } else if (pressedKind !== undefined) {
    openedKind = pressedKind.kind;
  }
  const openedCard = kindCards.find((card) => card.kind === openedKind);
  // Unset until the owner touches a card; from then on the page's open card is theirs rather than the link's, until the
  // address names a different `?open=` (`focusedAlignmentKey`).
  const [engaged, setEngaged] = useState<{ key: string; asked: string | null } | undefined>(undefined);
  // The owner's touch makes the open card theirs, so the voice's marker comes off the address
  // (docs/console/card-landing.md). The state is `null` for the reason `useQueueRowsOpen.ts` `replacePanel` gives.
  const unmark = (): void => {
    const unmarked = withoutOpenedBy({ pathname: window.location.pathname, search: window.location.search });
    if (unmarked !== undefined) {
      window.history.replaceState(null, "", unmarked);
    }
  };
  const setFocusKey: (key: string) => void = (key) => {
    setEngaged({ asked, key });
    unmark();
  };
  const focused = focusedAlignmentKey({ asked, engaged, targetKey: target?.key });
  // Pressing a kind's row opens it fresh: no act in it is yet what the owner is answering, and a link's `?open=` is
  // cleared so it no longer outranks the press. Closing clears both the same way, or the link would reopen it at once.
  const openKind: (kind: string) => void = (kind) => {
    setEngaged(undefined);
    setPressedKind({ kind });
    clearOpen();
  };
  const closeKind = (): void => {
    setEngaged(undefined);
    setPressedKind(undefined);
    clearOpen();
  };
  usePageReading({
    open: focused,
    openTitle: alignment.find((row) => row.key === focused)?.card.question,
    shows: {
      // Only once a current board has placed them: before it, the list is empty for want of a board, not of acts.
      acts: acts.phase === "ready" && cardsCurrent ? alignment.length : undefined,
      // What leads the page and what answering it could improve, so the voice names the same first question.
      first: first === undefined ? undefined : { improves: first.improves, key: first.key, title: first.title },
      generalRulings: generalRulingKeys({ acts: candidates, cards: cardCandidates }),
      stage: stage.label,
      // Why the stage is judged off an earlier reading of the measured register, so the voice never calls it current.
      stageStale: profile.phase === "ready" ? profile.stale?.why : undefined,
      // How the owner writes as learnt from their Slack, and the rules they set, kept apart as the page keeps them.
      voice: voiceView,
      voiceRulesYouSet: voiceRules === undefined ? undefined : voiceBansOf({ rules: voiceRules }),
    },
  });
  return (
    <>
      <PageHead title="Alignment" sub="was this, or would this be, the right call? Nothing here blocks any work">
        <WaitingHead reading={waiting} next={alignmentNextWords({ recovery })} />
        {acts.phase === "ready" && <StandingChip rules={standing} filtered={false} />}
      </PageHead>
      <div className={PAGE_BODY}>
        <StartHere first={first} waiting={waiting} next={alignmentNextWords({ recovery })} onEngage={setFocusKey} />
        <SlackSteersSection />
        <ScriptedCutInsSection />
        <div id="steers" className="scroll-mt-4">
          <Steers />
        </div>
        <StageStrip stage={stage} profile={profile} />
        <h2 id="guidance" className={`${SECTION_HEAD} scroll-mt-4`}>
          Your guidance
        </h2>
        <AlignmentGuidance state={guidance} />
        <h2 className={SECTION_HEAD}>Make it a general ruling?</h2>
        {candidates === undefined && <NotRead state={acts} what="the autonomy ledger" />}
        <NotRead state={feedback} what="your feedback on drafts you sent back" />
        {/* Each reading a ruling is drawn from says when it is still on its way or failed, so the section is never blank. */}
        <NotRead state={reading.posts} what="the drafts written under your name" />
        {rulingsDraw === "designed" && (
          <PageEmpty
            title="Questions about general rulings will appear here."
            appearsWhen="A question appears after you make the same kind of correction more than once and no standing rule covers it."
            action={{ kind: "none" }}
            surface="alignment-rulings"
          />
        )}
        {rulingsDraw === "plain" && (
          <p className={PLAIN_EMPTY}>No question about a general ruling as of the last reading that answered.</p>
        )}
        {rulingOrder.map((item) => (
          <GeneralRuling
            key={`${item.from}:${item.key}`}
            item={item}
            acts={actRulings}
            cards={cardRulings}
            answered={answered}
            onEngage={setFocusKey}
          />
        ))}
        <h2 id="voice" className={`${SECTION_HEAD} scroll-mt-4`}>
          Your voice
        </h2>
        <NotRead state={profile} what="your measured message lengths" />
        <NotRead state={rules} what="your voice rules" />
        <VoiceProfile view={voiceView} rules={voiceRules} slack={slack} provenNow={provenNowOf({ state: profile })} />
        <h2 className={SECTION_HEAD}>Was this the right call?</h2>
        <NotRead state={acts} what="the autonomy ledger" />
        {acts.phase === "ready" && actOverlaysRead.activity === "first-read" && (
          <ReadingIndicator label="Reading what places and hides each act" block />
        )}
        {acts.phase === "ready" && actOverlaysRead.activity === "re-reading" && (
          <div className="flex min-h-3 items-center justify-end">
            <ReadingIndicator label="Re-reading what places and hides each act" />
          </div>
        )}
        {actsDraw === "designed" && (
          <PageEmpty
            title="Acts to review will appear here."
            appearsWhen="An act appears when the fleet acted without asking and neither your word nor a standing rule already answers it."
            action={{ kind: "plans" }}
            surface="alignment-acts"
          />
        )}
        {actsDraw === "plain" && <p className={PLAIN_EMPTY}>No act to review as of the last reading that answered.</p>}
        {kindCards.length > 0 && <AlignmentKindRows cards={kindCards} openedKind={openedKind} onOpen={openKind} />}
        <StandingRulesFold rules={standing} />
      </div>
      {openedCard !== undefined && (
        <AlignmentKindPanel
          card={openedCard}
          focused={focused}
          guidance={guidance}
          onEngage={setFocusKey}
          onClose={closeKind}
        />
      )}
    </>
  );
}

/** Take a link's `?open=` off the address, as the Queue's panel does on close (`./useQueueRowsOpen.ts`). */
function clearOpen(): void {
  const { pathname, search } = window.location;
  // `null` state, for the reason `./useQueueRowsOpen.ts` `replacePanel` gives: a state carrying `__NA` skips the sync.
  window.history.replaceState(null, "", panelHref({ open: null, pathname, search }));
}

/**
 * The page head's count of what waits on the owner's answer, marked as the sidebar badge marks it: an older number being
 * updated carries the console's progress indicator, never a warning, and only a read that failed carries the
 * staleness mark, saying which read and what the console is doing about it (`../../lib/sidebarCountsBasis.ts`).
 *
 * @param next what the console is doing about a failed read, off its recovery runner
 * @returns the chip, or the mark standing in for it
 */
function WaitingHead({ reading, next }: { reading: SidebarReading; next: string }): ReactElement {
  const subject = "what waits on your answer";
  if (reading.phase !== "measured") {
    if ("failures" in reading) {
      return <StaleMark facts={failedCountFactsOf({ failures: reading.failures, next })} />;
    }
    return <ReadStandIn state={reading} subject={subject} />;
  }
  let mark: ReactElement | undefined;
  if (reading.stale?.kind === "updating") {
    mark = <ReadingIndicator label={updatingCountLabelOf({ age: (iso) => ageOf({ iso }), stale: reading.stale })} />;
  } else if (reading.stale !== undefined) {
    mark = <StaleMark facts={staleCountFactsOf({ next, reading })} />;
  }
  return (
    <span className={CHIP} title={reading.count.title}>
      <b>{String(reading.count.count)}</b> waiting on your answer
      {mark}
    </span>
  );
}

/**
 * The mark standing where a read that has not arrived would be drawn — a spinner while it is on its way, a staleness
 * mark saying why when it failed — so a missing section is never mistaken for an empty one. Over a reading kept from
 * before a failed read, the staleness mark sits on its own line above what that reading draws.
 *
 * @returns the mark, or nothing once a current reading has arrived
 */
function NotRead<T>({ state, what }: { state: LiveState<T>; what: string }): ReactElement | null {
  if (state.phase === "ready") {
    return <ReadMark state={state} subject={what} row />;
  }
  return <ReadStandIn state={state} subject={what} block />;
}

/**
 * The Alignment page. `useSearchParams` needs a Suspense boundary under the app router.
 *
 * @returns the page
 */
export function Alignment(): ReactElement {
  return (
    <Suspense fallback={<ReadingIndicator label="Reading alignment" block />}>
      <AlignmentBody />
    </Suspense>
  );
}
