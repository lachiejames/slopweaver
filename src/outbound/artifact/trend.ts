/**
 * Whether this window is on fire, and how much against the ones before it. Pure, and card-side.
 *
 * A daily alert post OPENS with that judgement. The judgement is here, beside
 * the card that renders it; the Slack half — cutting one wide crawl into the reported window and the baseline
 * behind it — is `../../live/slack/alertTrend.ts`, which knows nothing about a TL;DR.
 *
 * ## Both numbers are raw, and the ratio is COMPUTED
 *
 * The form carries a baseline TOTAL and how many windows it is spread over. It carries no ratio and there is no
 * field to supply one in, for exactly the reason `./alertSummary.ts` accepts no total: a ratio somebody wrote
 * could disagree with the counts printed beside it, and nobody reading the card could tell which was right.
 *
 * ## An empty baseline yields NO verdict, deliberately
 *
 * A baseline of zero notifications is not a quiet baseline. It is a channel that did not exist, a crawl that
 * stopped early, or a row's first firing. So {@link deriveTrend} declines there, the TL;DR omits its clause
 * entirely, and the below-fold paragraph says the prior span was not read. A "steady" derived from no data
 * would be the first wrong number on a card whose whole design is that it cannot carry one.
 */

/**
 * The most prior windows a form may claim.
 *
 * A bound exists so the derived TL;DR's width is PROVABLE, the same reason `ALERT_SUMMARY_COUNT_MAX` exists:
 * the number is rendered into `the prior N windows`, and an unbounded one would push that clause past the
 * layout's cap at the unattended hour. Nine keeps it one digit wide.
 */
export const ALERT_TREND_PRIOR_WINDOWS_MAX = 9;

/**
 * How many prior windows a baseline averages over — the one number both alert lanes read.
 *
 * Three days is enough to survive one quiet weekend day without reaching back past the shape of the week. It is
 * bounded by {@link ALERT_TREND_PRIOR_WINDOWS_MAX} rather than standing alone, because the number reaches the
 * card's TL;DR and the card's width promise is what bounds it. It lives here rather than beside either reader:
 * the Slack summary cuts one wide crawl into this many windows (`../../live/slack/alertTrend.ts`) and the
 * Datadog digest reruns each probe over the same span (`../../cli/commands/datadog/alertDigestRun.ts`), so a
 * policy owned by one of them would be the other's silent dependency.
 */
export const ALERT_TREND_PRIOR_WINDOWS = Math.min(3, ALERT_TREND_PRIOR_WINDOWS_MAX);

/** The verdicts, most alarming first. */
export const TREND_VERDICTS = ["on-fire", "up", "steady", "down"] as const;

/** How this window compares with the ones before it.
 *
 * @internal — reached through {@link AlertTrend}, never named outside this file.
 */
export type TrendVerdict = (typeof TREND_VERDICTS)[number];

/**
 * The ratio at or above which a window is on fire — three times the recent average.
 *
 * Three rather than two because these are alert channels, and an alert channel doubles on an ordinary Tuesday.
 * It is a judgement, written once so it is arguable in one place rather than inferred from the sentence it
 * renders.
 */
const ON_FIRE_RATIO = 3;

/** The ratio at or above which a window is up on its baseline. */
const UP_RATIO = 1.5;

/** The ratio at or below which a window is down on it — about a third quieter. */
const DOWN_RATIO = 0.67;

/**
 * The widest ratio the card will PRINT.
 *
 * Display only: the verdict is taken from the real ratio and only the rendered number clamps. Without it a
 * baseline of one notification against a noisy window renders a five-digit multiplier into a TL;DR whose width
 * this module's own cap promises is bounded.
 */
const RATIO_DISPLAY_MAX = 99.9;

/** What the baseline counted, carried raw so the card derives the ratio rather than accepting one. */
export interface AlertTrendReading {
  /** How many notifications fired across the whole baseline. */
  readonly priorTotal: number;
  /** How many windows that total is spread over. */
  readonly priorWindows: number;
}

/** A window judged against its baseline. */
export interface AlertTrend {
  readonly verdict: TrendVerdict;
  /** This window's total over the baseline's per-window average. Unclamped — {@link ratioText} clamps. */
  readonly ratio: number;
  /** The baseline's per-window average, which the below-fold paragraph prints. */
  readonly perWindow: number;
  /** The reading this judgement was made from, carried so no renderer has to fetch it a second time. */
  readonly reading: AlertTrendReading;
}

