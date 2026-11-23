/**
 * The Queue page's layout: each register's first few rows in section order, then one fold standing in for the
 * rest. The page draws it, and the voice's `read_page` reading is built from the SAME layout, so a finding the
 * page folded is folded the same way in what the voice hears.
 */
import type { Kind } from "../components/console/queueKinds";
import type { Board } from "../components/live/read";
import type { CardLandings } from "../components/live/readCardLandings";
import type { LiveState } from "../components/live/useLive";
import { withBriefingPages } from "./cardBriefingPages";
import { deferredLast } from "./cardDeferrals";
import { landingsByCard, landingVerdict, movesByCard, parkedRow } from "./cardLandings";
import { isLifted, type QueueFocus, type QueueSection, queueOrdered, queueSectionOf, SECTIONS } from "./queueFocus";
import type { QueueRow } from "./queueRows";
import { markedInView } from "./queueStopping";
import type { QueueFold } from "./queueVoice";
import { placementWaits } from "./registerPlacement";
import type { SteerOverlay } from "./steeredCards";

/**
 * How many rows a register shows before the card says how many more it holds. Eight, the cut the
 * review-queue page made before this one, and stated in a row of its own rather than a list that silently
 * ends: the unsteered ledger alone held 613 rows when this was measured, and a card of 600 is the wall of
 * text rule 7 exists to prevent.
 */
export const QUEUE_SHOWN = 8;

/** The registers, in the order each one's fold is worked out — never the order a section's cards are drawn in. */
const REGISTER_ORDER = ["hand", "ask", "draft", "post", "review", "import", "pr", "act"] as const;

/** A fold standing in for a register's rows past the first {@link QUEUE_SHOWN}. */
export interface QueueFoldEntry {
  readonly more: Kind;
  readonly count: number;
  /** How many of the folded rows wear a workspace mark, so a finding is never folded as a bare count. */
  readonly marked: number;
  /** The section the fold sits in: a tier, since a lifted section is never folded. */
  readonly section: QueueSection;
}

/**
 * The page's entries in draw order: the Queue's ONE order (`./queueFocus.ts` `queueOrdered`), which the voice's
 * `action_items` and triage pass read too, so the card numbered 1 here is the card the voice raises first. Section by section — a card blocking one of the owner's priorities, those priorities' own
 * cards, a stopped automation, then each tier — so the numbering runs straight through every section.
 *
 * Inside a section the rows keep that one order, whatever register each came from: grouping by register over it put a
 * stale hand step above a fresh ask only because hands were drawn first. The order is by what needs the
 * owner's attention most right now. In a tier each register shows its first {@link QUEUE_SHOWN} rows, and its one fold sits
 * straight after the last of them, so expanding one register never moves another's cards. A lifted section is never
 * folded: it is what leads the owner's Queue, and a fold in it would number a card on the page differently from the
 * one the voice raises at that place.
 *
 * Then, after every one of those, the cards the owner put off with "Come back to it" (`./cardDeferrals.ts`), oldest
 * deferral first, each keeping its tier for the badge and `queueCounts`. Never folded: each is a card the owner chose
 * to put off, one press at a time, and a fold would hide the very card they said they would come back to. Nor is a
 * held post whose card says why the owner's yes is not being sent (`saysWhyNotSent`): that card is the one place the
 * reason reaches the owner, the page and the voice alike.
 *
 * @param rows the context-filtered rows the page draws
 * @param expanded the registers the owner opened past their fold
 * @param focuses the workstreams lifted now, the first priority first; none draws today's tiers alone
 * @param shows whether the view draws a row by its placement, so a fold counts a stopping card's "whose card" mark
 * @returns the rows and folds, in the order the page draws them
 */
export function queueLayout({
  rows,
  expanded,
  focuses,
  shows,
}: {
  rows: readonly QueueRow[];
  expanded: readonly Kind[];
  focuses: readonly QueueFocus[];
  shows: (row: QueueRow) => boolean;
}): readonly (QueueRow | QueueFoldEntry)[] {
  const { now, deferred } = deferredLast({ rows: queueOrdered({ focuses, rows }) });
  const entries: (QueueRow | QueueFoldEntry)[] = [];
  for (const section of SECTIONS) {
    const inSection = now.filter((row) => queueSectionOf({ focuses, row }) === section);
    const shown = new Set<QueueRow>();
    // Each register's fold, keyed by the last of its rows drawn — where the fold is placed.
    const foldAfter = new Map<QueueRow, QueueFoldEntry>();
    for (const kind of REGISTER_ORDER) {
      const ofKind = inSection.filter((row) => row.kind === kind);
      const open = expanded.includes(kind) || isLifted(section);
      // A post saying why the owner's yes is not sent is never folded: the card IS where that reason reaches them.
      const drawn = ofKind.filter((row, index) => open || index < QUEUE_SHOWN || row.saysWhyNotSent === true);
      const folded = ofKind.filter((row) => !drawn.includes(row));
      for (const row of drawn) {
        shown.add(row);
      }
      const last = drawn.at(-1);
      if (folded.length > 0 && last !== undefined) {
        foldAfter.set(last, {
          count: folded.length,
          marked: markedInView({ rows: folded, shows }),
          more: kind,
          section,
        });
      }
    }
    for (const row of inSection.filter((each) => shown.has(each))) {
      entries.push(row);
      const fold = foldAfter.get(row);
      if (fold !== undefined) {
        entries.push(fold);
      }
    }
  }
  entries.push(...deferred);
  return entries;
}

