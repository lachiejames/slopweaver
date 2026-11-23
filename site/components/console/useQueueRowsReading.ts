/** What `useQueueRows` hands a page and how many registers it reads, and the pure folds it builds them with. */
import { CURRENCY_CHECK, type CurrencyReading } from "../../lib/cardCurrency";
import { SPOKEN_STEERS, spokenGap } from "../../lib/cardLandings";
import { latestReadOf } from "../../lib/liveState";
import { type CardPeople, cardPeople, NO_CARD_PEOPLE } from "../../lib/personMentions";
import type { QueueFocus } from "../../lib/queueFocus";
import { QUEUE_FIRST_READ_BOUNDS_MS, type QueueFirstReadSlug } from "../../lib/queueRegisterPolls";
import type { QueueRow } from "../../lib/queueRows";
import type { WithheldQueueRow } from "../../lib/queueWithholding";
import {
  boundedFirstRead,
  type QueueFreshness,
  queueFreshness,
  type RegisterFreshness,
} from "../../lib/registerFreshness";
import type { StalenessFact } from "../../lib/stalenessLabel";
import type { WorkContext } from "../../lib/workContext";
import type { WorkstreamsReading } from "../../lib/workstreamsReading";
import type { Board, BoardRow, HandStep } from "../live/read";
import type { AutonomyRow } from "../live/readAutonomy";
import type { CardDeferrals } from "../live/readCardDeferrals";
import type { CardLandings } from "../live/readCardLandings";
import type { ImportQuestionReading } from "../live/readImportQuestions";
import type { Reading } from "../live/reading";
import type { LandingReading } from "../live/readLanding";
import type { ParkedReview } from "../live/readReviewDrafts";
import type { Reviewers } from "../live/readReviewers";
import type { ParkedDraft } from "../live/readSlackDrafts";
import type { HeldDraft } from "../live/readThread";
import type { LiveState } from "../live/useLive";
import type { SteerState } from "./steered";

/**
 * How many registers the Queue draws from; the count chip and the empty line both say it. The
 * autonomy ledger is read too, but its acts are the Alignment page's (`../../lib/alignment.ts`), so a Queue that has
 * every one of these seven is complete without it.
 */
export const REGISTERS = 7;

