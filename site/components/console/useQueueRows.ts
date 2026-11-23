"use client";

import { useEffect, useMemo, useState } from "react";

import { type CurrencyReading } from "../../lib/cardCurrencyMark";
import { SPOKEN_STEERS } from "../../lib/cardLandings";
import { answeredHere, latestReadOf } from "../../lib/liveState";
import { FOCUS_POLL_MS, queueFocuses } from "../../lib/queueFocus";
import { queueBuilt, queueEvery, queueStanding } from "../../lib/queueProjection";
import {
  FAST_POLL_MS,
  QUEUE_FIRST_READ_BOUNDS_MS,
  QUEUE_REGISTER_POLLS,
  type QueueFirstReadSlug,
} from "../../lib/queueRegisterPolls";
import { type QueueScope, type QueueShownCounts, queueContextRows, queueShownCounts } from "../../lib/queueShownCounts";
import { settledActRowsOf } from "../../lib/standingRules";
import { readWorkstreamsReading, type WorkstreamsReading } from "../../lib/workstreamsReading";
import { type Board, type HandStep, readBoard, readHandSteps } from "../live/read";
import { type AutonomyRow, readAutonomy } from "../live/readAutonomy";
import { type CardDeferrals, readCardDeferrals } from "../live/readCardDeferrals";
import { type CardLandings, readCardLandings } from "../live/readCardLandings";
import { readCurrencyReading } from "../live/readCurrency";
import { type ImportQuestionReading, readImportQuestions } from "../live/readImportQuestions";
import type { Reading } from "../live/reading";
import { type LandingReading, readLandingReading } from "../live/readLanding";
import { type ParkedReview, readParkedReviews } from "../live/readReviewDrafts";
import { type Reviewers, readReviewers } from "../live/readReviewers";
import { type ParkedDraft, readParkedDrafts } from "../live/readSlackDrafts";
import { readStandingAsks, type StandingAskReading } from "../live/readStandingAsks";
import { type HeldDraft, readHeldDrafts } from "../live/readThread";
import { type LiveState, liveDeliveriesOf, refreshLive, useLive } from "../live/useLive";
import { useWorkspacePlacer } from "./organisationState";
import { useSettling } from "./settling";
import { useSteerOverlay } from "./steered";
import {
  allDrawnOf,
  boundedFreshnessOf,
  keptKindsOf,
  missingOf,
  parkedRegistersOf,
  type QueueReading,
  queuePeople,
  unansweredOf,
} from "./useQueueRowsReading";
import { useWorkContext } from "./workContextState";

export { FAST_POLL_MS } from "../../lib/queueRegisterPolls";
export { type OpenedRow, useOpenedRow } from "./useQueueRowsOpen";
export { type QueueReading, REGISTERS } from "./useQueueRowsReading";

/**
 * The hand rows whose stale board this page has already asked to read again, each with how many answers the board
 * had delivered on this page when it asked — so a card can tell the one re-read has landed (`askPendingNow`,
 * `../../lib/cardLoading.ts`) by a count, never a stamp two answers could share. Module-scoped because
 * the sidebar badge and the queue body each run `useQueueRows`, and one set per hook read the board twice.
 */
const REREAD_ROWS = new Map<string, number>();

/**
 * Whether the board re-read this page asked for one hand row has landed.
 *
 * @param key the row's key
 * @returns `undefined` when no re-read was asked for the row, else whether an answer has arrived since
 */
export function boardRereadOf({ key }: { key: string }): { landed: boolean } | undefined {
  const asked = REREAD_ROWS.get(key);
  if (asked === undefined) {
    return undefined;
  }
  return { landed: liveDeliveriesOf({ slug: "board" }) > asked };
}

/**
 * The counts the app shows over one reading — the Queue's selector, the sidebar badge, and what the voice's counts
 * are checked against — so the three read one computation (`../../lib/queueShownCounts.ts`). The badge prints a
 * number only once every register it counts read its latest poll and nothing it folds is missing.
 *
 * @param reading the Queue's registers and rows, from {@link useQueueRows} or the voice's own projection
 * @param scope the tag filter and open view the counts are taken under
 * @returns every count, labelled, `undefined` where the app prints none
 */
export function queueShownOf({
  reading,
  scope,
}: {
  reading: Pick<
    QueueReading,
    | "allDrawn"
    | "board"
    | "context"
    | "drafts"
    | "hands"
    | "imports"
    | "landing"
    | "missing"
    | "otherRows"
    | "posts"
    | "reviews"
    | "rows"
    | "splitRead"
  >;
  scope: QueueScope;
}): QueueShownCounts {
  const { board, drafts, hands, imports, landing, posts, reviews } = reading;
  const registersRead = [hands, board, drafts, posts, reviews, imports, landing].every(
    (state) => state.phase === "ready",
  );
  return queueShownCounts({
    allDrawn: reading.allDrawn,
    badgeRead: registersRead && reading.missing.length === 0,
    boardRead: board.phase === "ready",
    context: reading.context,
    otherRows: reading.otherRows,
    rows: reading.rows,
    scope,
    splitRead: reading.splitRead,
  });
}

