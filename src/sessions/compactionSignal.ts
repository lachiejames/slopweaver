/**
 * The signal — whether compaction is costing more answer quality, or every call carrying more context, than
 * it was last time anybody looked.
 *
 * ## Three classes, one verdict
 *
 * The dropped-re-read rate is the quality class. The other two are the CONTEXT classes the weekly
 * `context-cost-weekly` row watches (`../live/automation/standingMeasurementRows.ts`): the floor every session boots with,
 * and the cache read an average call pays. Either growing is a cost every later call repeats, and neither
 * is visible on any one seat. The verdict is `regressed` when ANY class moved past its tolerance, and its
 * sentence names every class that did. A baseline recorded before the context classes existed carries no
 * figure for them, and those two are then skipped rather than failed — the re-read class still judges.
 *
 * ## What it compares, and why it is a comparison at all
 *
 * There is no absolute rate at which compaction is "bad": a re-read rate of 20% may be fine for a fleet
 * whose sessions read few files and terrible for one that reads many. What IS meaningful is a rate that
 * MOVED. So the verdict is taken against the last recorded reading of the same verb in the readings ledger
 * (`../readings/store.ts`) — the shape `github landing --record-reading` already uses — rather than against
 * a constant somebody would have to keep true.
 *
 * ## It refuses to say "fine" in two situations, and that is the point
 *
 * `unmeasurable` rather than `holding` when there is no baseline, and when either side holds too few
 * boundaries to take a rate over. A comforting "holding" off three boundaries is exactly the failure
 * `./tokenDepth.ts` refuses when it declines to report a zero depth: a gauge whose job is to say "this
 * hurt" must never answer quietly when it cannot tell.
 *
 * ## It is a measurement, not a refusal
 *
 * Nothing here blocks anything, so there is no `EscapeHatch` row and no four-line refusal — `escape-hatch`
 * governs a gate saying no to something that would otherwise have worked. And it is deliberately not a
 * monitor: `../monitor/registry.ts` requires every card to name an action only the OWNER can take, and
 * moving the window is a `~/.claude/settings.json` key change the owner has already blessed a session making. The
 * number that change answers to is the drift one: 53% of the targeted tool calls after a boundary re-read
 * something the session had already read (seven days, `docs/hooks/session-guards.md` § The auto-compact window).
 *
 * Pure: two reports in, a verdict out.
 */
import { isRecord } from "../lib/parsers.js";
import { type Measured, measured, unmeasurable } from "../measurement/status.js";
import type { CompactionReport } from "./compactionReport.js";

/** What the signal says. Three answers, because "could not tell" is not "fine". */
type CompactionVerdict = "holding" | "regressed" | "unmeasurable";

/**
 * How many boundaries a window must hold before its re-read rate means anything.
 *
 * A policy number rather than a measurement, and the shape of the corpus is what sets it: at the 967k
 * default the whole fleet produced SIX boundaries in seven days (measured), so a rate taken
 * over a handful of them is noise wearing a percentage sign. At the shipped 300k window the same fleet
 * produced 377 real ones across 746 transcripts — measured, `slopweaver session compaction
 * --days 7` — which clears this bar inside a day. So the signal becomes measurable exactly when compaction
 * becomes frequent enough to be worth watching.
 */
export const MIN_BOUNDARIES_TO_JUDGE = 20;

/**
 * How far the dropped-re-read rate may rise over the baseline before the signal fires.
 *
 * Five percentage points, and a policy number rather than a measurement — there is no second reading to
 * calibrate against yet, and inventing a tolerance from one observation would be a number dressed as
 * evidence. Revisit it once two readings exist; `--tolerance` overrides it per call.
 */
export const DROPPED_RE_READ_TOLERANCE = 0.05;

/**
 * How far the boot floor may grow, RELATIVE to the baseline, before the signal fires.
 *
 * Ten percent — about 6k tokens at the 60k floor measured, which is one always-on rule file or
 * a skill-listing rewrite. The floor is steady: its p10–p90 over that week's 629 transcripts was 52k–63k.
 */
export const FLOOR_GROWTH_TOLERANCE = 0.1;

