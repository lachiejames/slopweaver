/**
 * What the console voice hands the model when it calls `action_items`.
 *
 * ## Why it is the page's projection and not a verb of its own
 *
 * The model must not be able to tell the owner a number the screen disagrees with. So this reads the SAME
 * readings the Queue page subscribes to and runs them through the SAME `rowsOf` projection — the readings
 * are module-scoped channels (`components/live/useLiveChannels.ts` § Channel), so subscribing from a second page
 * costs one extra subscriber and no extra read.
 *
 * Module-scoped means per DOCUMENT, and a held reading can be hours old, so the readings this runs over at a Queue
 * tool are the record read afresh at that tool (`./voiceRecordQueue.ts`). That is
 * why: the voice window's held copy can list cards the console window's Queue stopped drawing hours before. On
 * the Queue page the answer keeps exactly the cards the page drew, in its order (`drawn`), only while the screen and
 * the record agree.
 *
 * ## An unread source is named, never counted as zero
 *
 * The important half. A register that has not arrived yet, or that could not be measured, contributes no
 * rows to `rowsOf`, and a total taken over what DID arrive is indistinguishable from a real total. Spoken
 * out loud — which is the whole point of this tab — that becomes "you have four things waiting", said with
 * a voice, about a screen showing eleven.
 *
 * So the answer carries `unread`, and `complete` is false whenever it is non-empty. The tool's own
 * description (`src/talk/talkToolSchemas.ts`) tells the model never to state a total when a source is
 * unread, and this shape is what makes that instruction checkable rather than hopeful.
 *
 * ## Ranked, and the top blocker named
 *
 * The items arrive in the Queue's ONE order (`./queueFocus.ts` `queueOrdered`), the order the page draws and a triage
 * pass walks: a card blocking one of the owner's priorities, the priorities' own cards, a stopped automation, then each tier — what
 * blocks a colleague, the fleet's own stopped work, check-ins last. A voice that leads the owner through a run of
 * "I did this, is that cool with you" acts while work sits blocked on them gets it wrong: the owner expects to be led
 * to the blocker first. So the answer carries `top` — the first item that BLOCKS something, never a check-in — and the
 * three tier counts, and the tool's instructions open with `top`. Ranking before the cap is what keeps
 * {@link MAX_SPOKEN} from ever handing the model a page of check-ins with a blocker cut off below it.
 */

import type { CardDeferrals } from "../components/live/readCardDeferrals";
import type { CardLandings } from "../components/live/readCardLandings";
import type { Reading } from "../components/live/reading";
import type { LiveState } from "../components/live/useLive";
import {
  ACTION_ITEMS_MAX_BYTES,
  fitActionItems,
  fitJsonString,
  fitSpokenItem,
  fitSpokenLeft,
  ITEM_FIELD_MAX_BYTES,
  type SpokenItemName,
  spokenNameOf,
} from "./actionItemsFit";
import { isAlignmentRow, partitionAlignmentRows } from "./alignment";
import { CURRENCY_CHECK, type CurrencyReading, currencyOrdered } from "./cardCurrencyMark";
import { withDeferrals } from "./cardDeferrals";
import { SPOKEN_STEERS, spokenGap, unlandedRows } from "./cardLandings";
import { queueFocuses, queueOrdered } from "./queueFocus";
import { standingRows } from "./queueLayout";
import { type QueueRow, rowsOf } from "./queueRows";
import { missingDrawnWhy, SCREEN_QUEUE_SOURCE, screenOrdered } from "./queueScreenVoice";
import { type QueueShownCounts, type ShownForVoice, shownForVoice } from "./queueShownCounts";
import { markedInView, shownOnQueue, withStopping } from "./queueStopping";
import { partitionQueueRows, type WithheldQueueRow } from "./queueWithholding";
import { type CardRemoval, type RecentlyLeftCard, recentQueueDepartures } from "./recentQueueDepartures";
import { placementWaits } from "./registerPlacement";
import type { SteerOverlay } from "./steeredCards";
import { type SpokenItem, spokenOf } from "./talkActionItemsSpoken";
import { parksTheCard } from "./triageWords";
import type { WorkspacePlacer } from "./workspacePlacement";
import type { WorkstreamsReading } from "./workstreamsReading";

/** A source that contributed nothing, and why — so the model can say so instead of counting it as zero. */
export interface UnreadSource {
  readonly source: string;
  /** `loading` while a read is in flight, else the reason it could not be measured. */
  readonly why: string;
}