/** Each distinct first-read bound, ascending: the instants after the page opens at which a reading can turn overdue. */
const FIRST_READ_BOUNDS: readonly number[] = [...new Set(Object.values(QUEUE_FIRST_READ_BOUNDS_MS))].toSorted(
  (left, right) => left - right,
);

/**
 * How long this page has waited since it opened, counted in the first-read bounds it has passed: it moves only when
 * one passes, so a reading held to that bound turns overdue on that render and the page re-renders for nothing else.
 *
 * @returns the largest bound passed, 0 before the first
 */
function useFirstReadWait(): number {
  const [waitedMs, setWaitedMs] = useState(0);
  useEffect(() => {
    const timers = FIRST_READ_BOUNDS.map((boundMs) =>
      setTimeout(() => {
        setWaitedMs((was) => Math.max(was, boundMs));
      }, boundMs),
    );
    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, []);
  return waitedMs;
}

/**
 * The eight registers the queue reads, read once for every page that draws them.
 *
 * The Queue, the sidebar badge, the Alignment page and the voice's readings each read these same eight channels.
 * `useLive`'s channels are module-scoped, so a second subscriber costs no second fetch — the one hook exists so they cannot
 * drift apart on which registers, which intervals or which filter make a row.
 *
 * @returns the registers, the rows and what is still missing
 */
export function useQueueRows(): QueueReading {
  const placer = useWorkspacePlacer();
  const waitedMs = useFirstReadWait();
  // What each register DRAWS: its last reading over a failed poll, marked stale, so a card on screen never leaves the
  // list because one read failed (`../../lib/liveState.ts`). Its LATEST read (`latestReadOf`) is what `missing`, the
  // counts and the freshness line report.
  // Each register's interval is `QUEUE_REGISTER_POLLS`'s, so none is read once and left to age on an open page
  // (`../../lib/queueRegisterPolls.ts`): the board's slow verb polls once a minute, the rest on the fast lane.
  // Every reading the page holds to a first-read bound (`QUEUE_FIRST_READ_BOUNDS_MS`) is `primary`, so its first read
  // goes ahead of the shell's badges for one of the three slots (`../../lib/liveSlots.ts`).
  const hands = useLive<readonly HandStep[]>({
    everyMs: QUEUE_REGISTER_POLLS.hands,
    primary: true,
    read: readHandSteps,
    slug: "hands",
  });
  const board = useLive<Board>({ everyMs: QUEUE_REGISTER_POLLS.board, primary: true, read: readBoard, slug: "board" });
  const drafts = useLive<readonly HeldDraft[]>({
    everyMs: QUEUE_REGISTER_POLLS.drafts,
    primary: true,
    read: readHeldDrafts,
    slug: "drafts",
  });
  const landing = useLive<LandingReading>({
    everyMs: QUEUE_REGISTER_POLLS["landing-reading"],
    primary: true,
    read: readLandingReading,
    slug: "landing-reading",
  });
  const posts = useLive<readonly ParkedDraft[]>({
    everyMs: QUEUE_REGISTER_POLLS["slack-drafts"],
    primary: true,
    read: readParkedDrafts,
    slug: "slack-drafts",
  });
  const reviews = useLive<readonly ParkedReview[]>({
    everyMs: QUEUE_REGISTER_POLLS["review-drafts"],
    primary: true,
    read: readParkedReviews,
    slug: "review-drafts",
  });
  const imports = useLive<ImportQuestionReading>({
    everyMs: QUEUE_REGISTER_POLLS["import-questions"],
    primary: true,
    read: readImportQuestions,
    slug: "import-questions",
  });
  const acts = useLive<readonly AutonomyRow[]>({ read: readAutonomy, slug: "autonomy" });
  const spoken = useLive<CardLandings>({
    everyMs: FAST_POLL_MS,
    primary: true,
    read: readCardLandings,
    slug: "talk-cards",
  });
  // An overlay on the landing register, not a ninth register: a reviewer the owner picked withdraws its naming card.
  const reviewers = useLive<Reviewers>({
    everyMs: FAST_POLL_MS,
    primary: true,
    read: readReviewers,
    slug: "reviewers",
  });
  // An overlay too: the standing ask a card no particular steer of the owner's is behind quotes (`../../lib/standingAskSource.ts`).
  // Never kept over a failed poll, so a withdrawn ask is never quoted from an old reading.
  const standingAsks = useLive<StandingAskReading>({
    everyMs: FAST_POLL_MS,
    primary: true,
    read: readStandingAsks,
    slug: "standing-asks",
  });
  const { context, shows } = useWorkContext();
  const { hidden } = useSettling();
  const steered = useSteerOverlay({ primary: true, spoken });
  // Memoised so a row keeps its identity between renders that changed nothing: a page's snapshot compares
  // by identity, and rows rebuilt on every render would make it store one on every render.
  // Not a ninth register: the latest recorded check of whether each ask card is still the owner's, by the tick or by opening
  // the Queue (`./useCurrencyOpeningRefresh.ts`). A card that looks answered, or opens an ask the owner already ruled on, moves
  // to the check-ins, off the badge, and a fresh card leads its tier (`../../lib/cardCurrencyMark.ts`); the mark itself
  // reads the same channel.
  const currency = useLive<Reading<CurrencyReading>>({
    everyMs: FAST_POLL_MS,
    read: readCurrencyReading,
    slug: "currency-reading",
  });
  // Not a ninth register either: the cards the owner put off with "Come back to it", which the page draws below the rest
  // (`../../lib/cardDeferrals.ts`). It moves no count, so it is never one of `missing`.
  const deferrals = useLive<CardDeferrals>({ everyMs: FAST_POLL_MS, read: readCardDeferrals, slug: "queue-deferred" });
  // Not a ninth register either: the workstream the owner made urgent, whose cards draw in behind their PR reviews
  // (`../../lib/queueFocus.ts`). It moves no count, so it is never one of `missing`.
  const workstreams = useLive<WorkstreamsReading>({
    everyMs: FOCUS_POLL_MS,
    primary: true,
    read: (payload) => readWorkstreamsReading({ payload }),
    slug: "workstreams",
  });
  const focuses = useMemo(() => queueFocuses({ workstreams }), [workstreams]);
  // A card a gate refused is withheld here, before anything orders, counts or draws it (`../../lib/queueWithholding.ts`).
  // The projection's stages (`../../lib/queueProjection.ts`), each in its own memo so a settle press or a spoken steer
  // re-runs only the standing stage, never the costly build.
  const built = useMemo(
    () =>
      queueBuilt({
        placer,
        readings: { acts, board, drafts, hands, imports, landing, posts, reviewers, reviews, standing: standingAsks },
      }),
    [acts, board, drafts, hands, imports, landing, placer, posts, reviewers, reviews, standingAsks],
  );
  // Never lifted here: `every` spans both work contexts, and a lift taken over both would carry into a context holding no
  // focus card. Each surface lifts the list it shows (`../../lib/queueFocus.ts`).
  // Stamped with what stops the owner's work over every row, before any view filters them, so the page and the voice read
  // one stamp (`../../lib/queueStopping.ts`).
  const every = useMemo(
    () => queueEvery({ board, currency, deferrals, focuses, rows: built.rows }),
    [board, built.rows, currency, deferrals, focuses],
  );
  const withheldEvery = built.withheld;
  const withheld = useMemo(() => withheldEvery.filter((row) => shows(row)), [withheldEvery, shows]);
  // The board polls once a minute while hands poll every twenty seconds, so a step posted with the page open can meet
  // a board that predates it; each such step reads the board again at once rather than waiting out the minute
  // (`boardStale`, `../../lib/queueRows.ts`).
  useEffect(() => {
    const stale = every.filter((row) => row.record.kind === "hand" && row.record.boardStale);
    const fresh = stale.filter((row) => !REREAD_ROWS.has(row.key));
    if (fresh.length === 0) {
      return;
    }
    // Counted before the re-read is asked, so its own answer is the one that moves the count; the count outlives the
    // channel, as this set does, so a queue left and revisited still compares like with like.
    const asked = liveDeliveriesOf({ slug: "board" });
    for (const row of fresh) {
      REREAD_ROWS.set(row.key, asked);
    }
    refreshLive({ slug: "board" });
  }, [every]);
  // Every person the drafts roster names, with the owner's workstreams naming them — once per reading, for every card
  // and tile, so a `<@U…>` anywhere on the queue reads as a name.
  const people = useMemo(() => queuePeople({ board, posts }), [board, posts]);
  const standing = useMemo(
    () => queueStanding({ board, every, settled: hidden, spoken, steers: steered.overlay }),
    [every, hidden, spoken, steered.overlay, board],
  );
  const placeable = standing.queueSide;
  // A card stopping the owner's work is shown in both contexts: one behind the switcher is buried (`../../lib/queueStopping.ts`).
  // The rest of the other context's cards are counted, so the page says how many it hid.
  const { otherRows, rows } = useMemo(() => queueContextRows({ placeable, shows }), [placeable, shows]);
  const alignment = useMemo(() => standing.alignmentSide.filter((row) => shows(row)), [standing.alignmentSide, shows]);
  const settledEvery = useMemo(
    () => settledActRowsOf({ acts, board, landing, placer }),
    [acts, board, landing, placer],
  );
  const settled = useMemo(() => settledEvery.filter((row) => shows(row)), [settledEvery, shows]);
  // Every card the registers built, before any landing or context takes one off: a ledger line that did not read is a gap
  // on this page only when it may hold one of these (`../../lib/cardLandings.ts` `spokenGap`).
  const builtKeys = useMemo(() => new Set(every.map((row) => row.key)), [every]);
  const registers = useMemo(
    () => parkedRegistersOf({ readings: { board, drafts, hands, imports, landing, posts, reviews } }),
    [board, drafts, hands, imports, landing, posts, reviews],
  );
  // From the RAW reads: a register drawing an earlier reading over a failed poll is missing here, so the badge never
  // counts it as current. `allDrawn` is the cards-on-screen fact the view counts read instead, and the freshness line
  // says which register is stale.
  const allDrawn = allDrawnOf({ registers });
  const missing = missingOf({ cardKeys: builtKeys, currency, registers, spoken });
  // The overlays that can take a card off the list, which the empty list's proof reads beside the registers. With the
  // deciders below, this is every live reading `rows` depends on: `currency` and `deferrals` reorder and never drop a
  // row, `placer` is organisation config, and `hidden` is the owner's own settling on this page.
  const rowOverlays: readonly { drawn: LiveState<unknown>; label: string; slug: QueueFirstReadSlug }[] = [
    { drawn: reviewers, label: "who reviews each pull request", slug: "reviewers" },
    { drawn: spoken, label: SPOKEN_STEERS, slug: "talk-cards" },
    // A retained standing ask's quote can carry a machine id the withholding gate refuses.
    { drawn: standingAsks, label: "the standing asks behind cards", slug: "standing-asks" },
  ];
  // The readings that move a card on or off the list even UNREAD, so one on its first read or failed outright blocks
  // the measured zero too (Codex r17): a held steer hides its card until this reading confirms it (Codex r15), and an
  // urgent workstream shows its stopping card in both contexts (Codex r16).
  const rowDeciders: readonly { drawn: LiveState<unknown>; label: string; slug: QueueFirstReadSlug }[] = [
    { drawn: steered.reading, label: "the steers you gave that are still being relayed", slug: "talk-steers" },
    { drawn: workstreams, label: "which workstream you made urgent", slug: "workstreams" },
  ];
  // Each register's latest read, which has failed where `drawn` is an earlier reading marked stale.
  const parked = registers.map((register) => ({ ...register, state: latestReadOf({ state: register.drawn }) }));
  // What the page draws from each register. The ledger is the Alignment page's, which states its own reading.
  const all = parked.map((register) => register.drawn);
  // Everything read off `parked` is taken before the `kept` memo below, so nothing after it can be read as mutating
  // what that memo's key was derived from.
  const anyFixture = all.some((state) => state.phase === "ready" && state.fixture !== undefined);
  // A reading with no first answer by its route timeout is named unread, never left spinning (`boundedFirstRead`).
  const freshness = boundedFreshnessOf({ readings: registers, waitedMs });
  const readCount = parked.filter((register) => register.state.phase === "ready").length;
  const unanswered = unansweredOf({ cardKeys: builtKeys, parked, spoken });
  // One array per change, so a page filtering its rows by it memoizes. A register drawing an earlier reading than its
  // latest read answered holds every press on its cards (a kept hand step's "Mark done" would otherwise stay
  // enabled over a failed read).
  const keptKey = parked
    .filter((register) => register.drawn.phase === "ready" && register.state.phase !== "ready")
    .flatMap((register) => register.feeds)
    .join(",");
  const kept = useMemo(() => keptKindsOf({ keptKey }), [keptKey]);
  return {
    acts,
    alignment,
    anyFixture,
    board,
    context,
    currency,
    deferrals,
    drafts,
    every,
    focuses,
    workstreams,
    reviewers,
    hands,
    imports,
    landing,
    placeable,
    freshness,
    allDrawn,
    kept,
    missing,
    otherRows,
    // On each decider's FIRST answer on this page: a reading handed over on mount says nothing of now.
    splitRead: rowDeciders.every(({ drawn }) => answeredHere({ state: drawn })),
    people,
    posts,
    readCount,
    rowDeciders: boundedFreshnessOf({ readings: rowDeciders, waitedMs }),
    rowOverlays: boundedFreshnessOf({ readings: rowOverlays, waitedMs }),
    unanswered,
    reviews,
    rows,
    settled,
    settledEvery,
    spoken,
    steered,
    withheld,
    withheldEvery,
  };
}
