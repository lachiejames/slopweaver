/**
 * Walking a filled briefing form: every react-now card, every anchor run and the targets it may point at,
 * every fold, and every image byte the page embeds.
 *
 * Split from `./schema.ts` on size alone. The refusals that CALL these still live on the schema, and so do
 * the reasons each exists; what moved is only the traversal, which imports nothing from the schema so the
 * two cannot form a cycle.
 */

import type {
  BriefingCard,
  BriefingContent,
  BriefingFold,
  BriefingForm,
  BriefingInline,
  BriefingNote,
  BriefingSection,
} from "./types.js";
import {
  ALIGNMENT_ID,
  AUTONOMY_ID,
  HAND_STEPS_ID,
  ME_FACING_ID,
  OPEN_ARTIFACTS_ID,
  OWNER_BELIEFS_ID,
  QUIZ_ID,
  REACT_NOW_ID,
  RECENT_ID,
  TEAM_FACING_ID,
  WAITING_ID,
  YOUR_LIST_ID,
} from "./types.js";
import { decodedImageBytes } from "./vocabulary.js";

/**
 * Every card the block carries, team-facing first, which is the order the page renders and numbers them in.
 *
 * @param form the whole form
 * @returns every react-now card, both groupings, in page order
 */
export function cardsOfForm({ form }: { form: BriefingForm }): readonly BriefingCard[] {
  return [...form.reactNow.teamFacing, ...form.reactNow.meFacing];
}

/**
 * Every anchor target this page actually defines: the fixed ids of the sections that render, plus whatever
 * ids the composer's own collapsed sections mint.
 *
 * `your-list` is conditional, which is the whole reason this is computed per form rather than being a
 * constant — an anchor into a section a page does not carry renders as a link that scrolls nowhere, and a
 * one-index page whose own internal links are dead is worse than one with no anchors at all.
 *
 * `awaiting` was one of those once. Its section no longer renders, so `#awaiting` is no
 * longer a target a form may name, and an anchor still pointing at it is refused rather than shipped dead.
 *
 * ## READINESS decides the two grouping headings, not the grouping's size
 *
 * `./render.ts` partitions the block by readiness before it renders a heading at all: the team and me
 * headings cover the READY cards of each grouping, and every waiting card, from either grouping, renders
 * under one heading of its own. So a grouping holding nothing but waiting cards renders no heading, and a
 * page with a waiting card anywhere renders `react-now-waiting` — which this set once said nothing about at all,
 * refusing an anchor at a heading the page carries and admitting one at a heading it does
 * not. Measured across the 149 saved `form.json` files on this install, no form's anchor run was pointing at
 * either, so the correction costs nothing today. It was found while reading this function for the self-link
 * rule below and is fixed here rather than left standing; the two are independent, since `#react-now-waiting`
 * being a legal ANCHOR target has nothing to do with a card SUBJECT linking one.
 *
 * @internal — read by `./schema.ts`'s anchor refusal; no caller outside the form names it.
 *
 * @param form the whole form
 * @returns every id an anchor run may target on this page
 */
export function anchorTargetsOfForm({ form }: { form: BriefingForm }): ReadonlySet<string> {
  const sections = [
    ...(form.nothingStale === undefined ? [] : [form.nothingStale]),
    ...(form.freshness === undefined ? [] : [form.freshness]),
    ...(form.earlierToday === undefined ? [] : [form.earlierToday]),
    ...form.history,
  ];
  const ready = ({ cards }: { cards: readonly BriefingCard[] }): boolean =>
    cards.some((c) => c.readiness.state === "ready");
  const both = [...form.reactNow.teamFacing, ...form.reactNow.meFacing];
  const waiting = both.some((card) => card.readiness.state === "waiting");
  return new Set([
    REACT_NOW_ID,
    ALIGNMENT_ID,
    RECENT_ID,
    ...(ready({ cards: form.reactNow.teamFacing }) ? [TEAM_FACING_ID] : []),
    ...(ready({ cards: form.reactNow.meFacing }) ? [ME_FACING_ID] : []),
    ...(waiting ? [WAITING_ID] : []),
    ...(form.reactNow.openArtifacts.length === 0 ? [] : [OPEN_ARTIFACTS_ID]),
    // The autonomy ledger's heading renders only when the register gave it acts, so an anchor into an empty
    // one would scroll nowhere — the same conditional `your-list` and each grouping already are.
    ...(form.autonomy.rows.length === 0 ? [] : [AUTONOMY_ID]),
    // The hand-steps heading renders only when a step is actually open, and the state this feature is TRYING
    // to reach is the empty one — so an unconditional entry here would admit an anchor that scrolls nowhere
    // on exactly the days there is nothing waiting on the owner.
    ...(form.handSteps.rows.length === 0 ? [] : [HAND_STEPS_ID]),
    // The correction block's heading renders only when the queue gave it open proposals, so an anchor into
    // an empty one would scroll nowhere — the same conditional `your-list` and each grouping already are.
    ...(form.ownerBeliefs.rows.length === 0 ? [] : [OWNER_BELIEFS_ID]),
    // The quiz's heading renders only when the sweep actually asked something, so an anchor into a page
    // that asked nothing would scroll nowhere.
    ...(form.quiz === undefined ? [] : [QUIZ_ID]),
    ...(form.yourList === undefined ? [] : [YOUR_LIST_ID]),
    ...sections.flatMap((section) => (section.id === undefined ? [] : [section.id])),
  ]);
}