/** The whole answer to one `action_items` call. */
export interface ActionItemsAnswer {
  /** False whenever {@link ActionItemsAnswer.unread} is non-empty — no total may be stated then. */
  readonly complete: boolean;
  /**
   * What to open with, by key and subject: the highest-ranked item that BLOCKS something, its detail in
   * {@link ActionItemsAnswer.items}. `undefined` when nothing read blocks anything — the check-ins are then all there
   * is, and never the lead.
   */
  readonly top: SpokenItemName | undefined;
  /** Ranked, in full detail: team-blocked first, check-ins last. */
  readonly items: readonly SpokenItem[];
  /**
   * Every row inside {@link MAX_SPOKEN}, ranked, by key and subject — those whose detail the byte budget shed
   * included — so a card the owner names can be found and opened (`./actionItemsFit.ts`).
   */
  readonly itemNames: readonly SpokenItemName[];
  /**
   * The rows absent from {@link ActionItemsAnswer.items} — ranked below {@link MAX_SPOKEN}, or their detail shed to
   * fit — and whether any of them carry a workspace mark, so a finding cut below it is said to exist rather than
   * dropped from one view, and whether any is a card the owner parked, which the cap cuts first because it is
   * listed last. Whether, never how many: a count of capped rows is not a figure the page prints, and a spoken
   * fourteen over a screen showing another figure is one.
   */
  readonly beyondCap: { readonly more: boolean; readonly marked: boolean; readonly parked: boolean };
  readonly unread: readonly UnreadSource[];
  /**
   * The cards that left the owner's Queue in the last day, newest removal first, each marked removed with when and why
   * (`./recentQueueDepartures.ts`) — so "go find the one I was just reading" resolves after a session acted on it.
   * Never counted in {@link ActionItemsAnswer.shown} nor named by {@link ActionItemsAnswer.top}: they are not on
   * the owner's Queue, and the answer says so on each.
   */
  readonly recentlyLeft: readonly SpokenLeft[];
  /** Every departed card inside {@link MAX_RECENTLY_LEFT}, newest first, by key and subject. */
  readonly recentlyLeftNames: readonly SpokenItemName[];
  /**
   * How many departed cards are absent from {@link ActionItemsAnswer.recentlyLeft} — older than
   * {@link MAX_RECENTLY_LEFT}, or their detail shed to fit — so a cut list is never read as the whole.
   */
  readonly recentlyLeftBeyondCap: number;
  /** The oldest instant any contributing reading was true of the machine, so freshness is the owner's to judge. */
  readonly observedAtIso: string | undefined;
  /**
   * How many cards in this context failed their own checks and are held off the owner's Queue until the supervisor fixes
   * them (`./queueWithholding.ts`). Never counted in {@link ActionItemsAnswer.shown} nor listed as an item: their
   * words are what failed, so none is read out.
   */
  readonly withheld: number;
  /** The work context the page is filtered to, since the items are filtered by it. */
  readonly context: string;
  /**
   * The counts the app SHOWS, under the labels it prints them with — the Queue's selector and the sidebar badge, over
   * the rows those draw (`./queueShownCounts.ts`) — or `unread` where it prints none. The only Queue figures this
   * answer carries, and the only numbers the voice may say about the owner's Queue: a voice saying fourteen
   * cards while the app shows Everything 29 is the failure this prevents. No tally of these capped rows rides beside it, so nothing in the answer
   * can disagree with the page.
   */
  readonly shown: ShownForVoice;
  /** What fitting {@link ACTION_ITEMS_MAX_BYTES} cost, in one line — `undefined` when the answer is whole. */
  readonly cut: string | undefined;
}

/** A card that left the owner's Queue, flattened as an item is, with when and why it left. */
export type SpokenLeft = SpokenItem & { readonly removed: CardRemoval };

/** How many items one call carries. Past this the model is reading a list, not talking something through. */
const MAX_SPOKEN = 25;

/** How many departed cards one call carries — the newest, which is the one "the card I was just reading" means. */
const MAX_RECENTLY_LEFT = 10;

/**
 * Name what a reading contributed, or why it contributed nothing.
 *
 * @param state the reading as the page holds it
 * @param source the register's name, as the model should say it
 * @returns the unread row, or `undefined` when the reading arrived
 */
function unreadOf<T>({ state, source }: { state: LiveState<T>; source: string }): UnreadSource | undefined {
  if (state.phase === "ready") {
    return undefined;
  }
  if (state.phase === "loading") {
    return { source, why: "still loading" };
  }
  return { source, why: state.why };
}

/**
 * The oldest instant among the readings that arrived.
 *
 * Oldest rather than newest on purpose: the answer is only as fresh as its stalest contributing source,
 * and reporting the newest would let one fast register vouch for four slow ones.
 *
 * @param states the seven readings
 * @returns the instant, or `undefined` when none arrived
 */
