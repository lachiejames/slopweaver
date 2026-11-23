/**
 * The cards that left the owner's Queue recently, each marked removed with when and why — pure: the Queue's own
 * candidate rows, the rows it still draws, and the readings that took the rest off, in; the departed cards out.
 *
 * A card removed from the queue is still visible, marked as removed. Measured: the owner was reading a review-bump
 * card aloud, their words landed on it through the transcript, and from that instant `unlandedRows`
 * (`./cardLandings.ts`) took it out of both the Queue and the voice's `action_items` — so when the owner asked the voice
 * to go and find it, `read_card` answered that no card on their Queue answers to it.
 *
 * ## What this can recover, and what it cannot
 *
 * Only a departure some register still EVIDENCES, with an instant to date it by:
 *
 * - **A card the owner's words hold off the list** — a register still holds the row, and the `talk cards` landing (or the
 *   steer this page collapsed) says when and in whose words. The landings are split by `./cardDeparture.ts`'s own
 *   `landingsOn` and named in the open panel's words, and the EARLIEST event holding the card off names the removal.
 * - **A card the Queue walk moved on from** — the `talk cards` moves (`src/talk/cardMove.ts`) say when, the card it
 *   moved to, and the owner's words over it when they said any.
 * - **An ask settled off it** — the board keeps a settled row, and `handover settle` writes the instant it settled
 *   (`settledIso`) beside its witness. A ruling the owner made first took it off sooner, so the board publishes that
 *   instant and their words (`ruledBeforeSettleIso`) and the removal is dated by it. Only an ask that WAS the owner's: one
 *   carrying the decision shape, or one whose run still has its question open. A voice relay row is neither, and
 *   was never a card.
 *
 * A hand step done, a draft sent or a pull request merged leaves no row behind to redraw, so it is not here, and
 * nothing here claims a universal history. The window matches the talk pack's own look-back
 * (`src/talk/packText.ts` `PACK_LOOKBACK_MS`), spelled again because `site/` imports nothing from `src/`.
 */

import type { Board, BoardRow } from "../components/live/read";
import type { CardLandings, CardMove } from "../components/live/readCardLandings";
import type { ParkedDraft } from "../components/live/readSlackDrafts";
import type { LiveState } from "../components/live/useLive";
import { withBriefingPages } from "./cardBriefingPages";
import { clippedWords, landingsOn, landingWho } from "./cardDeparture";
import { landingHolds, moveHolds } from "./cardLandings";
import { withMachineIdForm } from "./machineIdForm";
import { askWhenIso } from "./ownerAsks";
import { askRowOf } from "./queueAskRow";
import { withCardTags } from "./queueCardTags";
import { rowOpensAs } from "./queueOpen";
import type { QueueRow } from "./queueRows";
import { partitionQueueRows } from "./queueWithholding";
import type { SteerOverlay } from "./steeredCards";
import type { WorkspacePlacer } from "./workspacePlacement";

/** How far back a departed card is still offered: one day, the talk pack's own look-back. */
export const RECENT_DEPARTURE_MS = 24 * 60 * 60 * 1000;

/** When a card left the owner's Queue, and why, in words the voice can say. */
export interface CardRemoval {
  readonly atIso: string;
  readonly why: string;
}

/** One card that left the owner's Queue, drawn as it was, with its removal beside it. */
export interface RecentlyLeftCard {
  readonly row: QueueRow;
  readonly removed: CardRemoval;
}

/**
 * The removal instant, canonical, when it falls inside the window ending at `nowIso` — never in the future, never
 * unparseable. Canonical because `Date.parse` rolls a date no calendar has (`02-30`) into a real one, and the voice
 * must say the instant that was measured, never the text a hand-edited doc carried.
 *
 * @param atIso the removal instant
 * @param nowIso the end of the window
 * @returns the instant as `toISOString` writes it, or `undefined` outside {@link RECENT_DEPARTURE_MS}
 */
