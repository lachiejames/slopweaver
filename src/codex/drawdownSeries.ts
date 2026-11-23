/**
 * The Codex burn detector's per-series arithmetic: gauge readings become samples, samples become series, each
 * series yields non-overlapping slopes, and the slopes pool into a duration-weighted baseline.
 *
 * `./drawdownAnomaly.ts` holds the types, the policy and the verdict this feeds, and its header says why each
 * step is shaped the way it is. Pure.
 */

import { parseIsoMs } from "#lib/date.js";
import type {
  CodexDrawdownBaseline,
  CodexDrawdownPolicy,
  CodexDrawdownRate,
  CodexDrawdownSample,
} from "./drawdownAnomaly.js";
import type { CodexGauge } from "./gauge.js";

/**
 * A reading's instant as a sortable number, with an undatable one pinned to the epoch.
 *
 * A reading nobody can date has no position, and the sort has to give it one anyway. Pinned to the start
 * rather than substituted silently, because everything downstream refuses to pair with it: an undatable
 * anchor forms no slope (`ratesWithin`) and contributes to no baseline (`withinLookback`). Its position is
 * therefore stable and inert, which is what this needs and is not the same claim as "it happened first".
 *
 * @param iso the reading's observed instant
 * @returns the epoch milliseconds, or 0 when it will not parse
 */
function sortableMs({ iso }: { iso: string }): number {
  const at = parseIsoMs({ tsIso: iso });
  if (at === undefined) {
    return 0;
  }
  return at;
}

/**
 * A provider field that the event may not have carried.
 *
 * @param value the field as the event reported it
 * @returns the value, or the literal `unknown` that stands as its own series identity
 */
function namedOr({ value }: { value: string | undefined }): string {
  if (value === undefined) {
    return "unknown";
  }
  return value;
}

/** Milliseconds in an hour, for the rate arithmetic. */
export const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * How far apart two reset instants can be and still be the SAME window.
 *
 * MEASURED, and the reason this tolerance exists at all. Codex's `resets_at` is an absolute
 * epoch the provider computes per event, and it drifts by a second between two events about the same
 * window: a replay over 26.1 hours of real history produced six weekly "series" that were really three,
 * paired as `…08:25:25` / `…08:25:26`, `…20:53:37` / `…20:53:38`, `…04:07:01` / `…04:07:02`. Splitting them
 * is not cosmetic — one twin held 62 intervals and the other held 1, and a series with one interval never
 * reaches `minimumBaselineIntervals`, so every reading that landed on the wrong side of the jitter was
 * unusable. With clustering the same replay reports three series at 62, 57 and 70 intervals. Reproduce with
 * the replay in {@link ./drawdownAnomaly.DEFAULT_CODEX_DRAWDOWN_POLICY}.
 *
 * Five minutes is generous against a second of observed jitter and far short of any real reset: the
 * narrowest window Codex reports here is five HOURS, so a genuinely new reset is orders of magnitude
 * further away than this.
 */
const RESET_JITTER_MS = 5 * 60 * 1000;

/**
 * A series' identity, with reset instants clustered so provider jitter cannot split one window in two.
 *
 * Deliberately NOT keyed on the slot. `src/codex/gauge.ts` records which slot a reading came from so a
 * reading can be traced back to its line; Codex moves the weekly window between slots, so keying a series on
 * the slot splices one window's history onto another's the first time they swap.
 *
 * The clustering is SINGLE-LINKAGE over the sorted reset instants within one account/limit/width group, not
 * a fixed grid. A grid has a boundary, and two readings a second apart that straddle it round to different
 * buckets — which is the same defect this fixes, moved somewhere harder to see. Each reset within
 * {@link RESET_JITTER_MS} of its run's ANCHOR collapses onto that anchor — bounding a cluster's total width,
 * so a long slow drift eventually starts a new series rather than absorbing without limit.
 *
 * @param samples every reading, from every series
 * @returns a map from source event id to that reading's canonical series identity
 */