/** Which band a ratio falls in. An if-chain rather than a nested ternary, which the house rule bans. */
function verdictOfRatio({ ratio }: { ratio: number }): TrendVerdict {
  if (ratio >= ON_FIRE_RATIO) {
    return "on-fire";
  }
  if (ratio >= UP_RATIO) {
    return "up";
  }
  if (ratio <= DOWN_RATIO) {
    return "down";
  }
  return "steady";
}

/**
 * Judge this window against its baseline, or decline to.
 *
 * Declines on an absent reading, on a baseline covering no whole window, and on a baseline that counted
 * nothing — each of which is an absence of evidence rather than evidence of quiet, per the file overview.
 *
 * @param current how many notifications fired in the card's own window
 * @param reading what the baseline counted, absent when the wider read did not happen
 * @returns the verdict and the ratio behind it, or undefined when there is no baseline to judge against
 */
export function deriveTrend({
  current,
  reading,
}: {
  current: number;
  reading: AlertTrendReading | undefined;
}): AlertTrend | undefined {
  if (reading === undefined || reading.priorWindows <= 0 || reading.priorTotal <= 0) {
    return undefined;
  }
  const perWindow = reading.priorTotal / reading.priorWindows;
  const ratio = current / perWindow;
  return { perWindow, ratio, reading, verdict: verdictOfRatio({ ratio }) };
}

/**
 * `2.1×` as the TL;DR prints it, clamped so the clause's width is bounded — and a clamped ratio says so with a
 * leading `>`, because a bare `99.9×` over a real 4000× is a number the card never measured.
 *
 * The multiplication sign is the character rather than the letter, because it is the one this card already
 * uses for a count (`12×`) and the voice rules read the DERIVED card, not the source.
 *
 * @param ratio the unclamped ratio
 * @returns the rendered multiplier
 */
export function ratioText({ ratio }: { ratio: number }): string {
  if (ratio > RATIO_DISPLAY_MAX) {
    return `>${RATIO_DISPLAY_MAX.toFixed(1)}×`;
  }
  return `${ratio.toFixed(1)}×`;
}

/**
 * The clause the TL;DR appends after the count sentence, or nothing when no baseline was read.
 *
 * @param trend the judged trend, absent when there is none
 * @returns the clause, leading space included, or undefined
 */
export function trendClause({ trend }: { trend: AlertTrend | undefined }): string | undefined {
  if (trend === undefined) {
    return undefined;
  }
  const windows = trend.reading.priorWindows;
  const named = windows === 1 ? "the prior window" : `the prior ${String(windows)} windows`;
  return ` ${ratioText({ ratio: trend.ratio })} ${named}.`;
}

/**
 * The below-fold paragraph naming the baseline in raw numbers, or the absence of one.
 *
 * Both numbers are printed rather than only the ratio, because a ratio hides the thing most likely to be wrong
 * about it: a baseline that crosses a deploy, a monitor's creation or a muted weekend inflates the multiplier
 * and nothing in this repository can detect that. Printing what was divided by what lets a reader see the
 * baseline they are being compared against and discount it themselves.
 *
 * @param trend the judged trend, absent when the baseline was not read or counted nothing
 * @param window the card's own window label, which each prior window is one of
 * @param current how many were counted in the card's own window
 * @param counted what one of them IS: an alert summary counts notifications, so `alerts`; an alert digest sums
 *   whatever its probes count — matched events for most, a summed attribute for a `logs-facet-sum` — so the neutral
 *   `counted`, because a sentence calling 1,243 failed sends "alerts" would misname what was divided
 * @returns the sentence
 */
export function trendSentence({
  trend,
  window,
  current,
  counted,
}: {
  trend: AlertTrend | undefined;
  window: string;
  current: number;
  counted: "alerts" | "counted";
}): string {
  if (trend === undefined) {
    // Short on purpose. It is below the fold, it competes with the telemetry lane for the same prose budget
    // (`./alertSummary.ts`'s `fittedLane`), and the whole claim it has to make is that no comparison was made.
    return "No comparison with the prior windows was made.";
  }
  const { priorWindows, priorTotal } = trend.reading;
  return (
    `Prior ${String(priorWindows)} ${TREND_MULTIPLY} ${window}: ${String(priorTotal)} ${counted}, ` +
    `${trend.perWindow.toFixed(1)} per window. This window: ${String(current)}.`
  );
}

/** The multiplication sign the trend sentence spells `3 × 24h` with — the character, never the letter. */
const TREND_MULTIPLY = "×";