function windowedInstant({ atIso, nowIso }: { atIso: string; nowIso: string }): string | undefined {
  const at = Date.parse(atIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(at) || Number.isNaN(now) || at > now || now - at > RECENT_DEPARTURE_MS) {
    return undefined;
  }
  return new Date(at).toISOString();
}

/**
 * Whether one removal instant names the card's removal over another: it parses, and the other does not or is later.
 * A hand-edited instant that does not parse never displaces one that does — the same
 * rule the talk pack's `keepEarliest` keeps (`src/talk/packRecentlyLeft.ts`).
 *
 * @param atIso the candidate instant
 * @param thanIso the instant it would replace
 * @returns true when the candidate wins
 */
function isEarlier({ atIso, thanIso }: { atIso: string; thanIso: string }): boolean {
  const at = Date.parse(atIso);
  const than = Date.parse(thanIso);
  return !Number.isNaN(at) && (Number.isNaN(than) || at < than);
}

/**
 * The removal the owner's words name: the EARLIEST landing on the card, whether a session holds it or its steer came back
 * unpicked. By the page's own hide rule (`./cardLandings.ts` `landingVerdict`) any landing past the card's floor keeps it off the list
 * until the overlay reveals it, so the first one took it off — and `cardDeparture`, which names a hiding steer
 * ahead of an unpicked landing, would date it by a later collapse.
 *
 * @param row the candidate row the list no longer draws
 * @param spoken the `talk cards` reading
 * @param steers the steers' overlay
 * @returns the removal, or `undefined` when no landing holds the card
 */
function wordsRemoval({
  row,
  spoken,
  steers,
}: {
  row: QueueRow;
  spoken: LiveState<CardLandings>;
  steers: Pick<SteerOverlay, "cameBack" | "revealed">;
}): CardRemoval | undefined {
  if (spoken.phase !== "ready") {
    return undefined;
  }
  // A landing older than the card's floor holds nothing (`landingHolds`), so it never dates the removal either.
  const landings = spoken.value.landings.filter((landing) => landingHolds({ landing, row }));
  const { holding, unpicked } = landingsOn({ key: row.key, landings, steers });
  const marked = [
    ...holding.map((landing) => ({ landing, picked: true })),
    ...unpicked.map((landing) => ({ landing, picked: false })),
  ];
  // `isEarlier`, never a sort: a comparator over an instant that does not parse answers NaN and keeps the input
  // order, so an unparseable first landing would win and drop the card.
  const first = marked.reduce<(typeof marked)[number] | undefined>((earliest, one) => {
    if (earliest === undefined || isEarlier({ atIso: one.landing.atIso, thanIso: earliest.landing.atIso })) {
      return one;
    }
    return earliest;
  }, undefined);
  if (first === undefined) {
    return undefined;
  }
  const { landing } = first;
  const said = `${landingWho({ source: landing.source })} landed on it ("${clippedWords({ words: landing.words })}")`;
  if (first.picked) {
    return { atIso: landing.atIso, why: `${said}; a session acts on it as ${landing.workSlug}` };
  }
  return { atIso: landing.atIso, why: `${said}; no session picked that steer up` };
}

/**
 * The steer that hid a card the overlay still hides: the EARLIEST collapsed steer on it spoken after the last one
 * that came back. A steer that came back drew the card again, so a collapse before it hid nothing now; every
 * collapse since kept it off, and the first of them took it off. On a tie the one that
 * came back wins, as the overlay's own newest-steer rule has it (`./steeredCards.ts`).
 *
 * @param key the card
 * @param steers the steers' overlay
 * @returns the steer, or `undefined` when no steer hides the card
 */
function steerHidingSince({
  key,
  steers,
}: {
  key: string;
  steers: Pick<SteerOverlay, "cameBack" | "collapsed" | "hidden">;
}): SteerOverlay["collapsed"][number] | undefined {
  if (!steers.hidden.has(key)) {
    return undefined;
  }
  const lastBack = steers.cameBack
    .map((one) => (one.cardKey === key ? Date.parse(one.sentAtIso) : Number.NaN))
    .filter((at) => !Number.isNaN(at))
    .reduce((latest, at) => Math.max(latest, at), Number.NEGATIVE_INFINITY);
  return steers.collapsed
    .filter((row) => row.cardKey === key && Date.parse(row.sentAtIso) > lastBack)
    .toSorted((one, other) => Date.parse(one.sentAtIso) - Date.parse(other.sentAtIso))[0];
}

