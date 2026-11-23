/**
 * How evenly the fleet's plans are being drawn down, and which way each one leans. Pure: no clock, no
 * filesystem, no network, no credential.
 *
 * ## The question this answers, which no existing module answers
 *
 * `routeSpawn.ts` decides where ONE spawn goes. `select.ts` decides where the ONE shared credential slot
 * sits. Neither ever asks whether the fleet as a whole is drifting — and drift is the thing that strands a
 * budget. The rule: no plan deviates from another by more than 10-15% in weekly or Fable limit, and
 * the fleet never hits its weekly limit while most of a Fable limit sits unused. That is a fleet-level
 * measurement, so it lives in its own module rather than inside either ranker.
 *
 * ## Why the target here is the SPREAD and not a within-plan ratio
 *
 * The routing audit derives a balance point of 32.6% Fable share from a measured
 * allowance ratio of 4,860M to 14,933M meter units, and that derivation is worth reading. It is deliberately
 * NOT the target this module grades against, for a reason the audit states about itself: the ratio was
 * fitted treating Opus, Sonnet and Fable tokens as equally weighted inside the plan-wide window, and no
 * reading exists that could test that. Grading a fleet against a number carrying an untested assumption
 * would report a confident verdict built on it.
 *
 * The owner's number needs no such assumption. "No plan deviating more than about 10 to 15 percent" is a
 * statement about the gap BETWEEN plans in one window, which is arithmetic over readings that already exist.
 * So the verdict is computed from that, and the per-plan lean is reported as information beside it rather
 * than graded.
 *
 * ## Absent is NOT MEASURED, and a one-plan fleet is not a balanced one
 *
 * A gauge taken with a non-Fable model carries no Fable window at all (`gaugeProbe.ts`), and a store holding
 * no login yields no gauge whatsoever. Both are silence, not zero. So a spread over fewer than two readings
 * is {@link SpreadVerdict}'s `unmeasurable` rather than a spread of nothing — MEASURED on an install with
 * exactly one readable plan of three, and a module that reported that fleet perfectly
 * balanced would be telling the single lie this whole feature exists not to tell. Reproduce with
 * `slopweaver claude gauge --json | jq '{readable, unreadable}'`.
 */
import type { ClaudeThresholds } from "../plans/thresholds.js";
import type { ClaudeAccountGauge, ClaudeWindowReading } from "./contracts.js";

/*
 * The two bands are the install's own, off the plan register's `thresholds.claude` (`balancedSpreadPercent`,
 * `driftingSpreadPercent`), never a constant here (a limit fixed in code goes into the store).
 * Their defaults are the owner's 10 to 15 percent, a chosen number rather than a derived one, so they
 * need no assumption about how the provider weights models inside a window. At or below the first the fleet is
 * balanced; past the second it is out of band; between the two it is drifting.
 */

/** The two spread bands a grade reads, as fractions. */
type SpreadBands = Pick<ClaudeThresholds, "balancedSpread" | "driftingSpread">;

/**
 * How a fleet's spread in one window grades against the owner's 10-to-15-percent target.
 *
 * @internal — the type of {@link FleetSpread}'s own `verdict` field; a caller reads it off a spread rather
 *   than naming this type.
 */
export type SpreadVerdict =
  /** Fewer than two plans carried this window, so there is no gap to measure. Never report this as balance. */
  | "unmeasurable"
  /** At or under the balanced band. */
  | "balanced"
  /** Past the balanced band but within the drifting one — the band the target calls "about". */
  | "drifting"
  /** Past the drifting band. */
  | "out-of-band";

/** Which window a spread was measured over. The Fable window is the one that strands when it is left behind. */
export type SpreadWindow = "seven_day" | "seven_day_fable";

/**
 * One plan at one end of a spread — the alias to name and the number that put it there.
 *
 * @internal — an element of {@link FleetSpread}; a caller reads `lowest`/`highest` off a spread rather than
 *   constructing one.
 */
export interface SpreadEnd {
  readonly alias: string;
  /** Fraction spent, 0..1 as the header carries it — NOT a percentage. */
  readonly utilization: number;
}