/** The eight registers as read, and the rows they make, before and after the work-context filter. */
export interface QueueReading {
  readonly hands: LiveState<readonly HandStep[]>;
  readonly board: LiveState<Board>;
  readonly drafts: LiveState<readonly HeldDraft[]>;
  readonly landing: LiveState<LandingReading>;
  readonly posts: LiveState<readonly ParkedDraft[]>;
  readonly reviews: LiveState<readonly ParkedReview[]>;
  /** The questions a store import staged and nobody has answered (`../live/readImportQuestions.ts`). */
  readonly imports: LiveState<ImportQuestionReading>;
  readonly acts: LiveState<readonly AutonomyRow[]>;
  /** The cards the owner's spoken words are holding off the queue — an overlay, not a register (`../../lib/cardLandings.ts`). */
  readonly spoken: LiveState<CardLandings>;
  /** The cards the owner put off with "Come back to it" — an overlay on the ORDER, never a register (`../../lib/cardDeferrals.ts`). */
  readonly deferrals: LiveState<CardDeferrals>;
  /**
   * The latest recorded check of whether each card is still the owner's, which every card's mark and the order read — an
   * overlay too, and what opening the Queue refreshes (`../../lib/currencyOpeningRefresh.ts`).
   */
  readonly currency: LiveState<Reading<CurrencyReading>>;
  /**
   * The owner's outcomes register, read for the workstream they made `urgent` — an overlay on the ORDER too, never a
   * register: its cards draw in behind their PR reviews (`../../lib/queueFocus.ts`).
   */
  readonly workstreams: LiveState<WorkstreamsReading>;
  /** The workstreams lifted now, read off {@link workstreams}; none until it reads. */
  readonly focuses: readonly QueueFocus[];
  /** Who reviews each pull request, overlaid on the cards it asks a review on — an overlay too, so marked on its own. */
  readonly reviewers: LiveState<Reviewers>;
  /**
   * The steers this browser collapsed a card on (`./steered.tsx`): a card under one still waiting is out of every
   * list below; a card one came back on is in again, and the page says nothing of why (the chair reads that).
   */
  readonly steered: SteerState;
  /** Every row every register holds that no gate refused, in both work contexts. */
  readonly every: readonly QueueRow[];
  /**
   * The cards a gate refused, in both work contexts — out of {@link every} and so out of every list, count and
   * panel, kept only to say which card it was and why (`../../lib/queueWithholding.ts`).
   */
  readonly withheldEvery: readonly WithheldQueueRow[];
  /** {@link withheldEvery} in the current work context: what the Queue's withheld line counts. */
  readonly withheld: readonly WithheldQueueRow[];
  /** Every person the drafts roster names, with the owner's workstreams whose open rows name them — what a chip draws. */
  readonly people: CardPeople;
  /**
   * The Queue's rows standing in SOME context's view (`standingRows`): {@link every} less a card the owner's words landed
   * on, a row a press just settled, one still waiting on the board to be placed, and every act. What a figure over
   * both contexts counts, so a row never adds to the other context's tally when no view draws it.
   */
  readonly placeable: readonly QueueRow[];
  /**
   * The Queue's rows in the current work context — what every figure on the Queue and the badge counts —
   * less any a press has just settled (`./settling.tsx`): a row answered here leaves the list at the press, not at
   * the re-read. Less, too, every card the owner's spoken words landed on: that card waits on a session now, not on the owner.
   * Never an act: those are {@link alignment}'s.
   */
  readonly rows: readonly QueueRow[];
  /**
   * The rows of {@link placeable} only the OTHER work context draws, which the page says it hides — the other half of
   * the one split {@link rows} comes from (`../../lib/queueShownCounts.ts` `queueContextRows`).
   */
  readonly otherRows: readonly QueueRow[];
  /**
   * Whether both row deciders answered their latest read: the workstreams reading, since an urgent workstream shows its
   * stopping card in BOTH contexts, and the steers reading, since a held steer takes its card off the list until that
   * reading confirms it. Until both have, {@link otherRows} can be short or long by a card, and its length is no count.
   */
  readonly splitRead: boolean;
  /** The work context the rows were split for. */
  readonly context: WorkContext;
  /**
   * The acts the fleet already took, as the Alignment page draws them: built and filtered exactly as {@link rows}
   * is, then split off it by kind (`../../lib/alignment.ts`). One projection, two pages; never a second register.
   */
  readonly alignment: readonly QueueRow[];
  /**
   * The acts the owner's standing rules took off the Alignment page, in the current work context — built and filtered
   * exactly as {@link alignment} is, so a count of them sits beside that page's count over one list
   * (`../../lib/standingRules.ts`).
   */
  readonly settled: readonly QueueRow[];
  /** {@link settled} in every work context: what a relay's placement reads, since an act may settle as the owner speaks. */
  readonly settledEvery: readonly QueueRow[];
  /** How many of the Queue's {@link REGISTERS} answered their LATEST read. */
  readonly readCount: number;
  /**
   * The parked registers whose latest read has not answered, and the spoken-steer overlay when it is partial, in the
   * page's own words — a register drawing an earlier reading over a failed poll included, so no count calls it current.
   */
  readonly missing: readonly string[];
  /**
   * The same registers as {@link missing}, split the way a page draws them: whether any is still on its way (a
   * spinner), and each one whose latest read failed with its reason (a staleness mark's hover).
   */
  readonly unanswered: { readonly reading: boolean; readonly failed: readonly StalenessFact[] };
  /** Whether every register has a reading drawn, current or kept over a failed poll: what the cards on screen hold. */
  readonly allDrawn: boolean;
  /**
   * The row kinds built from any register drawing an earlier reading over a failed poll — every card takes its tags
   * from the board, and a hand card reads the drafts too: their cards stay on screen, and their panels hold every
   * press until it reads again.
   */
  readonly kept: readonly QueueRow["kind"][];
  /** How current the cards on screen are, and why not when they are not (`../../lib/registerFreshness.ts`). */
  readonly freshness: QueueFreshness;
  /**
   * The overlays that can take a card OFF the list — a reviewer the owner picked withdraws a pull request's naming card, a
   * spoken steer hides one — read the same way, so an empty list whose last card an earlier overlay reading removed is
   * never called a measured zero.
   */
  readonly rowOverlays: QueueFreshness;
  /**
   * The readings that move a card on or off the list even UNREAD — a held steer hides its card, an urgent workstream
   * shows a stopping card in this context — so one still loading or failed outright blocks the measured zero too.
   */
  readonly rowDeciders: QueueFreshness;
  /** Whether any register that arrived is a frozen fixture rather than this machine's reading. */
  readonly anyFixture: boolean;
}