/**
 * The removal a hidden row's overlay names, by the EARLIEST event holding it off: the owner's words that landed on it, or
 * the steer still hiding it — so a steer that collapsed the card before those words landed is never said hours late.
 *
 * @param row the candidate row the list no longer draws
 * @param spoken the `talk cards` reading
 * @param steers the steers' overlay
 * @returns the removal, or `undefined` when no overlay names one
 */
function overlayRemoval({
  row,
  spoken,
  steers,
}: {
  row: QueueRow;
  spoken: LiveState<CardLandings>;
  steers: Pick<SteerOverlay, "cameBack" | "collapsed" | "hidden" | "revealed">;
}): CardRemoval | undefined {
  const steer = steerHidingSince({ key: row.key, steers });
  const collapsed: CardRemoval | undefined =
    steer === undefined
      ? undefined
      : {
          atIso: steer.sentAtIso,
          why: `Your words, relayed by the voice, collapsed it ("${clippedWords({ words: steer.heard })}")`,
        };
  // In this order, each displacing the one before only when strictly earlier: the owner's words, a steer, a move.
  return [wordsRemoval({ row, spoken, steers }), collapsed, moveRemoval({ row, spoken })].reduce<
    CardRemoval | undefined
  >((earliest, one) => {
    if (one === undefined) {
      return earliest;
    }
    if (earliest === undefined || isEarlier({ atIso: one.atIso, thanIso: earliest.atIso })) {
      return one;
    }
    return earliest;
  }, undefined);
}

/**
 * The removal the Queue walk names: the EARLIEST move off the card still holding it (a queue card is always
 * removed when the walk moves on to the next queue card), with the owner's words over it when they said any.
 *
 * @param row the candidate row the list no longer draws
 * @param spoken the `talk cards` reading
 * @returns the removal, or `undefined` when no move holds the card
 */
function moveRemoval({ row, spoken }: { row: QueueRow; spoken: LiveState<CardLandings> }): CardRemoval | undefined {
  if (spoken.phase !== "ready") {
    return undefined;
  }
  const first = spoken.value.moves
    .filter((move) => move.cardKey === row.key && moveHolds({ move, row }))
    .reduce<CardMove | undefined>((earliest, move) => {
      if (earliest === undefined || isEarlier({ atIso: move.atIso, thanIso: earliest.atIso })) {
        return move;
      }
      return earliest;
    }, undefined);
  if (first === undefined) {
    return undefined;
  }
  const saying = first.words === undefined ? "" : ` after saying "${clippedWords({ words: first.words })}"`;
  return { atIso: first.atIso, why: `Moved on to ${first.toCardKey} during the Queue walk${saying}.` };
}

/**
 * Whether a settled ask was ever on the owner's Queue: it carries the decision shape a registered ask is the owner's
 * by, or its run still has the question open that once made it theirs.
 *
 * @param row the board row
 * @returns true for an ask that was the owner's
 */
function wasOwners({ row }: { row: BoardRow }): boolean {
  return row.problem !== undefined || row.ownerWait === "settled";
}

/**
 * When and why a settled ask left the owner's Queue: from their ruling when they made one first, since a ruled ask is
 * off the Queue before a session settles it, else from the settle itself.
 *
 * @param row the settled board row
 * @param settledAs how it settled and its witness, `answered: <witness>`
 * @param settledIso when it settled
 * @returns the removal
 */