function seriesKeysFor({ samples }: { samples: readonly CodexDrawdownSample[] }): ReadonlyMap<string, string> {
  const groups = new Map<string, CodexDrawdownSample[]>();
  for (const sample of samples) {
    const groupKey = [sample.accountScope, sample.limitId, String(sample.windowMinutes)].join("~");
    const existing = groups.get(groupKey);
    if (existing === undefined) {
      groups.set(groupKey, [sample]);
      continue;
    }
    existing.push(sample);
  }
  const keys = new Map<string, string>();
  for (const [groupKey, group] of groups) {
    const canonical = clusterResets({ group });
    for (const sample of group) {
      // `clusterResets` walked this same group's distinct resets, so every one of them has an entry. An
      // honest assertion rather than a fallback to the raw reset, which would silently undo the clustering
      // for exactly the readings it was written to collapse.
      keys.set(sample.sourceEventId, `${groupKey}~${canonical.get(sample.resetAtIso)!}`);
    }
  }
  return keys;
}

/**
 * Collapse one group's reset instants onto the earliest of each jitter run.
 *
 * @param group one account/limit/width group's readings
 * @returns a map from each observed reset instant to its canonical one
 */
function clusterResets({ group }: { group: readonly CodexDrawdownSample[] }): ReadonlyMap<string, string> {
  const distinct = [...new Set(group.map((sample) => sample.resetAtIso))].toSorted(
    (left, right) => sortableMs({ iso: left }) - sortableMs({ iso: right }),
  );
  const canonical = new Map<string, string>();
  let anchor: string | undefined;
  let anchorMs = 0;
  for (const reset of distinct) {
    const at = parseIsoMs({ tsIso: reset });
    if (at === undefined) {
      // A reset nobody can date anchors nothing and joins nothing — it stands alone rather than being
      // silently folded into whichever run happened to be open.
      canonical.set(reset, reset);
      continue;
    }
    if (anchor === undefined || at - anchorMs > RESET_JITTER_MS) {
      anchor = reset;
      anchorMs = at;
    }
    canonical.set(reset, anchor);
  }
  return canonical;
}

/**
 * Turn a batch of gauge readings into samples, dropping every window that cannot carry a slope.
 *
 * Three kinds of window are dropped rather than zeroed, each for its own reason:
 *
 *  - **no declared width** — a reading of `used_percent: 100` with no `window_minutes` is a real refusal
 *    (`gauge.ts` says why the width is optional), but it cannot be matched to a series, because the width is
 *    half of what identifies one;
 *  - **no reset instant** — without it a reset cannot be detected, so the next reading's drop to 0 would
 *    read as a large negative delta rather than as a new window;
 *  - **an exhaustion event's nulled slots** — those carry no windows at all, so nothing here sees them.
 *
 * Credits are not sampled: every credits reading this machine has written carries `balance: null`, and a
 * balance with no number and no unit cannot produce a burn rate.
 *
 * @param gauges the readings, in any order
 * @returns one sample per usable window, deduplicated by content and ordered by observed instant
 */
export function codexDrawdownSamples({ gauges }: { gauges: readonly CodexGauge[] }): readonly CodexDrawdownSample[] {
  const byId = new Map<string, CodexDrawdownSample>();
  for (const gauge of gauges) {
    for (const window of gauge.windows) {
      const sample = sampleOf({ gauge, window });
      if (sample === undefined) {
        continue;
      }
      // First writer wins, which is the same answer as last writer: the id is a content hash of every field
      // the sample carries, so two entries under one id are byte-identical.
      if (!byId.has(sample.sourceEventId)) {
        byId.set(sample.sourceEventId, sample);
      }
    }
  }
  return orderSamples({ samples: [...byId.values()] });
}

/**
 * One gauge window as a sample, or nothing when it cannot carry a slope.
 *
 * @param gauge the reading it came from
 * @param window the window slot
 * @returns the sample, or undefined
 */
function sampleOf({
  gauge,
  window,
}: {
  gauge: CodexGauge;
  window: CodexGauge["windows"][number];
}): CodexDrawdownSample | undefined {
  if (window.windowMinutes === undefined || window.resetAtIso === undefined) {
    return undefined;
  }
  if (!Number.isFinite(window.usedPercent)) {
    return undefined;
  }
  // Codex has written events with no plan type and no limit id. Both become the literal string "unknown",
  // which is a series identity in its own right rather than a stand-in for one: readings from an event that
  // named neither are a different series from readings that did, and folding them together would splice two
  // accounts' histories on the strength of a missing field.
  const accountScope = namedOr({ value: gauge.planType });
  const limitId = namedOr({ value: gauge.limitId });
  return {
    accountScope,
    kind: "sample",
    limitId,
    observedAtIso: gauge.observedAtIso,
    resetAtIso: window.resetAtIso,
    schemaVersion: 1,
    sourceEventId: [gauge.observedAtIso, limitId, window.slot, String(window.usedPercent)].join("~"),
    usedPercent: window.usedPercent,
    windowMinutes: window.windowMinutes,
  };
}