/** One parked register as the Queue reads it: what it draws, the row kinds built from it, and its name on the page. */
export interface ParkedRegister {
  readonly drawn: LiveState<unknown>;
  /**
   * Every row kind `rowsOf` builds from this register — every card inherits its tags from the board, a hand card
   * names its drafts, and a hand step absorbing an ask decides whether that ask stands as a card of its own.
   */
  readonly feeds: readonly QueueRow["kind"][];
  readonly label: string;
  /** Its live verb's slug, which names the bound its first answer is held to. */
  readonly slug: QueueFirstReadSlug;
}

/**
 * The seven PARKED registers, named. A count of what waits on the owner's word is only printed once all seven have
 * arrived — measured, the page said "35 waiting on your word" while three of them said NOT MEASURED beside it.
 *
 * @param readings the seven registers as drawn
 * @returns each register with the row kinds it feeds and its label
 */
export function parkedRegistersOf({
  readings,
}: {
  readings: Pick<QueueReading, "board" | "drafts" | "hands" | "imports" | "landing" | "posts" | "reviews">;
}): readonly ParkedRegister[] {
  return [
    { drawn: readings.hands, feeds: ["hand", "ask"], label: "your hands", slug: "hands" },
    { drawn: readings.board, feeds: PARKED_KINDS, label: "recorded asks", slug: "board" },
    { drawn: readings.drafts, feeds: ["draft"], label: "held replies", slug: "drafts" },
    {
      drawn: readings.posts,
      feeds: ["hand", "ask", "post"],
      label: "drafts under your own name",
      slug: "slack-drafts",
    },
    { drawn: readings.reviews, feeds: ["review"], label: "reviews under your name", slug: "review-drafts" },
    { drawn: readings.imports, feeds: ["import"], label: "import questions", slug: "import-questions" },
    { drawn: readings.landing, feeds: ["pr"], label: "pull requests on your judgment", slug: "landing-reading" },
  ];
}

/**
 * The parked row kinds a joined key of kept kinds names, in {@link PARKED_KINDS}' order.
 *
 * @param keptKey the kinds built from a register drawing an earlier reading over a failed poll, joined with commas
 * @returns those kinds
 */
export function keptKindsOf({ keptKey }: { keptKey: string }): readonly QueueRow["kind"][] {
  const named = keptKey.split(",");
  return PARKED_KINDS.filter((kind) => named.includes(kind));
}

/**
 * Whether every parked register has a reading drawn, current or kept over a failed poll: what the cards on screen hold.
 *
 * @param registers the parked registers, from {@link parkedRegistersOf}
 * @returns true once all seven draw a reading
 */
export function allDrawnOf({ registers }: { registers: readonly ParkedRegister[] }): boolean {
  return registers.every((register) => register.drawn.phase === "ready");
}

/**
 * What the badge and the counts must not call current, in the page's own words: each parked register whose LATEST read
 * has not answered (one drawing an earlier reading over a failed poll included), the spoken-steer overlay when it is
 * partial, and the currency check until it reads.
 *
 * @param cardKeys every card the registers built, so a ledger line about any other card is no gap here
 * @param registers the parked registers, from {@link parkedRegistersOf}
 * @param spoken the cards the owner's spoken words landed on
 * @param currency the latest recorded check of whether each card is still the owner's
 * @returns the labels missing, empty when nothing is
 */
export function missingOf({
  cardKeys,
  registers,
  spoken,
  currency,
}: {
  cardKeys: ReadonlySet<string>;
  registers: readonly ParkedRegister[];
  spoken: LiveState<CardLandings>;
  currency: LiveState<Reading<CurrencyReading>>;
}): readonly string[] {
  const missing = registers
    .filter((register) => latestReadOf({ state: register.drawn }).phase !== "ready")
    .map((register) => register.label);
  if (spokenGap({ cardKeys, spoken }) !== undefined) {
    missing.push(SPOKEN_STEERS);
  }
  if (currency.phase !== "ready") {
    missing.push(CURRENCY_CHECK);
  }
  return missing;
}