/** Every anchor run anywhere in one content cell. */
function anchorsOfContent({ content }: { content: BriefingContent }): readonly BriefingInline[] {
  return content.filter((run) => run.kind === "anchor");
}

/**
 * Every `id` the composer's own collapsed sections mint, in page order.
 *
 * @internal — read by `./schema.ts`'s duplicate-id refusal; no caller outside the form names it.
 * @param form the whole form
 * @returns each section id, duplicates included, so a caller can find them
 */
export function sectionIdsOfForm({ form }: { form: BriefingForm }): readonly string[] {
  const sections = [
    ...(form.nothingStale === undefined ? [] : [form.nothingStale]),
    ...(form.freshness === undefined ? [] : [form.freshness]),
    ...(form.earlierToday === undefined ? [] : [form.earlierToday]),
    ...form.history,
  ];
  return sections.flatMap((section) => (section.id === undefined ? [] : [section.id]));
}

/** Every anchor run inside one fold, across every block kind that can hold content. */
function anchorsOfFold({ fold }: { fold: BriefingFold }): readonly BriefingInline[] {
  return fold.blocks.flatMap((block) => {
    if (block.kind === "para") {
      return anchorsOfContent({ content: block.content });
    }
    if (block.kind === "list") {
      return block.items.flatMap((item) => anchorsOfContent({ content: item }));
    }
    return [];
  });
}

/**
 * Every anchor run anywhere on the page, folded or not — a card's cells, the owner's list's headlines, the alignment
 * line, every note and every fold body.
 *
 * @internal — read by `./schema.ts`'s anchor refusal; no caller outside the form names it.
 *
 * @param form the whole form
 * @returns every anchor run, in no particular order
 */
export function anchorsOfForm({ form }: { form: BriefingForm }): readonly BriefingInline[] {
  const cardCells = cardsOfForm({ form }).flatMap((card) =>
    [card.what, card.whyYou, card.lean, card.ifSilent].flatMap((content) => anchorsOfContent({ content })),
  );
  const notes = [
    ...form.recent,
    ...(form.earlierToday === undefined ? [] : form.earlierToday.notes),
    ...form.history.flatMap((section) => section.notes),
  ].flatMap((note) => anchorsOfContent({ content: note.headline }));
  const rows = form.yourList === undefined ? [] : form.yourList.rows;
  return [
    ...anchorsOfContent({ content: form.header.lede }),
    ...anchorsOfContent({ content: form.alignment.headline }),
    ...cardCells,
    ...notes,
    ...rows.flatMap((row) => anchorsOfContent({ content: row.headline })),
    ...form.awaiting.flatMap((artifact) => anchorsOfContent({ content: artifact.waitingOn })),
    ...foldsOfForm({ form }).flatMap((fold) => anchorsOfFold({ fold })),
  ];
}

/** Every fold a note carries, in order — a small shared reducer so the walker below states each region once. */
function foldsOfNotes({ notes }: { notes: readonly BriefingNote[] }): readonly BriefingFold[] {
  return notes.flatMap((note) => (note.detail === undefined ? [] : [note.detail]));
}

/**
 * Every fold anywhere on the page: card details, the owner's list's per-row folds, and every
 * recent/earlier-today/history note's detail.
 */
function foldsOfForm({ form }: { form: BriefingForm }): readonly BriefingFold[] {
  const cardFolds = cardsOfForm({ form }).flatMap((card) => (card.detail === undefined ? [] : [card.detail]));
  const earlierFolds = ({ section }: { section: BriefingSection | undefined }): readonly BriefingFold[] =>
    section === undefined ? [] : foldsOfNotes({ notes: section.notes });
  const alignmentFold = form.alignment.detail === undefined ? [] : [form.alignment.detail];
  const rowFolds =
    form.yourList === undefined
      ? []
      : form.yourList.rows.flatMap((row) => (row.detail === undefined ? [] : [row.detail]));
  return [
    ...cardFolds,
    ...alignmentFold,
    ...rowFolds,
    ...foldsOfNotes({ notes: form.recent }),
    ...earlierFolds({ section: form.earlierToday }),
    ...form.history.flatMap((section) => foldsOfNotes({ notes: section.notes })),
  ];
}

/**
 * Every raw byte the whole page embeds across every image, summed — folds included, since an image's weight
 * against the published page's own size ceiling does not depend on whether a reader ever opens the fold it
 * sits in.
 *
 * @param form the whole form
 * @returns the total decoded byte count across every image block
 */
export function pageImageBytes({ form }: { form: BriefingForm }): number {
  return foldsOfForm({ form }).reduce(
    (total, fold) =>
      total +
      fold.blocks.reduce(
        (sum, block) => (block.kind === "image" ? sum + decodedImageBytes({ dataUri: block.data }) : sum),
        0,
      ),
    0,
  );
}