function oldestObserved({ states }: { states: readonly LiveState<unknown>[] }): string | undefined {
  const stamps = states.filter((state) => state.phase === "ready").map((state) => state.observedAtIso);
  if (stamps.length === 0) {
    return undefined;
  }
  return stamps.reduce((oldest, stamp) => (stamp < oldest ? stamp : oldest));
}

/** The readings the Queue's rows are projected from, and the overlays that leave a row out. */
export interface ActionItemReadings {
  readonly hands: Parameters<typeof rowsOf>[0]["hands"];
  readonly board: Parameters<typeof rowsOf>[0]["board"];
  readonly drafts: Parameters<typeof rowsOf>[0]["drafts"];
  readonly posts: Parameters<typeof rowsOf>[0]["posts"];
  readonly reviews: Parameters<typeof rowsOf>[0]["reviews"];
  readonly imports: Parameters<typeof rowsOf>[0]["imports"];
  readonly landing: Parameters<typeof rowsOf>[0]["landing"];
  readonly reviewers: Parameters<typeof rowsOf>[0]["reviewers"];
  readonly acts: Parameters<typeof rowsOf>[0]["acts"];
  /** The owner's standing asks, which a card no particular steer of the owner's is behind quotes, as the Queue does. */
  readonly standing: Parameters<typeof rowsOf>[0]["standing"];
  readonly spoken: LiveState<CardLandings>;
  /**
   * The steers' overlay — the collapsed and came-back halves too, which name why a hidden card left — and, over a fresh
   * record read, the unread `talk steers` reading a held steer was judged against (`heldSteersUnreadOf`). Absent by
   * design where nothing held rests on an unread reading.
   */
  readonly steers: Pick<SteerOverlay, "cameBack" | "collapsed" | "hidden" | "revealed"> & {
    readonly unread?: UnreadSource;
  };
  /** The tick's check of whether each card is still the owner's, which ranks the items as it ranks the Queue. */
  readonly currency: LiveState<Reading<CurrencyReading>>;
  /** The owner's outcomes register, which names the focus lifted in behind their PR reviews, as the Queue lifts it. */
  readonly workstreams: LiveState<WorkstreamsReading>;
  /** The cards the owner put off, stamped on each row as the Queue stamps them, so a deferred card lifts nothing here either. */
  readonly deferrals: LiveState<CardDeferrals>;
}

/** The Queue's rows as the voice reads them: what is on it, and what left it recently. */
export interface ActionItemProjection {
  /** Every row the Queue draws, ranked, in both work contexts. */
  readonly live: readonly QueueRow[];
  /** The cards that left it inside the window, newest removal first, in both work contexts. */
  readonly recentlyLeft: readonly RecentlyLeftCard[];
  /** The cards a gate refused, held off the Queue, in both work contexts (`./queueWithholding.ts`). */
  readonly withheld: readonly WithheldQueueRow[];
  /** The acts the Alignment page asks about — never an item, only what `read_card` resolves (`./cardToolPlan.ts`). */
  readonly alignment: readonly QueueRow[];
  /**
   * Every card the registers built, before any landing took one off, in both work contexts: a ledger line that did not
   * read is a gap for the voice only when it may hold one of these (`./cardLandings.ts` `spokenGap`).
   */
  readonly builtKeys: ReadonlySet<string>;
}

/**
 * The Queue's rows and the cards that recently left it, from ONE projection — what `action_items` filters and
 * `read_card`/`open_card` resolve a key against, so the three can never disagree about which cards exist or left.
 *
 * @param readings the registers and the overlays
 * @param nowIso the end of the departure window — the caller's clock
 * @param placer the organisation's address readers, which place every row as the Queue places it
 * @returns both lists, before any context filter
 */