/**
 * The people the queue can name: the drafts reading's roster — one roster shared by every draft in a read — with the
 * board's workstreams folded onto each. Nobody until the drafts register has read; the owner's own id is the author of a draft
 * parked under their name.
 *
 * @returns the people, by Slack member id
 */
export function queuePeople({
  board,
  posts,
}: {
  board: LiveState<Board>;
  posts: LiveState<readonly ParkedDraft[]>;
}): CardPeople {
  if (posts.phase !== "ready") {
    return NO_CARD_PEOPLE;
  }
  const first = posts.value.at(0);
  if (first === undefined) {
    return NO_CARD_PEOPLE;
  }
  let rows: readonly BoardRow[] = [];
  if (board.phase === "ready") {
    rows = board.value.rows;
  }
  // The first post sent as the owner that RECORDS its author: an older record carries none.
  const owner = posts.value.find((post) => post.actor === "me" && post.authorId !== undefined)?.authorId;
  return cardPeople({ board: rows, owner, roster: first.people });
}

/**
 * One drawn register's freshness fields, read off its live state.
 *
 * @param state the register as the page draws it
 * @returns what the freshness line needs of it
 */
export function freshnessOf<T>({ state }: { state: LiveState<T> }): RegisterFreshness["drawn"] {
  if (state.phase !== "ready") {
    return { phase: state.phase };
  }
  return { observedAtIso: state.observedAtIso, phase: "ready", refreshing: state.refreshing === true };
}

/**
 * What the freshness line and the empty list read of these readings once the page has waited `waitedMs`: each one's
 * drawn reading and latest read, a reading with no first answer by its route timeout named unread
 * ({@link boundedFirstRead}) rather than left in flight.
 *
 * @param readings each reading as drawn, its label on the page and its live verb's slug
 * @param waitedMs how long the page has waited since it opened, in whole bounds passed
 * @returns the line's facts
 */
export function boundedFreshnessOf({
  readings,
  waitedMs,
}: {
  readings: readonly { drawn: LiveState<unknown>; label: string; slug: QueueFirstReadSlug }[];
  waitedMs: number;
}): QueueFreshness {
  return queueFreshness({
    registers: readings.map(({ drawn, label, slug }) =>
      boundedFirstRead({
        boundMs: QUEUE_FIRST_READ_BOUNDS_MS[slug],
        register: { drawn: freshnessOf({ state: drawn }), label, read: latestReadOf({ state: drawn }) },
        waitedMs,
      }),
    ),
  });
}

/** The row kinds a parked register can keep over a failed poll; acts are the ledger's, which is never kept. */
export const PARKED_KINDS: readonly QueueRow["kind"][] = ["hand", "ask", "draft", "post", "review", "import", "pr"];

/**
 * Whether any parked register (or the spoken-steer overlay) is still on its way, and each whose latest read failed,
 * with its reason and, when an earlier reading is still drawn, when that reading was true.
 *
 * @param cardKeys every card the registers built, so a ledger line about any other card is no gap here
 * @returns what a page draws for the registers that have not answered
 */
export function unansweredOf({
  cardKeys,
  parked,
  spoken,
}: {
  cardKeys: ReadonlySet<string>;
  parked: readonly { drawn: LiveState<unknown>; label: string; state: ReturnType<typeof latestReadOf> }[];
  spoken: LiveState<CardLandings>;
}): QueueReading["unanswered"] {
  const failed: StalenessFact[] = [];
  for (const register of parked) {
    if (register.state.phase !== "not-measured") {
      continue;
    }
    const kept = register.drawn.phase === "ready" ? { observedAtIso: register.drawn.observedAtIso } : {};
    failed.push({ subject: register.label, why: register.state.why, ...kept });
  }
  const gap = spokenGap({ cardKeys, spoken });
  if (spoken.phase !== "loading" && gap !== undefined) {
    failed.push({ subject: SPOKEN_STEERS, why: gap });
  }
  return {
    failed,
    reading: spoken.phase === "loading" || parked.some((register) => register.state.phase === "loading"),
  };
}
