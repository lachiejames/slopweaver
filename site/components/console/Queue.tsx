"use client";

import { type ReactElement, Suspense, useMemo, useState } from "react";

import { ageOf } from "../../lib/ageOf";
import { deferralGap } from "../../lib/cardDeferrals";
import { openLeftSentence, panelRow } from "../../lib/cardDeparture";
import { cardNumber } from "../../lib/queueCardCounts";
import { partialTagsSplit } from "../../lib/queueCardTags";
import { FOCUS_SUBJECT, focusGap, type QueueSection, queueSectionOf, SECTIONS } from "../../lib/queueFocus";
import { layoutForVoice, QUEUE_SHOWN, type QueueFoldEntry, queueLayout } from "../../lib/queueLayout";
import { opensAs } from "../../lib/queueOpen";
import { type QueueRow } from "../../lib/queueRows";
import { selectorViews } from "../../lib/queueShownCounts";
import { matchesTags } from "../../lib/queueTags";
import { inView, viewLabel, viewReadsTags } from "../../lib/queueViews";
import { queueForVoice } from "../../lib/queueVoice";
import { withheldSentence } from "../../lib/queueWithholding";
import { emptyListDraw, freshnessLine } from "../../lib/registerFreshness";
import type { StalenessFact } from "../../lib/stalenessLabel";
import { cn } from "../../lib/utils";
import { StaleReadings } from "../live/LiveMarks";
import { PageVoice } from "../voice/PageVoice";
import { usePageReading } from "../voice/voiceContext";
import { CHIP } from "./controls";
import { PeopleScope } from "./InlineText";
import { EMPTY } from "./PageEmpty";
import { PAGE_BODY } from "./PageHead";
import { ambiguousTagsWords, EmptyList, partialTagsFact, UnknownTags } from "./QueueEmpty";
import { OpenedPanel } from "./QueuePanels";
import {
  QUEUE_META,
  QUEUE_ROW,
  QUEUE_ROW_EDGE,
  QUEUE_TEXT,
  QUEUE_TITLE,
  QueueRowButton,
  SectionHead,
  useNow,
} from "./QueueSections";
import { QueueViewBar } from "./QueueViewBar";
import { KINDS, type Kind } from "./queueKinds";
import { useQueueTags } from "./queueTagState";
import { ReadingIndicator } from "./ReadingIndicator";
import { StaleMark } from "./StaleMark";
import { SettleLine } from "./settling";
import { useCurrencyOpeningRefresh } from "./useCurrencyOpeningRefresh";
import { FAST_POLL_MS, queueShownOf, REGISTERS, useOpenedRow, useQueueRows } from "./useQueueRows";
import { CONTEXT_NOTE, FoldedMarked, HiddenNote, useWorkContext } from "./workContextState";

/** A section of the list: the owner's PR reviews or focus, one tier of the ranking, or the cards put off, drawn last. */
type SectionName = QueueSection | "deferred";

/**
 * The queue: one bar, then one rounded card of every row waiting on the owner's word, and a panel per row drawn as a
 * fleet-briefing card with the raw record folded beneath.
 *
 * The page opens on the view selector and its freshness line and nothing else, and it ends at its last card with
 * nothing underneath. A steer
 * that comes back puts its card back in the list and says nothing here; the chair reads why off the call file.
 * Opening it takes its cards' currency check once when the one shown is ten minutes old or missing
 * (`./useCurrencyOpeningRefresh.ts`).
 *
 * @returns the page
 */