/**
 * How far the mean call's cache read may grow, RELATIVE to the baseline, before the signal fires.
 *
 * Twenty percent, because this figure moves with the work mix. MEASURED: 213k per call over the first week in the
 * ledger against 186k over a later week, after the window moved
 * to 300k — 13% on a known setting change. A tolerance inside that would fire on an ordinary week.
 */
export const PER_CALL_GROWTH_TOLERANCE = 0.2;

/** The verdict, and what it was reached on. */
export interface CompactionSignal {
  readonly verdict: CompactionVerdict;
  /** One sentence naming the comparison, for the renderer and the exit-code decision. */
  readonly because: string;
}

/**
 * The three fields the signal reads off an earlier reading.
 *
 * A narrow shape rather than a whole {@link CompactionReport}, because the readings ledger hands a document
 * back as `unknown` and validating the whole report to compare two numbers would mint a second, drifting
 * copy of its schema. {@link baselineOf} is the only thing that turns a stored document into one of these.
 */
export interface CompactionBaseline {
  readonly observedAtIso: string;
  readonly boundaryCount: number;
  readonly droppedReReadRate: number;
  /** Absent on a reading taken before the context classes existed. */
  readonly floorMedianTokens?: number;
  /** Absent on a reading taken before the context classes existed. */
  readonly cacheReadPerCall?: number;
}