/**
 * How far apart the plans are in one window.
 *
 * @internal — the value {@link fleetSpread} returns; a renderer and the `--json` document read it rather
 *   than constructing one.
 */
export interface FleetSpread {
  readonly window: SpreadWindow;
  /** How many plans carried this window at all — the honest denominator behind every other field. */
  readonly counted: number;
  readonly verdict: SpreadVerdict;
  /** The least-spent plan, absent when nothing carried this window. */
  readonly lowest?: SpreadEnd;
  /** The most-spent plan, absent when nothing carried this window. */
  readonly highest?: SpreadEnd;
  /** Highest minus lowest, absent when fewer than two plans carried this window. */
  readonly spread?: number;
}

/**
 * Which way one plan leans between its two seven-day budgets.
 *
 * @internal — an element of what {@link planLeans} returns; the renderer reads these in order.
 */
export interface PlanLean {
  readonly alias: string;
  /** The plan-wide seven-day window's utilization, 0..1. Always present: a gauge without it is refused upstream. */
  readonly week: number;
  /** The Fable seven-day window's utilization, 0..1, absent when the gauge carried no Fable reading. */
  readonly fable?: number;
  /**
   * Fable utilization minus week utilization, absent when there is no Fable reading to subtract.
   *
   * NEGATIVE means the Fable week is behind the plan-wide week — the plan has Fable capacity that risks being
   * stranded if the plan-wide week dies first, so it is where the next Fable spawn belongs. POSITIVE means the
   * reverse, and strands nothing: the remaining plan-wide week is still spendable by every non-Fable model.
   * That asymmetry is measured — see `routeSpawn.ts` on why a Fable request against a plan-wide-rejected plan
   * is refused `429` — and it is why the two directions are not equally urgent.
   */
  readonly gap?: number;
}

/**
 * The window one spread is measured over, read off a gauge.
 *
 * @param gauge the plan's reading
 * @param window which of the two seven-day budgets to take
 * @returns the reading, or undefined when this gauge did not carry that window
 */
function windowOf({
  gauge,
  window,
}: {
  gauge: ClaudeAccountGauge;
  window: SpreadWindow;
}): ClaudeWindowReading | undefined {
  return window === "seven_day" ? gauge.sevenDay : gauge.sevenDayFable;
}

/**
 * Grade a measured gap against the owner's target.
 *
 * ## Why the comparison is on WHOLE PERCENTAGE POINTS
 *
 * The thresholds are tenths and the utilizations are IEEE doubles off a header, so a gap that is exactly ten
 * points arrives as `0.10000000000000003` and a raw `<=` grades it `drifting`. That is not a rounding
 * nicety: the renderer prints `10%` on the same line, so the raw comparison produces a verdict that
 * contradicts the number printed beside it, and the reader has no way to tell which is wrong. Grading the
 * same rounded value the reader sees makes the two agree by construction. Reproduce the underlying
 * arithmetic with `node -e 'console.log(0.2 + 0.1 - 0.2)'`.
 *
 * @param counted how many plans carried the window, since fewer than two cannot produce a gap at all
 * @param spread the gap between the most- and least-spent plan, when there is one
 * @param bands the install's balanced and drifting bands, off the register
 * @returns the verdict
 */
function gradeSpread({
  bands,
  counted,
  spread,
}: {
  bands: SpreadBands;
  counted: number;
  spread?: number;
}): SpreadVerdict {
  if (counted < 2 || spread === undefined) {
    return "unmeasurable";
  }
  const points = Math.round(spread * 100);
  if (points <= Math.round(bands.balancedSpread * 100)) {
    return "balanced";
  }
  if (points <= Math.round(bands.driftingSpread * 100)) {
    return "drifting";
  }
  return "out-of-band";
}

/**
 * How far apart the readable plans are in one window.
 *
 * @param gauges every plan's reading, in configured order — which breaks a tie between two equal ends
 * @param window which of the two seven-day budgets to measure
 * @param thresholds the install's balanced and drifting bands, off the plan register
 * @returns the spread, its ends, and how it grades
 */