function QueueBody(): ReactElement {
  const reading = useQueueRows();
  useCurrencyOpeningRefresh({ currency: reading.currency });
  const { board, every, readCount, missing, anyFixture } = reading;
  const [expanded, setExpanded] = useState<readonly Kind[]>([]);
  const { shows } = useWorkContext();
  const tagFilter = useQueueTags();
  const { selection, view } = tagFilter;
  // A link's tag selection narrows the context-filtered rows, and every figure, section, number and the voice reading
  // below counts what it leaves — the page draws one list. The OPENED card alone resolves against the unnarrowed
  // rows: a card the tags hide is still live, never "gone".
  const rows = useMemo(
    () => reading.rows.filter((row) => matchesTags({ card: row, selection })),
    [reading.rows, selection],
  );
  const tagHidden = reading.rows.length - rows.length;
  const tagActive = selection.groups.length > 0;
  // A card inherits its tags from the board, so until the board reads no card's tags are known: a list narrowed by
  // tags nobody has read — by a link's selector or a tag-borne view — is a count too, one row at a time.
  const boardRead = board.phase === "ready";
  // A tag-borne view over a card whose tags read only in part cannot say whether it belongs, so it draws nothing and
  // says why, as its count does. Counted before the tag selection, which hides every such card.
  const partialTags = viewReadsTags({ view }) ? reading.rows.filter((row) => row.tagsRead !== "whole").length : 0;
  const tagsKnown = ((!tagActive && !viewReadsTags({ view })) || boardRead) && partialTags === 0;
  // The same part-read cards, whatever the view: a tag-borne view's count beside the selector is left out over them, so
  // the bar carries their mark too.
  // Split by why: a failed read is a staleness mark, a slug several rows carry is the data, said in words.
  const partOfTags = useMemo(() => partialTagsSplit({ board, rows: reading.rows }), [board, reading.rows]);
  let selectorTagsFact: StalenessFact | undefined;
  if (boardRead && partOfTags.failed > 0) {
    selectorTagsFact = partialTagsFact({ count: partOfTags.failed });
  }
  const selectorTagsAmbiguous = boardRead ? ambiguousTagsWords({ count: partOfTags.ambiguous }) : undefined;
  const listed = tagsKnown ? rows : [];
  const viewed = listed.filter((card) => inView({ card, view }));
  // Counts over the cards on screen: a register kept over a failed poll still draws its cards, and the freshness line
  // says it is an earlier reading. One computation with the badge and the voice's count check (`queueShownOf`).
  const shownCounts = queueShownOf({ reading, scope: { selection, view } });
  const views = selectorViews({ shown: shownCounts });
  // Each register shows its first QUEUE_SHOWN rows, then one fold naming how many more it holds and how many of
  // those wear a workspace mark; the voice reads the same layout.
  const { focuses } = reading;
  const shown = queueLayout({ expanded, focuses, rows: viewed, shows });
  // The number beside a card's question: the row's place in the list the owner is LOOKING AT, which is the truncated one.
  // A row the drawn list does NOT hold has no number, and the card says so by carrying none.
  const drawnKeys = shown.flatMap((entry) => ("key" in entry ? [entry.key] : []));
  // A card the owner put off draws in the last section, never its tier's, while every count above the sections still
  // holds it in its tier (`../../lib/cardDeferrals.ts`): the heading counts what is under it. A card blocking the
  // owner's priorities, the priorities' own cards and a stopped automation draw in sections of their own ahead of the tiers, each card keeping
  // its tier (`../../lib/queueFocus.ts`); a stopping card is never put off (`../../lib/queueStopping.ts`).
  const sectionOf = (entry: QueueRow | QueueFoldEntry): SectionName => {
    if (!("key" in entry)) {
      return entry.section;
    }
    if (entry.deferredIso !== undefined && entry.stopping === undefined) {
      return "deferred";
    }
    return queueSectionOf({ focuses, row: entry });
  };
  const sections: readonly { count: number; entries: readonly (QueueRow | QueueFoldEntry)[]; name: SectionName }[] = [
    ...SECTIONS,
    "deferred" as const,
  ].map((name) => ({
    count: viewed.filter((row) => sectionOf(row) === name).length,
    entries: shown.filter((entry) => sectionOf(entry) === name),
    name,
  }));
  const deferralNote = deferralGap({ deferrals: reading.deferrals });
  const focusNote = focusGap({ workstreams: reading.workstreams });
  const nowMs = useNow({ everyMs: FAST_POLL_MS });
  const numberOf = (row: QueueRow): number | undefined => cardNumber({ drawnKeys, key: row.key });
  const freshness = freshnessLine({ age: (iso) => ageOf({ iso }), freshness: reading.freshness });

  // The designed empty state IS what `desktop e2e` reads as a PROVEN empty Queue (`src/desktop/e2ePlan.ts`
  // `QUEUE_EMPTY`), so the page and the walk read one decision (`emptyListDraw`, which says what it cannot see). A
  // reading handed over from earlier on the page could be empty while its replacement holds a card, so it draws the spinner, never the line.
  const emptyDraw = emptyListDraw({
    answered: readCount,
    deciders: reading.rowDeciders,
    expected: REGISTERS,
    freshness: reading.freshness,
    overlays: reading.rowOverlays,
  });
  const opened = useOpenedRow({ every, rows: reading.rows, withheld: reading.withheldEvery });
  const withheldNote = withheldSentence({ count: reading.withheld.length });
  // The other context's cards, counted before any tag or view, so an empty Queue never reads as a quiet one while the
  // other context holds cards. Said once: under the designed empty state when that is what the list draws, else above it;
  // while unread it says the other context's cards could not be counted, never nothing.
  const hiddenByContext = shownCounts.otherContext.count;
  const noRowAtAll = tagsKnown && viewed.length === 0 && !(tagActive && tagHidden > 0) && listed.length === 0;
  const drawsMeasuredEmptyList = noRowAtAll && emptyDraw.kind === "measured-zero";

  // What the console voice reads when the owner asks about this page: the card they have open, whole, and what else
  // is drawn. `read_page` names the open key too, so "this" means the card on screen.
  const { live, snapshot } = opened;
  const openedRow = panelRow({ every, live, open: opened.opened, shows, snapshot });
  // The DISPLAYED row names the card, never the link: an `ask:` link can open the hand step that absorbed it, and a
  // word the owner says here lands on the card they are looking at (`src/talk/cardUtterance.ts`).
  let openKey: string | undefined;
  if (opened.opened !== null) {
    openKey = opened.opened;
  }
  if (openedRow !== undefined) {
    openKey = openedRow.key;
  }
  // The selector's own words and figure, so the voice says the number the owner sees beside them.
  const viewWords = { count: shownCounts.views[view], label: viewLabel({ view }) };
  usePageReading({
    open: openKey,
    openTitle: openedRow?.card.question,
    shows: queueForVoice({
      ...layoutForVoice({ layout: shown }),
      open: openedRow,
      openLeft: openLeftSentence({
        board: reading.board,
        every,
        kept: reading.kept,
        live,
        open: opened.opened,
        shows,
        snapshot,
        spoken: reading.spoken,
        steers: reading.steered.overlay,
      }),
      tags: tagActive
        ? { hidden: tagsKnown ? tagHidden > 0 : undefined, ignored: selection.malformed, selectors: tagFilter.raw }
        : undefined,
      shows,
      unread: missing,
      view: viewWords,
      withheld: reading.withheld.length,
    }),
  });
  return (
    <PeopleScope people={reading.people}>
      <PageVoice title="Queue" />
      <div className={cn(PAGE_BODY, "pt-4")}>
        <QueueViewBar
          views={views}
          view={view}
          choose={tagFilter.setView}
          tags={tagFilter.raw}
          dropTag={(selector) => {
            tagFilter.toggle({ on: false, selector });
          }}
          fixture={anyFixture}
          freshness={freshness}
          tagsUnread={selectorTagsFact}
          tagsAmbiguous={selectorTagsAmbiguous}
        />
        <SettleLine />
        {deferralNote !== undefined && <StaleMark facts={[deferralNote]} block />}
        {focusNote !== undefined && <StaleMark facts={[focusNote]} block />}
        <StaleReadings
          readings={[
            { state: reading.deferrals, subject: "the cards you put off, which decide the deferred section" },
            { state: reading.workstreams, subject: FOCUS_SUBJECT },
            { state: reading.reviewers, subject: "who reviews each pull request, overlaid on its card" },
          ]}
          row
        />

        {withheldNote !== undefined && <p className={CONTEXT_NOTE}>{withheldNote}</p>}
        {!drawsMeasuredEmptyList && <HiddenNote hidden={hiddenByContext} one="card" what="cards" />}
        <div className="sw-glass-plane overflow-hidden rounded-[14px] border border-solid">
          {!tagsKnown && <UnknownTags board={board} partial={partOfTags} />}
          {tagsKnown && viewed.length === 0 && tagActive && tagHidden > 0 && (
            <p className={EMPTY}>
              The link&apos;s tag filter hides all {String(tagHidden)} card(s). Remove it above to see them.
            </p>
          )}
          {tagsKnown && viewed.length === 0 && !(tagActive && tagHidden > 0) && view !== "all" && listed.length > 0 && (
            <>
              {/* The view's own zero stands on the same proof as the list's: a stale or rereading register could hold
                  the card this view is missing (Codex r19), so it draws the spinner or the staleness mark instead. */}
              {emptyDraw.kind === "measured-zero" && <p className={EMPTY}>Nothing under {viewLabel({ view })}.</p>}
              {emptyDraw.kind !== "measured-zero" && <EmptyList draw={emptyDraw} hidden={hiddenByContext} />}
            </>
          )}
          {/* No tag hides a card here, so `listed` is every row: the line is drawn only over no row at all. */}
          {noRowAtAll && <EmptyList draw={emptyDraw} hidden={hiddenByContext} />}
          {sections.map((section) => {
            if (section.entries.length === 0) {
              return null;
            }
            return (
              <section key={section.name}>
                <SectionHead section={section.name} count={section.count} />
                {section.entries.map((row) => {
                  if ("more" in row) {
                    return (
                      <button
                        type="button"
                        key={`more:${row.section}:${row.more}`}
                        className={cn(QUEUE_ROW, QUEUE_ROW_EDGE, "bg-muted/35")}
                        data-card-fold="queue"
                        onClick={() => {
                          setExpanded([...expanded, row.more]);
                        }}
                      >
                        <span className="min-w-[1.6rem]" />
                        <span className={QUEUE_TEXT}>
                          <span className={QUEUE_TITLE}>
                            {String(row.count)} more from {KINDS[row.more].label.toLowerCase()}: show them
                          </span>
                        </span>
                        <span className={QUEUE_META}>
                          <FoldedMarked count={row.marked} />
                          <span className={CHIP}>first {String(QUEUE_SHOWN)} shown</span>
                        </span>
                      </button>
                    );
                  }
                  return (
                    <QueueRowButton
                      key={row.key}
                      row={row}
                      number={numberOf(row)}
                      current={opensAs({ open: opened.opened, row })}
                      nowMs={nowMs}
                      onOpen={opened.open}
                    />
                  );
                })}
              </section>
            );
          })}
        </div>
      </div>
      <OpenedPanel reading={reading} opened={opened} numberOf={numberOf} />
    </PeopleScope>
  );
}

/**
 * The queue page. `useSearchParams` needs a Suspense boundary under the app router; that is the only
 * reason this wrapper exists.
 *
 * @returns the page
 */
export function Queue(): ReactElement {
  return (
    <Suspense fallback={<ReadingIndicator label="Reading the queue" block />}>
      <QueueBody />
    </Suspense>
  );
}