/**
 * Order samples by observed instant, breaking a tie deterministically without inventing elapsed time.
 *
 * Two readings at the same instant stay at the same instant: the tie-break only fixes their POSITION, so the
 * interval between them is zero and the minimum-duration rule then refuses it. Nudging one of them forward
 * to make the pair usable is the manufactured-elapsed-time the plan refuses, and it would invent a slope out
 * of an arbitrary ordering.
 *
 * @param samples the samples, in any order
 * @returns them in a stable order
 */
export function orderSamples({ samples }: { samples: readonly CodexDrawdownSample[] }): readonly CodexDrawdownSample[] {
  return samples.toSorted((left, right) => {
    const byInstant = sortableMs({ iso: left.observedAtIso }) - sortableMs({ iso: right.observedAtIso });
    if (byInstant !== 0) {
      return byInstant;
    }
    return left.sourceEventId.localeCompare(right.sourceEventId);
  });
}

/**
 * Every eligible slope, over NON-OVERLAPPING intervals within each series.
 *
 * Non-overlapping is the load-bearing word, and it is what stops dense sampling outvoting sparse. Within one
 * series the walk takes a reading, finds the next one at least `minimumIntervalMs` later, emits that pair,
 * and then RESTARTS from that second reading. Pairing every adjacent reading instead would emit four
 * intervals for five readings inside one busy minute and one interval for the quiet hour beside it.
 *
 * A pair is refused — ending the run and restarting from the later reading — when the reset instant changed
 * (a new window, not a drop), when usage went DOWN (a reset nobody announced, or a different account), or
 * when the gap exceeds `maximumIntervalMs` (two readings either side of a quiet night are not one episode).
 *
 * @param samples the readings, in any order
 * @param policy the tuning
 * @returns one rate per eligible interval, in series then time order
 */
export function codexDrawdownRates({
  samples,
  policy,
}: {
  samples: readonly CodexDrawdownSample[];
  policy: CodexDrawdownPolicy;
}): readonly CodexDrawdownRate[] {
  const rates: CodexDrawdownRate[] = [];
  for (const [seriesId, series] of groupBySeries({ samples })) {
    rates.push(...ratesWithin({ policy, series, seriesId }));
  }
  return rates;
}

/**
 * Group samples by series, each group in observed order.
 *
 * @param samples the readings
 * @returns a map from series identity to its ordered readings
 */
function groupBySeries({
  samples,
}: {
  samples: readonly CodexDrawdownSample[];
}): ReadonlyMap<string, readonly CodexDrawdownSample[]> {
  // The keys are clustered over the WHOLE batch, not per sample: one reading's series identity depends on
  // which other resets it sits near, which is what makes provider jitter collapse instead of splitting.
  const keys = seriesKeysFor({ samples });
  const grouped = new Map<string, CodexDrawdownSample[]>();
  for (const sample of orderSamples({ samples })) {
    // Built from this same list a line above, so every reading has a key.
    const id = keys.get(sample.sourceEventId)!;
    const existing = grouped.get(id);
    if (existing === undefined) {
      grouped.set(id, [sample]);
      continue;
    }
    existing.push(sample);
  }
  return grouped;
}

/**
 * One series' non-overlapping eligible slopes.
 *
 * @param policy the tuning
 * @param series one series' readings, in observed order
 * @param seriesId the identity to stamp each rate with
 * @returns its rates
 */