export function fleetSpread({
  gauges,
  thresholds,
  window,
}: {
  gauges: readonly ClaudeAccountGauge[];
  thresholds: SpreadBands;
  window: SpreadWindow;
}): FleetSpread {
  const ends: readonly SpreadEnd[] = gauges.flatMap((gauge) => {
    const reading = windowOf({ gauge, window });
    return reading === undefined ? [] : [{ alias: gauge.alias, utilization: reading.utilization }];
  });
  const counted = ends.length;
  if (counted === 0) {
    return { counted, verdict: "unmeasurable", window };
  }
  const ranked = ends.toSorted((left, right) => left.utilization - right.utilization);
  const lowest = ranked[0]!;
  const highest = ranked[ranked.length - 1]!;
  const spread = counted < 2 ? undefined : highest.utilization - lowest.utilization;
  return {
    counted,
    highest,
    lowest,
    verdict: gradeSpread({ bands: thresholds, counted, ...(spread === undefined ? {} : { spread }) }),
    window,
    ...(spread === undefined ? {} : { spread }),
  };
}

/**
 * Which way each readable plan leans between its two seven-day budgets.
 *
 * @param gauges every plan's reading, in configured order — preserved, so a reader can match this to the table
 * @returns one lean per plan, in the order given
 */
export function planLeans({ gauges }: { gauges: readonly ClaudeAccountGauge[] }): readonly PlanLean[] {
  return gauges.map((gauge) => {
    const fable = gauge.sevenDayFable?.utilization;
    if (fable === undefined) {
      return { alias: gauge.alias, week: gauge.sevenDay.utilization };
    }
    return { alias: gauge.alias, fable, gap: fable - gauge.sevenDay.utilization, week: gauge.sevenDay.utilization };
  });
}

/**
 * One window's utilization as the whole-number percentage every other render in this feature prints.
 *
 * @param utilization the fraction spent, 0..1
 * @returns the percentage with its sign
 */
function percent({ utilization }: { utilization: number }): string {
  return `${String(Math.round(utilization * 100))}%`;
}

/**
 * The sentence one window's spread renders as.
 *
 * A fleet of ONE configured plan that read has no cross-plan spread to measure, and saying it is "unread" would be
 * false: it is the whole fleet, read. That case alone says NOT APPLICABLE; one reading out of several configured
 * is still the unread fleet it always was.
 *
 * @param spread the measured spread
 * @param configured how many unpaused plans are configured, which tells a whole one-plan fleet from a partial read
 * @returns the line to print
 */
function spreadLine({ spread, configured }: { spread: FleetSpread; configured: number }): string {
  const name = spread.window === "seven_day" ? "all-models week" : "fable week";
  if (spread.verdict === "unmeasurable" && configured === 1 && spread.counted === 1) {
    return `${name}: spread NOT APPLICABLE — one configured plan has no cross-plan spread`;
  }
  if (spread.verdict === "unmeasurable") {
    const why = spread.counted === 0 ? "no plan carried it" : "only one plan carried it";
    return `${name}: spread UNMEASURABLE — ${why}, so this is not a balanced fleet, it is an unread one`;
  }
  const low = spread.lowest!;
  const high = spread.highest!;
  const gap = percent({ utilization: spread.spread! });
  return `${name}: spread ${gap} across ${String(spread.counted)} plans — ${low.alias} ${percent({ utilization: low.utilization })} lowest, ${high.alias} ${percent({ utilization: high.utilization })} highest — ${spread.verdict.toUpperCase()}`;
}

/**
 * The sentence one plan's lean renders as.
 *
 * @param lean the plan's lean
 * @returns the line to print
 */
function leanLine({ lean }: { lean: PlanLean }): string {
  if (lean.gap === undefined) {
    return `  ${lean.alias}: week ${percent({ utilization: lean.week })}, fable unread`;
  }
  const direction = lean.gap < 0 ? "fable behind the week" : "week behind fable";
  const magnitude = percent({ utilization: Math.abs(lean.gap) });
  return `  ${lean.alias}: week ${percent({ utilization: lean.week })}, fable ${percent({ utilization: lean.fable! })} — ${magnitude} ${direction}`;
}

