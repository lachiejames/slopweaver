/**
 * The Queue's rows from its readings, in both work contexts: the one projection the console's Queue memoises stage by
 * stage (`../components/console/useQueueRows.ts`) and the voice runs whole, only at the moment a call asks
 * (`../components/voice/useVoiceReadings.ts`). Pure, and each stage is its own function so the console can keep a
 * settle press from rebuilding every row.
 *
 * Why the voice runs it lazily: MEASURED on the owner's machine (16 GB M1 Pro), the desktop voice
 * overlay with no call live drew 13–17% of a core between spikes and 69–76% every twenty seconds, because the voice
 * mounted the Queue's eager hook and every register's poll handed over a fresh reading, so each one rebuilt all 1,488
 * rows. One rebuild over the live readings then took about 350 ms in Node (`rowsOf` ~250, `standingRows` ~73,
 * `settledActRowsOf` ~25), against about 2 ms to parse every payload. Reproduce the CPU: `ps -o pid,command` the app's
 * helpers, take the one whose arguments carry `--slopweaver-role=overlay`, then
 * `top -l 13 -s 5 -pid <overlay> -stats pid,cpu,mem,command` with no call live.
 */
import type { Board, HandStep } from "../components/live/read";
import type { AutonomyRow } from "../components/live/readAutonomy";
import type { CardDeferrals } from "../components/live/readCardDeferrals";
import type { CardLandings } from "../components/live/readCardLandings";
import type { ImportQuestionReading } from "../components/live/readImportQuestions";
import type { Reading } from "../components/live/reading";
import type { LandingReading } from "../components/live/readLanding";
import type { ParkedReview } from "../components/live/readReviewDrafts";
import type { Reviewers } from "../components/live/readReviewers";
import type { ParkedDraft } from "../components/live/readSlackDrafts";
import type { StandingAskReading } from "../components/live/readStandingAsks";
import type { HeldDraft } from "../components/live/readThread";
import type { LiveState } from "../components/live/useLive";
import { partitionAlignmentRows } from "./alignment";
import type { CurrencyReading } from "./cardCurrency";
import { currencyOrdered } from "./cardCurrencyMark";
import { withDeferrals } from "./cardDeferrals";
import { type QueueFocus, queueFocuses } from "./queueFocus";
import { standingRows } from "./queueLayout";
import { type QueueRow, rowsOf } from "./queueRows";
import { withStopping } from "./queueStopping";
import { partitionQueueRows, type QueueRowPartition, type WithheldQueueRow } from "./queueWithholding";
import { settledActRowsOf } from "./standingRules";
import type { SteerOverlay } from "./steeredCards";
import type { WorkspacePlacer } from "./workspacePlacement";
import type { WorkstreamsReading } from "./workstreamsReading";

/** Every reading the Queue's rows are built from: the seven registers, the autonomy ledger and the overlays. */
export interface QueueProjectionReadings {
  readonly acts: LiveState<readonly AutonomyRow[]>;
  readonly board: LiveState<Board>;
  readonly currency: LiveState<Reading<CurrencyReading>>;
  readonly deferrals: LiveState<CardDeferrals>;
  readonly drafts: LiveState<readonly HeldDraft[]>;
  readonly hands: LiveState<readonly HandStep[]>;
  readonly imports: LiveState<ImportQuestionReading>;
  readonly landing: LiveState<LandingReading>;
  readonly posts: LiveState<readonly ParkedDraft[]>;
  readonly reviewers: LiveState<Reviewers>;
  readonly reviews: LiveState<readonly ParkedReview[]>;
  readonly spoken: LiveState<CardLandings>;
  readonly standing: LiveState<StandingAskReading>;
  readonly workstreams: LiveState<WorkstreamsReading>;
}

/** The Queue's rows in both work contexts, before any page filters them to the context it shows. */
export interface QueueProjection {
  /** Every row no gate refused, ordered and stamped with what stops the owner's work. */
  readonly every: readonly QueueRow[];
  /** The rows a gate refused, kept only to say which card it was and why. */
  readonly withheldEvery: readonly WithheldQueueRow[];
  /** The workstreams the owner lifted. */
  readonly focuses: readonly QueueFocus[];
  /** The Queue's rows standing in some context's view: {@link every} less what landed, settled or waits on placing. */
  readonly placeable: readonly QueueRow[];
  /** The acts standing in some context's view, which the Alignment page draws. */
  readonly alignmentEvery: readonly QueueRow[];
  /** The acts the owner's standing rules took off the Alignment page. */
  readonly settledEvery: readonly QueueRow[];
}