function settleRemoval({
  row,
  settledAs,
  settledIso,
}: {
  row: BoardRow;
  settledAs: string;
  settledIso: string;
}): CardRemoval {
  const { ruledBeforeSettleIso, ruledBeforeSettleWords } = row;
  // A ruling instant that does not parse never displaces the settle's.
  if (
    ruledBeforeSettleIso === undefined ||
    ruledBeforeSettleWords === undefined ||
    Number.isNaN(Date.parse(ruledBeforeSettleIso))
  ) {
    return { atIso: settledIso, why: `Settled ${settledAs}` };
  }
  return {
    atIso: ruledBeforeSettleIso,
    why: `You ruled on it ("${clippedWords({ words: ruledBeforeSettleWords })}"), then it settled ${settledAs}`,
  };
}

/**
 * What a settled ask's card says: its summary, else the question it asked, else its slug — never a reason to drop
 * it, since the pack lists a settled ask with no summary and the voice's two halves must not disagree.
 *
 * @param row the settled board row
 * @returns the card's text
 */
function settledCardText({ row }: { row: BoardRow }): string {
  if (row.summary !== undefined) {
    return row.summary;
  }
  if (row.question !== undefined) {
    return row.question;
  }
  return row.slug;
}

/**
 * The asks settled off the owner's Queue, each drawn as the card it was and dated by the ruling or the settle that took it off.
 *
 * @param board the board reading
 * @param posts the parked-drafts reading the card's named drafts come from
 * @returns the departed asks, before the window and the context filter
 */
function settledAsks({
  board,
  placer,
  posts,
}: {
  board: LiveState<Board>;
  placer: WorkspacePlacer;
  posts: LiveState<readonly ParkedDraft[]>;
}): readonly { readonly row: QueueRow; readonly removed: CardRemoval | undefined }[] {
  if (board.phase !== "ready") {
    return [];
  }
  const out: { readonly row: QueueRow; readonly removed: CardRemoval | undefined }[] = [];
  for (const row of board.value.rows) {
    if (!isAskCard({ row })) {
      continue;
    }
    const removed = askRemoval({ row });
    // Tagged off the board exactly as `rowsOf` tags its own rows, so it reads as the card it was.
    const tagged = withCardTags({
      board,
      rows: [askRowOf({ placer, posts, question: settledCardText({ row }), row, whenIso: askWhenIso({ row }) })],
    }).map((one) => withBriefingPages({ row: withMachineIdForm({ row: one }) }));
    // A card a gate refused was never on the owner's Queue (`./queueWithholding.ts`), so it never left it either.
    const drawn = partitionQueueRows({ rows: tagged }).rows;
    out.push(...drawn.map((one) => ({ removed, row: one })));
  }
  return out;
}

/**
 * Whether a board row is an ask that was the owner's card — the test the pack applies to the same row (`src/talk/
 * packRecentlyLeft.ts`): not one settled that was never theirs, and not a voice relay row with no problem, no question
 * and nothing waiting on them. So a landing on such an ask names it here as there, settled with no `settledIso` or
 * paused alike. A run of any kind whose question the owner has ruled on was drawn as their ask
 * (`./ownerAsks.ts`) until that ruling, so it is one too, and so is one that ended still carrying its
 * question, dated by a landing alone.
 *
 * @param row the board row
 * @returns true for an ask that was the owner's card
 */
function isAskCard({ row }: { row: BoardRow }): boolean {
  const leftWait = row.ownerWait === "already-ruled" || row.ownerWait === "settled";
  const ruledQuestion = leftWait && row.question !== undefined;
  const settledNotOwners = row.settlement !== undefined && !wasOwners({ row });
  const openNotOwners = row.problem === undefined && row.question === undefined && row.ownerWait === "not-waiting";
  return ruledQuestion || (row.kind === "ask" && !settledNotOwners && !openNotOwners);
}

/**
 * How an ask of the owner's left their Queue by the board alone: settled, by the ruling or the settle; or ruled and not
 * yet settled, by the ruling, since the Queue draws an ask only while it is the owner's (`./ownerAsks.ts`) and a ruled
 * one waits on a session instead.
 *
 * @param row the board row
 * @returns the removal, or `undefined` for a row that is neither
 */