/**
 * The balance block a supervisor reads to decide what spawns next where.
 *
 * Deterministic by construction: it is a pure function of the readings, so the same gauges in produce the
 * same bytes out. That is the property that makes it safe to act on — a supervisor comparing two runs is
 * comparing the fleet, never the renderer.
 *
 * It renders aliases and percentages only, never an organisation or an email, because this text is pasted
 * into a sidebar row and kept.
 *
 * @param chairLevelWith every other plan level with the chair successor's route within one point of chair headroom, which
 *   the chair's cadence keeps a seated chair on
 * @param configured how many unpaused plans are configured — one is a whole fleet with no spread to measure
 * @param gauges every readable plan's reading, in configured order
 * @param nextAllModels the plan the router would send the next all-models spawn to, when one is eligible
 * @param nextChair the plan the router would seat the chair's successor on, ranked as a chair spawn, when one is eligible
 * @param nextFable the plan the router would send the next Fable spawn to, when one is eligible
 * @param thresholds the install's balanced and drifting bands, off the plan register
 * @returns the lines to print
 */
export function renderBalanceLines({
  chairLevelWith,
  configured,
  gauges,
  nextAllModels,
  nextChair,
  nextFable,
  thresholds,
}: {
  chairLevelWith?: readonly string[];
  configured: number;
  gauges: readonly ClaudeAccountGauge[];
  nextAllModels?: string;
  nextChair?: string;
  nextFable?: string;
  thresholds: SpreadBands;
}): readonly string[] {
  return [
    "balance",
    spreadLine({ configured, spread: fleetSpread({ gauges, thresholds, window: "seven_day" }) }),
    spreadLine({ configured, spread: fleetSpread({ gauges, thresholds, window: "seven_day_fable" }) }),
    "",
    "lean (negative = fable behind the week, which is the capacity that strands)",
    ...planLeans({ gauges }).map((lean) => leanLine({ lean })),
    "",
    `next all-models spawn -> ${allModelsTarget({ nextAllModels })}`,
    `next fable spawn      -> ${fableTarget({ nextFable })}`,
    `next chair successor  -> ${fableTarget({ nextFable: nextChair })}${levelSuffix({ chairLevelWith })}`,
  ];
}

/**
 * The plans level with the chair successor's route, said after it so a reader sees which seated chairs stay.
 *
 * @param chairLevelWith the level plans, absent when no chair route was eligible
 * @returns the suffix, empty when no plan is level with the route
 */
function levelSuffix({ chairLevelWith }: { chairLevelWith: readonly string[] | undefined }): string {
  if (chairLevelWith === undefined || chairLevelWith.length === 0) {
    return "";
  }
  return ` (level with ${chairLevelWith.join(", ")}, a chair seated there stays)`;
}

/**
 * Where the next all-models spawn would go, as the balance block names it.
 *
 * The router answers `no-plan` for an all-models spawn when every readable plan bars one, or when no gauge was
 * read at all, and that answer names no plan — so the block says no plan can take one rather than an empty arrow.
 */
function allModelsTarget({ nextAllModels }: { nextAllModels: string | undefined }): string {
  if (nextAllModels === undefined) {
    return "no plan can take one";
  }
  return nextAllModels;
}

/**
 * Where the next Fable spawn would go, as the balance block names it — an ordinary seat's, or the chair successor's.
 *
 * Routed on its own Fable class, a Fable spawn gets `no-plan` from the router when every readable plan bars that
 * class, or when no gauge was read at all; that answer names no plan, so the block says so rather than an
 * empty arrow. The chair's successor is a Fable spawn too, routed with the chair flag.
 */
function fableTarget({ nextFable }: { nextFable: string | undefined }): string {
  if (nextFable === undefined) {
    return "no plan can take one";
  }
  return nextFable;
}