/**
 * Every row the registers make, split into the drawn and the withheld: the projection's costly stage.
 *
 * @param readings the registers and overlays as read
 * @param placer which work context each row belongs to
 * @returns the drawn rows and the rows a gate refused
 */
export function queueBuilt({
  readings,
  placer,
}: {
  readings: Pick<
    QueueProjectionReadings,
    "acts" | "board" | "drafts" | "hands" | "imports" | "landing" | "posts" | "reviewers" | "reviews" | "standing"
  >;
  placer: WorkspacePlacer;
}): QueueRowPartition {
  const { acts, board, drafts, hands, imports, landing, posts, reviewers, reviews, standing } = readings;
  return partitionQueueRows({
    rows: rowsOf({ acts, board, drafts, hands, imports, landing, placer, posts, reviewers, reviews, standing }),
  });
}

/**
 * The drawn rows in the order the Queue draws them: the currency check's order, put-off cards below, and each stamped
 * with what stops the owner's work.
 *
 * @param rows the drawn rows from {@link queueBuilt}
 * @param focuses the workstreams the owner lifted
 * @returns every row, ordered and stamped
 */
export function queueEvery({
  rows,
  board,
  currency,
  deferrals,
  focuses,
}: {
  rows: readonly QueueRow[];
  board: LiveState<Board>;
  currency: LiveState<Reading<CurrencyReading>>;
  deferrals: LiveState<CardDeferrals>;
  focuses: readonly QueueFocus[];
}): readonly QueueRow[] {
  let reading: CurrencyReading | undefined;
  if (currency.phase === "ready") {
    reading = currency.value.value;
  }
  return withStopping({
    board,
    focuses,
    rows: withDeferrals({ deferrals, rows: currencyOrdered({ reading, rows }) }),
  });
}

/**
 * The rows standing in some context's view, split into the Queue's side and the Alignment page's acts.
 *
 * @param every every row, from {@link queueEvery}
 * @param settled the keys a press on this page has just settled
 * @param spoken the cards the owner's spoken words landed on
 * @param steers the steers this browser is still holding a card off the list for
 * @returns the Queue's side and the acts' side
 */
export function queueStanding({
  every,
  board,
  settled,
  spoken,
  steers,
}: {
  every: readonly QueueRow[];
  board: LiveState<Board>;
  settled: readonly string[];
  spoken: LiveState<CardLandings>;
  steers: Pick<SteerOverlay, "hidden" | "revealed">;
}): { readonly queueSide: readonly QueueRow[]; readonly alignmentSide: readonly QueueRow[] } {
  return partitionAlignmentRows({ rows: standingRows({ board, every, settled, spoken, steers }) });
}

/**
 * The whole projection at once, for a reader that asks rarely and holds nothing between asks.
 *
 * @param readings every reading the rows are built from
 * @param placer which work context each row belongs to
 * @param settled the keys a press has just settled
 * @param steers the steers this browser is still holding a card off the list for
 * @returns the Queue's rows in both work contexts
 */
export function projectQueue({
  readings,
  placer,
  settled,
  steers,
}: {
  readings: QueueProjectionReadings;
  placer: WorkspacePlacer;
  settled: readonly string[];
  steers: Pick<SteerOverlay, "hidden" | "revealed">;
}): QueueProjection {
  const built = queueBuilt({ placer, readings });
  const focuses = queueFocuses({ workstreams: readings.workstreams });
  const every = queueEvery({
    board: readings.board,
    currency: readings.currency,
    deferrals: readings.deferrals,
    focuses,
    rows: built.rows,
  });
  const standing = queueStanding({ board: readings.board, every, settled, spoken: readings.spoken, steers });
  return {
    alignmentEvery: standing.alignmentSide,
    every,
    focuses,
    placeable: standing.queueSide,
    settledEvery: settledActRowsOf({
      acts: readings.acts,
      board: readings.board,
      landing: readings.landing,
      placer,
    }),
    withheldEvery: built.withheld,
  };
}