function askRemoval({ row }: { row: BoardRow }): CardRemoval | undefined {
  const { settlement, settlementWitness, settledIso, ruledSinceQuestionIso } = row;
  if (row.ownerWait === "already-ruled" && ruledSinceQuestionIso !== undefined) {
    return { atIso: ruledSinceQuestionIso, why: "You ruled on it; it waits on a session to execute that" };
  }
  // Any kind: only a row `isAskCard` holds reaches here, so its settle took the owner's card off.
  if (!wasOwners({ row }) || settlement === undefined || settlementWitness === undefined || settledIso === undefined) {
    return undefined;
  }
  return settleRemoval({ row, settledAs: `${settlement}: ${clippedWords({ words: settlementWitness })}`, settledIso });
}

/**
 * Every card that left the owner's Queue inside the window, newest removal first, none that is on it again.
 *
 * @param candidates the rows the Queue would draw before the spoken-steer overlay — Alignment and unplaced rows
 *   already out, so a row that was never drawn is never called removed
 * @param live the rows it draws now
 * @param spoken the `talk cards` reading
 * @param steers the steers' overlay
 * @param board the board reading, for placements and for the settled asks
 * @param posts the parked-drafts reading
 * @param nowIso the end of the window — the caller's clock, never read here
 * @param placer the organisation's address readers, which place a settled ask
 * @returns the departed cards
 */
export function recentQueueDepartures({
  candidates,
  live,
  spoken,
  steers,
  board,
  posts,
  nowIso,
  placer,
}: {
  placer: WorkspacePlacer;
  candidates: readonly QueueRow[];
  live: readonly QueueRow[];
  spoken: LiveState<CardLandings>;
  steers: Pick<SteerOverlay, "cameBack" | "collapsed" | "hidden" | "revealed">;
  board: LiveState<Board>;
  posts: LiveState<readonly ParkedDraft[]>;
  nowIso: string;
}): readonly RecentlyLeftCard[] {
  // A card on the list again — under its own key or as another row's alias — has not left it.
  const isLive = (key: string): boolean => live.some((row) => rowOpensAs({ open: key, row }));
  // The overlay first: a card the owner's words took off names those words even if a session settled its row after.
  const overlaid = candidates.flatMap((row): readonly RecentlyLeftCard[] => {
    if (isLive(row.key)) {
      return [];
    }
    const removed = overlayRemoval({ row, spoken, steers });
    if (removed === undefined) {
      return [];
    }
    return [{ removed, row }];
  });
  // An ask off the Queue is no candidate, so words that landed on it are asked for here — and name it only when they
  // came first: a landing written after the settle did not take it off. An ask the board
  // alone does not date (settled before `settledIso` existed, or paused) is named by its words or not at all.
  const settled = settledAsks({ board, placer, posts }).flatMap((left): readonly RecentlyLeftCard[] => {
    const words = overlayRemoval({ row: left.row, spoken, steers });
    if (left.removed === undefined) {
      return words === undefined ? [] : [{ removed: words, row: left.row }];
    }
    if (words === undefined || !isEarlier({ atIso: words.atIso, thanIso: left.removed.atIso })) {
      return [{ removed: left.removed, row: left.row }];
    }
    return [{ removed: words, row: left.row }];
  });
  // One per key, by the EARLIEST removal, and only then the window — as the pack keeps it, so two board rows sharing a
  // slug name the same instant on both halves rather than whichever the board printed first.
  const earliest = new Map<string, RecentlyLeftCard>();
  // Settles first, so a tie names the settle, as the pack's does.
  for (const left of [...settled, ...overlaid]) {
    const before = earliest.get(left.row.key);
    if (before === undefined || isEarlier({ atIso: left.removed.atIso, thanIso: before.removed.atIso })) {
      earliest.set(left.row.key, left);
    }
  }
  const out: RecentlyLeftCard[] = [];
  for (const left of earliest.values()) {
    const atIso = windowedInstant({ atIso: left.removed.atIso, nowIso });
    if (!isLive(left.row.key) && atIso !== undefined) {
      out.push({ removed: { ...left.removed, atIso }, row: left.row });
    }
  }
  return out.toSorted((one, other) => Date.parse(other.removed.atIso) - Date.parse(one.removed.atIso));
}