export function actionItemProjection({
  readings,
  nowIso,
  placer,
}: {
  readings: ActionItemReadings;
  nowIso: string;
  placer: WorkspacePlacer;
}): ActionItemProjection {
  const {
    hands,
    board,
    drafts,
    posts,
    reviews,
    imports,
    landing,
    reviewers,
    acts,
    standing,
    spoken,
    steers,
    currency,
    deferrals,
    workstreams,
  } = readings;
  // A hand step waits for the board its placement joins, drawn and counted nowhere until it arrives, as the
  // Queue holds it (`placementWaits`): the model sees exactly the rows the owner does. An act is never an action item. The
  // Alignment page asks each one as a was-this-the-right-call question (`./alignment.ts`), off the Queue and so off
  // this answer; both are out BEFORE the overlay, so neither is ever called a card that left.
  // A card a gate refused is withheld exactly as the Queue withholds it (`./queueWithholding.ts`): never an item,
  // never a card that left, only counted.
  const built = partitionQueueRows({
    rows: rowsOf({ acts, board, drafts, hands, imports, landing, placer, posts, reviewers, reviews, standing }),
  });
  // Ranked by the same currency order the Queue draws (`../components/console/useQueueRows.ts`), so the top item the
  // voice names and the card numbered 1 on the page are one card.
  let reading: CurrencyReading | undefined;
  if (currency.phase === "ready") {
    reading = currency.value.value;
  }
  // Never lifted here: these rows span both work contexts, and a lift taken over both would carry into a context holding
  // no focus card. `actionItemsAnswer` lifts the rows one context shows, as the page lifts what it draws.
  // Stamped with the owner's deferrals as the page stamps `every`, so a card they put off lifts nothing and the voice's triage pass
  // walks it last, as the Queue draws it. Then stamped with what stops the owner's work, as the page stamps `every`, so
  // the top item the voice names is the card the page leads with (`./queueStopping.ts`).
  const ranked = withStopping({
    board,
    focuses: queueFocuses({ workstreams }),
    rows: withDeferrals({ deferrals, rows: currencyOrdered({ reading, rows: built.rows }) }),
  });
  const placed = ranked.filter((row) => !placementWaits({ board, row }));
  const candidates = placed.filter((row) => !isAlignmentRow({ row }));
  const live = unlandedRows({ rows: candidates, spoken, steers });
  // The acts as the Alignment page stands them (`useQueueRows.ts`), a recut in flight included; a
  // card just settled there is held in that window alone, so the card tools drop it (`./cardToolPlan.ts`).
  const standingActs = standingRows({ board, every: ranked, settled: [], spoken, steers });
  return {
    alignment: partitionAlignmentRows({ rows: standingActs }).alignmentSide,
    builtKeys: new Set(ranked.map((row) => row.key)),
    live,
    recentlyLeft: recentQueueDepartures({ board, candidates, live, nowIso, placer, posts, spoken, steers }),
    withheld: built.withheld,
  };
}

/**
 * Build the answer to one `action_items` call.
 *
 * @param reviewers the reviewer reading, which withdraws a naming card the owner already answered, as the Queue does
 * @param spoken the cards the owner's spoken words landed on, left out as the Queue leaves them out
 * @param steers the steers the Queue collapsed and gave back (`./steeredCards.ts`): a collapsed card is no item, a
 *   card a steer came back on is one again
 * @param shows the page's own context filter, applied so the model sees exactly the rows the owner sees
 * @param context the context's name, for the model to say
 * @param shown the counts the app shows now, from the Queue's own reading (`queueShownOf`)
 * @param nowIso the end of the departure window — the caller's clock
 * @param placer the organisation's address readers, which place every row as the Queue places it
 * @param drawn on the Queue, every key the page drew, in its order (`./queueVoice.ts` `drawnKeys`): the items are then
 *   exactly those cards, its view, tag filter and folds applied as the page applied them; absent
 *   anywhere else, where the items are the Queue's order over the context
 * @returns the items ranked, the top blocker, the counts, the cards that recently left, and every source that did
 *   not contribute
 */
