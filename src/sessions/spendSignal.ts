/**
 * Whether a token pass has anything to SHOW: a realised win or loss in units per landed change against the last
 * reading, or a priced drain that is new since the last post.
 *
 * ## Why a steady pass posts nothing
 *
 * The standing pass posts a finding only when it has a win to show,
 * never a status. So a pass whose trend is inside tolerance and whose drains were all posted before prints
 * its document and writes one reading, and the board hears nothing.
 *
 * ## Why a drain is posted once, then again only if it grows
 *
 * A drain that is a ruling waiting on the owner (a subagent default, a non-chair seat's model) persists week after week until
 * the owner rules. Reposting it weekly is the status the owner refused. So each reading carries the keys it has posted, and
 * a drain is posted again only once its share of the draw has grown by half since.
 *
 * Pure: two documents in, a verdict out.
 */
import { isRecord } from "#lib/parsers.js";
import { type Measured, measured, unmeasurable } from "../measurement/status.js";
import type { Drain } from "./spendDrains.js";
import type { SpendReport } from "./spendReport.js";

/** How far units per landed change must move, as a fraction, before the trend is a win or a drain. */
const DEFAULT_SPEND_TOLERANCE = 0.2;

/**
 * The share of the window's draw a drain must be worth before a pass posts it.
 *
 * Two percent: MEASURED, the gate refusals priced near 1% and the Fable chair's draw repriced onto Opus near 5%, so the
 * line separates a ruling worth the owner's attention from noise the gates already bound.
 */
const DEFAULT_MIN_DRAIN_SHARE = 0.02;

/** How much a posted drain's share must grow, as a multiple, before it is posted again. */
const REPOST_GROWTH = 1.5;

/** What the next pass needs from the last reading. */
export interface SpendBaseline {
  readonly observedAtIso: string;
  readonly unitsPerLanding: number | undefined;
  readonly drainShares: ReadonlyMap<string, number>;
  readonly posted: readonly string[];
}

/** The verdict one pass reached. */
export interface SpendSignal {
  readonly trend: "win" | "drain" | "steady" | "unmeasurable";
  readonly because: string;
  /** The drains this pass should post: worth the line, and new or grown since the last post. */
  readonly post: readonly Drain[];
  /** Keys an earlier pass posted that are still worth the line — posted already, whatever this pass does. */
  readonly carried: readonly string[];
}

/**
 * The keys a reading records as posted: the carried ones, plus this pass's own only if its finding was
 * actually registered — a pass run without `--finding`, or whose registration failed, posted nothing.
 *
 * @param signal the verdict
 * @param registered whether this pass's finding row was written
 * @returns the sorted keys
 */
export function postedKeys({ signal, registered }: { signal: SpendSignal; registered: boolean }): readonly string[] {
  const own = registered ? signal.post.map((drain) => drain.key) : [];
  return [...new Set([...signal.carried, ...own])].toSorted();
}

/** A number field of a record, or `undefined`. */
function numberField({ record, key }: { record: Record<string, unknown>; key: string }): number | undefined {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

/** The window's units per landed change, as a stored document carries it. */
function storedLandingCost({ document }: { document: Record<string, unknown> }): number | undefined {
  const cost = document["landingCost"];
  if (!isRecord(cost) || cost["known"] !== true || !isRecord(cost["value"])) {
    return undefined;
  }
  return numberField({ key: "unitsPerLanding", record: cost["value"] });
}

/**
 * Read the last recorded document back as a baseline.
 *
 * @param document the stored reading, already parsed
 * @returns the baseline, or why the document cannot be one
 */
export function baselineOf({ document }: { document: unknown }): Measured<SpendBaseline> {
  if (!isRecord(document)) {
    return unmeasurable({ why: "the stored reading is not a JSON object" });
  }
  const observedAtIso = document["observedAtIso"];
  const drains = document["drains"];
  const posted = document["posted"];
  if (typeof observedAtIso !== "string" || !Array.isArray(drains) || !Array.isArray(posted)) {
    return unmeasurable({ why: "the stored reading carries no observedAtIso, drains or posted keys" });
  }
  const drainShares = new Map<string, number>();
  for (const drain of drains) {
    if (isRecord(drain) && typeof drain["key"] === "string") {
      const share = numberField({ key: "share", record: drain });
      if (share !== undefined) {
        drainShares.set(drain["key"], share);
      }
    }
  }
  return measured({
    value: {
      drainShares,
      observedAtIso,
      posted: posted.filter((key): key is string => typeof key === "string"),
      unitsPerLanding: storedLandingCost({ document }),
    },
  });
}

/** The trend half: units per landed change against the baseline's. */
function trendOf({
  current,
  baseline,
  tolerance,
}: {
  current: SpendReport;
  baseline: SpendBaseline | undefined;
  tolerance: number;
}): Pick<SpendSignal, "trend" | "because"> {
  if (!current.landingCost.known) {
    return { because: current.landingCost.why, trend: "unmeasurable" };
  }
  if (baseline?.unitsPerLanding === undefined) {
    return {
      because: "no earlier reading carries units per landed change — this one is the baseline",
      trend: "unmeasurable",
    };
  }
  const now = current.landingCost.value.unitsPerLanding;
  const change = (now - baseline.unitsPerLanding) / baseline.unitsPerLanding;
  const moved = `${(100 * change).toFixed(1)}% against the reading of ${baseline.observedAtIso}`;
  if (change <= -tolerance) {
    return { because: `units per landed change fell ${moved}`, trend: "win" };
  }
  if (change >= tolerance) {
    return { because: `units per landed change rose ${moved}`, trend: "drain" };
  }
  return { because: `units per landed change moved ${moved}, inside ±${String(100 * tolerance)}%`, trend: "steady" };
}

/** Whether a drain worth the line is new, or has grown enough since it was last posted. */
function shouldPost({ drain, baseline }: { drain: Drain; baseline: SpendBaseline | undefined }): boolean {
  if (baseline === undefined || !baseline.posted.includes(drain.key)) {
    return true;
  }
  const before = baseline.drainShares.get(drain.key);
  return before === undefined || drain.share >= before * REPOST_GROWTH;
}

/**
 * Judge one pass against the last.
 *
 * @param current this pass's document
 * @param baseline the last reading's, or `undefined` on the first pass
 * @param minShare the share of the draw a drain must be worth to post
 * @param tolerance how far units per landed change must move to count
 * @returns the verdict
 */
export function spendVerdict({
  current,
  baseline,
  minShare = DEFAULT_MIN_DRAIN_SHARE,
  tolerance = DEFAULT_SPEND_TOLERANCE,
}: {
  current: SpendReport;
  baseline: SpendBaseline | undefined;
  minShare?: number;
  tolerance?: number;
}): SpendSignal {
  const worth = current.drains.filter((drain) => drain.share >= minShare);
  const post = worth.filter((drain) => shouldPost({ baseline, drain }));
  const carried = worth
    .filter((drain) => baseline?.posted.includes(drain.key) === true)
    .map((drain) => drain.key)
    .toSorted();
  return { ...trendOf({ baseline, current, tolerance }), carried, post };
}

/**
 * Whether a verdict is worth a board row — the one rule the standing pass posts by.
 *
 * @param signal the verdict
 * @returns true for a realised win or loss, or any drain to post
 */
export function hasSomethingToShow({ signal }: { signal: SpendSignal }): boolean {
  return signal.trend === "win" || signal.trend === "drain" || signal.post.length > 0;
}