/** A finite number at `record[name]`, or `undefined` — the stored document is `unknown` until proven. */
function numberAt({ record, name }: { record: Record<string, unknown>; name: string }): number | undefined {
  const value = record[name];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

/**
 * Read a stored reading's document back as a baseline, or say why it is not one.
 *
 * A document whose shape has drifted answers `unmeasurable` rather than a zero: a zeroed baseline would
 * make every later rate look like a regression, which is the loudest possible way to be wrong.
 *
 * @param document the reading's document, exactly as the ledger parsed it
 * @returns the three fields the verdict needs, or the reason they are not there
 */
export function baselineOf({ document }: { document: unknown }): Measured<CompactionBaseline> {
  if (!isRecord(document)) {
    return unmeasurable({ why: "the stored reading is not a JSON object" });
  }
  const boundaries = document["boundaries"];
  const quality = document["quality"];
  if (!isRecord(boundaries) || !isRecord(quality)) {
    return unmeasurable({ why: "the stored reading carries no boundaries/quality sections — its shape has drifted" });
  }
  const boundaryCount = numberAt({ name: "count", record: boundaries });
  const droppedReReadRate = numberAt({ name: "droppedReReadRate", record: quality });
  if (boundaryCount === undefined || droppedReReadRate === undefined) {
    return unmeasurable({ why: "the stored reading carries no boundary count or dropped-re-read rate" });
  }
  const observedAtIso = document["observedAtIso"];
  const context = document["context"];
  const floorMedianTokens = isRecord(context) ? numberAt({ name: "floorMedianTokens", record: context }) : undefined;
  const cacheReadPerCall = isRecord(context) ? numberAt({ name: "cacheReadPerCall", record: context }) : undefined;
  return measured({
    value: {
      boundaryCount,
      ...(cacheReadPerCall === undefined ? {} : { cacheReadPerCall }),
      droppedReReadRate,
      ...(floorMedianTokens === undefined ? {} : { floorMedianTokens }),
      observedAtIso: typeof observedAtIso === "string" ? observedAtIso : "an unnamed instant",
    },
  });
}

/**
 * Compare this window's quality figure against the last recorded reading.
 *
 * @param current this pass's report
 * @param baseline what the last reading carried, or `undefined` when the ledger holds none
 * @param tolerance how far the rate may rise before the signal fires
 * @returns the verdict and the sentence behind it
 */
export function compactionVerdict({
  current,
  baseline,
  tolerance = DROPPED_RE_READ_TOLERANCE,
}: {
  current: CompactionReport;
  baseline: CompactionBaseline | undefined;
  tolerance?: number;
}): CompactionSignal {
  if (baseline === undefined) {
    return {
      because: "no earlier reading of this verb is in the readings ledger, so there is nothing to compare against",
      verdict: "unmeasurable",
    };
  }
  const context = [
    ...growthClass({
      after: current.context.floorMedianTokens,
      before: baseline.floorMedianTokens,
      label: "boot floor (median first-call context)",
      tolerance: FLOOR_GROWTH_TOLERANCE,
    }),
    ...growthClass({
      after: current.context.cacheReadPerCall,
      before: baseline.cacheReadPerCall,
      label: "cache read per call",
      tolerance: PER_CALL_GROWTH_TOLERANCE,
    }),
  ];
  // The boundary gates bound the RE-READ class only: a rate needs boundaries, a boot floor does not. A window
  // that moved so far that compaction became rare must still fail on a grown floor.
  const gate = reReadGate({ baseline, current });
  if (gate !== undefined) {
    const grown = context.filter((entry) => entry.regressed);
    if (grown.length > 0) {
      return { because: grown.map((entry) => entry.line).join("; "), verdict: "regressed" };
    }
    return { because: gate, verdict: "unmeasurable" };
  }
  const rise = current.quality.droppedReReadRate - baseline.droppedReReadRate;
  const moved = `${percent({ value: baseline.droppedReReadRate })} → ${percent({ value: current.quality.droppedReReadRate })} of post-boundary reads fetched something the summary had dropped, against ${baseline.observedAtIso}`;
  const reReadRegressed = rise > tolerance;
  const classes = [
    {
      line: reReadRegressed
        ? `${moved} — a rise of ${percent({ value: rise })}, past the ${percent({ value: tolerance })} tolerance`
        : moved,
      regressed: reReadRegressed,
    },
    ...context,
  ];
  const regressed = classes.filter((entry) => entry.regressed);
  if (regressed.length > 0) {
    return { because: regressed.map((entry) => entry.line).join("; "), verdict: "regressed" };
  }
  return { because: classes.map((entry) => entry.line).join("; "), verdict: "holding" };
}

/**
 * Why the re-read rate cannot be judged on this pair, or `undefined` when it can.
 *
 * @param current this window's report
 * @param baseline the last recorded reading
 * @returns the sentence naming the side that holds too few boundaries, or undefined
 */
function reReadGate({
  current,
  baseline,
}: {
  current: CompactionReport;
  baseline: CompactionBaseline;
}): string | undefined {
  if (current.boundaries.count < MIN_BOUNDARIES_TO_JUDGE) {
    return `${String(current.boundaries.count)} boundaries in this window, under the ${String(MIN_BOUNDARIES_TO_JUDGE)} a rate needs to mean anything`;
  }
  if (baseline.boundaryCount < MIN_BOUNDARIES_TO_JUDGE) {
    return `the baseline reading of ${baseline.observedAtIso} holds ${String(baseline.boundaryCount)} boundaries, under the ${String(MIN_BOUNDARIES_TO_JUDGE)} a rate needs`;
  }
  return undefined;
}

/**
 * One relative-growth class, or nothing when the baseline predates it.
 *
 * @param before the baseline's figure, absent on a reading older than the class
 * @param after this window's figure
 * @param label what the figure is, as a reader names it
 * @param tolerance the relative growth past which the class regresses
 * @returns zero or one judged class
 */
function growthClass({
  before,
  after,
  label,
  tolerance,
}: {
  before: number | undefined;
  after: number;
  label: string;
  tolerance: number;
}): readonly { readonly line: string; readonly regressed: boolean }[] {
  if (before === undefined || before <= 0) {
    return [];
  }
  const growth = (after - before) / before;
  const moved = `${label} ${String(before)} → ${String(after)} tokens`;
  if (growth > tolerance) {
    return [
      {
        line: `${moved} — a growth of ${percent({ value: growth })}, past the ${percent({ value: tolerance })} tolerance`,
        regressed: true,
      },
    ];
  }
  return [{ line: moved, regressed: false }];
}

/**
 * A rate as a percentage, to one decimal place.
 *
 * @param value the rate, between 0 and 1
 * @returns the percentage, e.g. `53.3%`
 */
export function percent({ value }: { value: number }): string {
  return `${(value * 100).toFixed(1)}%`;
}