/**
 * A layout split into what the voice reads: the rows drawn, and each fold with its marked count.
 *
 * @returns the drawn rows and the folds, each in draw order
 */
export function layoutForVoice({ layout }: { layout: readonly (QueueRow | QueueFoldEntry)[] }): {
  readonly drawn: readonly QueueRow[];
  readonly folded: readonly QueueFold[];
} {
  return {
    drawn: layout.flatMap((entry) => ("key" in entry ? [entry] : [])),
    folded: layout.flatMap((entry): QueueFold[] => {
      if ("key" in entry) {
        return [];
      }
      // A fold in a tier reads exactly as it always did. A lifted section is never folded (`queueLayout`), so this arm
      // names a section only if that ever changes: those hold cards of more than one tier.
      if (isLifted(entry.section)) {
        return [{ count: entry.count, marked: entry.marked, register: entry.more, section: entry.section }];
      }
      return [{ count: entry.count, marked: entry.marked, register: entry.more, tier: entry.section }];
    }),
  };
}

/**
 * The rows standing in SOME workspace's view — every register's rows less a card the owner's spoken words landed on,
 * one a press has just settled, and a hand step or act still waiting on the board to be placed. A figure over
 * both workspaces (the "N in the other workspace" note, the badge tally) counts this set, so it never counts a
 * row no view draws; the page's own rows are this set filtered by the selector.
 *
 * A card the owner's words landed on whose work is a row a session is running now stands as that recut instead
 * ({@link recutRow}), off the badge. A card the owner's triage ruling parked stands put off, below the rest, with the ruling
 * on it (`./cardLandings.ts` `parkedRow`).
 *
 * @param every every row every register holds
 * @param spoken the `talk cards` reading
 * @param steers the steers this page collapsed, laid over it (`./steeredCards.ts`)
 * @param settled the keys a press has just settled
 * @param board the board reading a hand step or act joins, and a recut is found running on
 * @returns the rows some view draws
 */
export function standingRows({
  every,
  spoken,
  steers,
  settled,
  board,
}: {
  every: readonly QueueRow[];
  spoken: LiveState<CardLandings>;
  steers: Pick<SteerOverlay, "hidden" | "revealed">;
  settled: readonly string[];
  board: LiveState<Board>;
}): readonly QueueRow[] {
  const byCard = landingsByCard({ spoken });
  const moved = movesByCard({ spoken });
  const inFlight = inFlightSlugs({ board });
  const standing: QueueRow[] = [];
  for (const row of every) {
    const verdict = landingVerdict({ inFlight, landings: byCard.get(row.key), moves: moved.get(row.key), row, steers });
    if (verdict.kind === "hidden" || settled.includes(row.key) || placementWaits({ board, row })) {
      continue;
    }
    if (verdict.kind === "recut") {
      const recut = recutRow({ row, seat: verdict.seat });
      standing.push(verdict.triage === undefined ? recut : { ...recut, triage: verdict.triage });
    } else if (verdict.kind === "parked") {
      standing.push(parkedRow({ row, sinceIso: verdict.sinceIso, triage: verdict.triage }));
    } else {
      standing.push(row);
    }
  }
  // A recut or a park rewrites a card's words after `rowsOf` drew its briefings, so draw them again over what the
  // card now says: the voice reads this row, and every briefing it can read here is a chip.
  return standing.map((row) => withBriefingPages({ row }));
}

/**
 * The slugs of every board row a session is running now: in flight, with an active run. A planned row is not a
 * recut in flight — nothing is acting on the owner's words yet — so its card stays off their list instead.
 *
 * @param board the board reading
 * @returns the slugs; none until the board reads
 */
export function inFlightSlugs({ board }: { board: LiveState<Board> }): ReadonlySet<string> {
  if (board.phase !== "ready") {
    return new Set();
  }
  return inFlightSlugsOf({ rows: board.value.rows });
}

/**
 * The slugs of the rows a session is running now, over rows already read — the one rule behind {@link inFlightSlugs},
 * kept apart from the reading so any other board shape can apply the same rule.
 *
 * @param rows board rows, by their section, run state and slug
 * @returns the slugs in flight with an active run
 */
export function inFlightSlugsOf({
  rows,
}: {
  rows: readonly { readonly section: string; readonly run: string | undefined; readonly slug: string }[];
}): ReadonlySet<string> {
  return new Set(rows.filter((row) => row.section === "IN FLIGHT" && row.run === "active").map((row) => row.slug));
}

/**
 * A card whose recut a seat is making, drawn as that and not as the old ask: its heading says which seat, and it
 * ranks with the check-ins, off the badge, because nothing on it waits on the owner until the recut comes back.
 *
 * @param row the card the owner's words landed on
 * @param seat the in-flight board row acting on them
 * @returns the row as the recut it now is
 */
export function recutRow({ row, seat }: { row: QueueRow; seat: string }): QueueRow {
  return { ...row, card: { ...row.card, question: `Recut in flight, ${seat}` }, tier: "check-in" };
}