export function actionItemsAnswer({
  placer,
  hands,
  board,
  drafts,
  posts,
  reviews,
  imports,
  landing,
  reviewers,
  acts,
  standing,
  spoken,
  steers,
  currency,
  workstreams,
  deferrals,
  shows,
  context,
  shown,
  nowIso,
  drawn,
}: ActionItemReadings & {
  placer: WorkspacePlacer;
  shows: (row: { readonly placement: QueueRow["placement"] }) => boolean;
  context: string;
  shown: QueueShownCounts;
  nowIso: string;
  drawn?: readonly string[] | undefined;
}): ActionItemsAnswer {
  const unread = [
    unreadOf({ source: "your hands", state: hands }),
    unreadOf({ source: "the board", state: board }),
    unreadOf({ source: "held replies", state: drafts }),
    unreadOf({ source: "drafts under your own name", state: posts }),
    unreadOf({ source: "reviews under your name", state: reviews }),
    unreadOf({ source: "import questions", state: imports }),
    unreadOf({ source: "pull requests", state: landing }),
    // A naming card the owner already answered is withdrawn by this reading, so without it such a card can be listed.
    unreadOf({ source: "reviewer suggestions", state: reviewers }),
    // A card the owner deferred sits out of the Queue by this reading, so without it a deferred card can be listed.
    unreadOf({ source: "card deferrals", state: deferrals }),
    // A card no particular steer is behind quotes the standing ask it rests on from this reading.
    unreadOf({ source: "standing asks", state: standing }),
    // Its ranking rests on this reading, so a top item named without it is not the card the Queue numbers 1.
    unreadOf({ source: CURRENCY_CHECK, state: currency }),
    // The priorities the Queue is ordered by and triage walks: unread, they lift nothing, so the order said is tier order
    // and may not be the one they would give. No register configured is a READY reading
    // (`./workstreamsReading.ts`), so this names only a real failure. A card tool now carries the list beside a card it
    // found rather than refusing it, so naming it refuses nothing.
    unreadOf({ source: "your workstream priorities", state: workstreams }),
  ].filter((row): row is UnreadSource => row !== undefined);
  const projection = actionItemProjection({
    nowIso,
    placer,
    readings: {
      acts,
      board,
      currency,
      deferrals,
      drafts,
      hands,
      imports,
      landing,
      posts,
      reviewers,
      reviews,
      spoken,
      standing,
      steers,
      workstreams,
    },
  });
  // Only a ledger line that may hold a card these registers built is a gap here: one about a card that is not on the
  // Queue at all, or naming no card key, cannot put a steered card in front of the owner.
  const gap = spokenGap({ cardKeys: projection.builtKeys, spoken });
  if (gap !== undefined) {
    unread.push({ source: SPOKEN_STEERS, why: gap });
  }
  // A steer held on this call is judged against `talk steers`; unread, it keeps its card hidden.
  if (steers.unread !== undefined) {
    unread.push(steers.unread);
  }
  // The Queue's one order over the rows this context shows, as the page draws them (`./queueFocus.ts`
  // `queueOrdered`). Off the Queue a tier fold hides cards this list
  // still holds, in the same order. On the Queue the list is the page's own drawn cards, so item N is the card it
  // numbers N (`./queueScreenVoice.ts`); a drawn card no reading here holds empties the list and is named, because a
  // list missing a card the owner sees is not the list the owner sees.
  const screen = screenOrdered({
    drawn,
    live: projection.live,
    ordered: queueOrdered({
      focuses: queueFocuses({ workstreams }),
      // A card stopping the owner's work is shown in both contexts, as the page shows it (`./queueStopping.ts`).
      rows: projection.live.filter((row) => shownOnQueue({ row, shows })),
    }),
  });
  let { rows } = screen;
  if (screen.missing.length > 0) {
    rows = [];
    unread.push({ source: SCREEN_QUEUE_SOURCE, why: missingDrawnWhy({ missing: screen.missing }) });
  }
  const left = projection.recentlyLeft.filter(({ row }) => shows(row));
  const lead = rows.find((row) => row.tier !== "check-in");
  const cut = rows.slice(MAX_SPOKEN);
  const shortened = { count: 0 };
  const items = rows.slice(0, MAX_SPOKEN).map((row) => fitSpokenItem({ item: spokenOf({ row, shows }), shortened }));
  const recentlyLeft = left
    .slice(0, MAX_RECENTLY_LEFT)
    .map(({ row, removed }) => fitSpokenLeft({ item: { ...spokenOf({ row, shows }), removed }, shortened }));
  const whole: ActionItemsAnswer = {
    beyondCap: {
      marked: markedInView({ rows: cut, shows }) > 0,
      more: cut.length > 0,
      parked: cut.some((row) => parksTheCard({ verdict: row.triage?.verdict })),
    },
    complete: unread.length === 0,
    context,
    cut: undefined,
    itemNames: items.map((item) => spokenNameOf({ item, shortened })),
    items,
    observedAtIso: oldestObserved({ states: [hands, board, drafts, posts, reviews, imports, landing] }),
    recentlyLeft,
    recentlyLeftBeyondCap: left.slice(MAX_RECENTLY_LEFT).length,
    recentlyLeftNames: recentlyLeft.map((item) => spokenNameOf({ item, shortened })),
    shown: shownForVoice({ shown }),
    top:
      lead === undefined ? undefined : spokenNameOf({ item: { key: lead.key, subject: lead.card.subject }, shortened }),
    unread: unread.map((row) => {
      const why = fitJsonString({ maxBytes: ITEM_FIELD_MAX_BYTES, text: row.why });
      shortened.count += why.cut ? 1 : 0;
      return { ...row, why: why.text };
    }),
    withheld: projection.withheld.filter((row) => shows(row)).length,
  };
  return fitActionItems({ answer: whole, maxBytes: ACTION_ITEMS_MAX_BYTES, shortened: shortened.count });
}
