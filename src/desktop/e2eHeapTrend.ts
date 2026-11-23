/**
 * Whether the voice window's JavaScript heap grew without bound while `desktop e2e --call` held a call. Pure.
 *
 * The leak this guards against is NATIVE (ICU and PartitionAlloc growth from building an `Intl.DateTimeFormat` per row,
 * `site/lib/dateTimeFormat.ts`), which V8's heap does not measure — so surviving the hold over the owner's real earlier-call
 * history is the regression witness, and this is a second, bounded signal for the class V8 does see.
 *
 * A garbage-collected heap saw-tooths, so a single sample says nothing. The judge takes the LOWEST sample in each
 * complete window after a warm-up, and fails only when every window's minimum rises on the last AND the whole rise is
 * past the bound: a heap that climbs and is collected back is the normal shape, never a leak.
 */

/** One reading of the heap, from the start of the hold. */
export interface E2eHeapSample {
  readonly elapsedMs: number;
  readonly usedBytes: number;
}

/** How the samples are judged. */
export interface E2eHeapPolicy {
  /** The start of the hold left out, while the call's own setup settles. */
  readonly warmupMs: number;
  readonly windowMs: number;
  /** The rise across the window minima past which a monotonic rise is a leak. */
  readonly maxGrowthBytes: number;
  /** Fewer complete windows than this is too little to judge, and fails as such. */
  readonly minimumWindows: number;
}

/** The judgement: the minima it read and their rise, and why it failed when it did. */
export type E2eHeapVerdict =
  | { readonly passed: true; readonly growthBytes: number; readonly minima: readonly number[] }
  | {
      readonly passed: false;
      readonly kind: "insufficient-samples" | "monotonic-growth";
      readonly detail: string;
      readonly growthBytes: number;
      readonly minima: readonly number[];
    };

/**
 * PROVISIONAL, not yet calibrated: 32 MiB. The bound is the largest rise
 * three clean five-minute holds show, plus headroom; until those runs are recorded this named floor stands rather
 * than an unexplained number. Re-measure: `slopweaver desktop e2e --call --only call-holds --call-hold-minutes 5`
 * three times and read `steps[].call.heapVerdict.growthBytes` in each `report.json`.
 */
export const HEAP_GROWTH_BOUND_BYTES = 32 * 1024 * 1024;

/** One window's length. */
const WINDOW_MS = 60_000;

/**
 * The policy for a hold: a minute's warm-up and two windows for a hold of three minutes or more; a shorter hold has
 * no warm-up and one window, which judges survival and reads no trend.
 *
 * @param holdMs the hold's length
 * @returns the policy
 */
export function heapPolicyFor({ holdMs }: { holdMs: number }): E2eHeapPolicy {
  if (holdMs >= 3 * WINDOW_MS) {
    return { maxGrowthBytes: HEAP_GROWTH_BOUND_BYTES, minimumWindows: 2, warmupMs: WINDOW_MS, windowMs: WINDOW_MS };
  }
  return { maxGrowthBytes: HEAP_GROWTH_BOUND_BYTES, minimumWindows: 1, warmupMs: 0, windowMs: WINDOW_MS };
}

/**
 * The lowest sample in each complete window after the warm-up. A window is complete once a later sample shows time
 * passed its end; one with no sample in it is skipped, never read as zero.
 *
 * @param samples the readings, in any order
 * @param policy the warm-up and window length
 * @returns each complete window's minimum, in time order
 */
function windowMinima({
  samples,
  policy,
}: {
  samples: readonly E2eHeapSample[];
  policy: E2eHeapPolicy;
}): readonly number[] {
  const after = samples.filter((sample) => sample.elapsedMs >= policy.warmupMs);
  const last = Math.max(...after.map((sample) => sample.elapsedMs));
  const minima: number[] = [];
  for (let start = policy.warmupMs; start + policy.windowMs <= last; start += policy.windowMs) {
    const inside = after.filter((sample) => sample.elapsedMs >= start && sample.elapsedMs < start + policy.windowMs);
    if (inside.length > 0) {
      minima.push(Math.min(...inside.map((sample) => sample.usedBytes)));
    }
  }
  return minima;
}

/**
 * Judge a hold's heap.
 *
 * @param samples every reading taken
 * @param policy how they are judged
 * @returns passed with the minima and their rise, or the failure and its evidence
 */
export function judgeHeapTrend({
  samples,
  policy,
}: {
  samples: readonly E2eHeapSample[];
  policy: E2eHeapPolicy;
}): E2eHeapVerdict {
  const minima = windowMinima({ policy, samples });
  const growthBytes = minima.length === 0 ? 0 : minima.at(-1)! - minima[0]!;
  if (minima.length < policy.minimumWindows) {
    return {
      detail: `${String(minima.length)} complete window(s) of heap samples; ${String(policy.minimumWindows)} needed`,
      growthBytes,
      kind: "insufficient-samples",
      minima,
      passed: false,
    };
  }
  const rising = minima.length > 1 && minima.every((value, index) => index === 0 || value > minima[index - 1]!);
  if (rising && growthBytes > policy.maxGrowthBytes) {
    const mib = (growthBytes / 1024 / 1024).toFixed(1);
    const bound = (policy.maxGrowthBytes / 1024 / 1024).toFixed(1);
    return {
      detail: `the heap's window minima rose every window, ${mib} MiB in all, past the ${bound} MiB bound`,
      growthBytes,
      kind: "monotonic-growth",
      minima,
      passed: false,
    };
  }
  return { growthBytes, minima, passed: true };
}