function ratesWithin({
  policy,
  series,
  seriesId,
}: {
  policy: CodexDrawdownPolicy;
  series: readonly CodexDrawdownSample[];
  seriesId: string;
}): readonly CodexDrawdownRate[] {
  const rates: CodexDrawdownRate[] = [];
  let anchorIndex = 0;
  for (let index = 1; index < series.length; index++) {
    const anchor = series[anchorIndex]!;
    const candidate = series[index]!;
    const from = parseIsoMs({ tsIso: anchor.observedAtIso });
    const to = parseIsoMs({ tsIso: candidate.observedAtIso });
    if (from === undefined || to === undefined) {
      // A reading nobody can date cannot anchor a slope, and it cannot end one either — it is skipped, and
      // the anchor stays where it was so the next datable reading can still pair with it.
      continue;
    }
    const elapsedMs = to - from;
    if (elapsedMs < policy.minimumIntervalMs) {
      continue;
    }
    if (elapsedMs > policy.maximumIntervalMs || candidate.usedPercent < anchor.usedPercent) {
      // Either the gap is too long to be one episode, or usage fell — an unannounced reset or a different
      // account. Both END the run: the candidate becomes the next anchor rather than producing a slope.
      anchorIndex = index;
      continue;
    }
    rates.push({
      accountScope: anchor.accountScope,
      elapsedMs,
      fromIso: anchor.observedAtIso,
      limitId: anchor.limitId,
      percentPointsPerHour: ((candidate.usedPercent - anchor.usedPercent) * MS_PER_HOUR) / elapsedMs,
      resetAtIso: anchor.resetAtIso,
      seriesId,
      toIso: candidate.observedAtIso,
      usedPercentDelta: candidate.usedPercent - anchor.usedPercent,
      windowMinutes: anchor.windowMinutes,
    });
    anchorIndex = index;
  }
  return rates;
}

/**
 * The duration-weighted baseline for each series in the history.
 *
 * @param history the readings the baseline pools from
 * @param nowIso the instant staleness and lookback are measured against
 * @param policy the tuning
 * @returns one baseline per series that produced at least one eligible interval
 */
export function baselinesOf({
  history,
  nowIso,
  policy,
}: {
  history: readonly CodexDrawdownSample[];
  nowIso: string;
  policy: CodexDrawdownPolicy;
}): readonly CodexDrawdownBaseline[] {
  const now = parseIsoMs({ tsIso: nowIso });
  const fresh = now === undefined ? history : history.filter((sample) => withinLookback({ now, policy, sample }));
  const rates = codexDrawdownRates({ policy, samples: fresh });
  const bySeries = new Map<string, CodexDrawdownRate[]>();
  for (const rate of rates) {
    const existing = bySeries.get(rate.seriesId);
    if (existing === undefined) {
      bySeries.set(rate.seriesId, [rate]);
      continue;
    }
    existing.push(rate);
  }
  return [...bySeries.entries()].map(([seriesId, group]) => baselineOf({ group, history: fresh, seriesId }));
}

/** Whether a reading is inside the baseline's lookback and not stale. */
function withinLookback({
  now,
  policy,
  sample,
}: {
  now: number;
  policy: CodexDrawdownPolicy;
  sample: CodexDrawdownSample;
}): boolean {
  const at = parseIsoMs({ tsIso: sample.observedAtIso });
  if (at === undefined) {
    return false;
  }
  const age = now - at;
  return age >= 0 && age <= Math.min(policy.baselineLookbackMs, policy.stalenessMs);
}

/**
 * One series' baseline, weighted by how much TIME each interval covered.
 *
 * @param group that series' eligible intervals
 * @param history every fresh reading, for the observed span
 * @param seriesId the identity
 * @returns the baseline
 */
function baselineOf({
  group,
  history,
  seriesId,
}: {
  group: readonly CodexDrawdownRate[];
  history: readonly CodexDrawdownSample[];
  seriesId: string;
}): CodexDrawdownBaseline {
  const coveredMs = group.reduce((total, rate) => total + rate.elapsedMs, 0);
  const points = group.reduce((total, rate) => total + rate.usedPercentDelta, 0);
  const keys = seriesKeysFor({ samples: history });
  const inSeries = history.filter((sample) => keys.get(sample.sourceEventId) === seriesId);
  return {
    coveredMs,
    intervals: group.length,
    observedSpanMs: spanOf({ samples: inSeries }),
    percentPointsPerHour: coveredMs === 0 ? undefined : (points * MS_PER_HOUR) / coveredMs,
    seriesId,
    // A baseline only exists because `group` held at least one rate, so the first entry is there.
    windowMinutes: group[0]!.windowMinutes,
  };
}

/**
 * The span from the earliest to the latest datable reading, or zero when fewer than two can be dated.
 *
 * @returns the span in milliseconds, or 0 when fewer than two readings can be dated
 */
export function spanOf({ samples }: { samples: readonly CodexDrawdownSample[] }): number {
  const instants = samples
    .map((sample) => parseIsoMs({ tsIso: sample.observedAtIso }))
    .filter((value): value is number => value !== undefined)
    .toSorted((left, right) => left - right);
  const first = instants[0];
  const last = instants[instants.length - 1];
  if (first === undefined || last === undefined) {
    return 0;
  }
  return last - first;
}
