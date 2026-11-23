/**
 * The ring `slopweaver machine series` keeps, as pure rules over its samples: which samples stay inside the hour,
 * whether a new one is due, when the current load hold began, and the document the verb prints. One sample's own
 * shape and how it is built are `./series.ts`'s.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { cpuLoadHolding } from "./capacityHolds.js";
import type { MachineSeriesSample } from "./series.js";
import { type MachineSeriesError, MachineSeriesErrors } from "./seriesErrors.js";

/** How far back the ring keeps samples: the hour the page draws. */
const MACHINE_SERIES_WINDOW_MS = 60 * 60 * 1000;

/**
 * The least time between two samples. MEASURED at load 23.9 on 15 cores: one `top -l 2 -s 1 -stats
 * pid,cpu,mem` cost 2.21s wall and 1.09s of CPU (user 0.10, sys 0.99), so a twenty-second gap would spend 5.5% of
 * a core on watching alone, and thirty spends 3.6%. Repro: `/usr/bin/time -p top -l 2 -s 1 -stats pid,cpu,mem
 * >/dev/null`. The page still polls every twenty seconds; a poll inside the gap prints the ring without `top`.
 */
const MACHINE_SERIES_MINIMUM_GAP_MS = 30 * 1000;

/** The most samples the ring holds: an hour at the minimum gap, plus the one at its start. */
export const MACHINE_SERIES_MAX_SAMPLES = 121;

/**
 * How many minimum gaps two neighbouring samples may sit apart and still count as one measured stretch. The site's
 * `JOIN_GAPS` (`site/lib/machineSeries.ts`) draws its lines on the same bound, so a hold never spans a gap the chart
 * shows.
 */
const MACHINE_SERIES_JOIN_GAPS = 4;

/** Whether the load is over its hold now, and since when as far as the ring can see. */
export type CurrentLoadHold =
  | { readonly kind: "clear" }
  | { readonly kind: "since"; readonly startedAtIso: string }
  | { readonly kind: "after-gap"; readonly earliestHeldIso: string }
  | { readonly kind: "before-window"; readonly oldestObservedAtIso: string };

/** What the verb prints: the whole window, newest last, and the hold read off it. */
export interface MachineSeriesDocument {
  /** The newest sample's instant, which a page ages; never the instant the page fetched it. */
  readonly observedAtIso: string;
  readonly windowSeconds: number;
  readonly minimumSampleGapSeconds: number;
  readonly samples: readonly MachineSeriesSample[];
  readonly currentLoadHold: CurrentLoadHold;
}

/**
 * The samples the ring keeps: inside the window before `nowIso`, oldest first, then the newest
 * {@link MACHINE_SERIES_MAX_SAMPLES} of those. A sample dated after `nowIso` is a clock that stepped back, and is
 * dropped rather than drawn in the future.
 *
 * @param nowIso the instant the window ends at, the newest sample's own
 * @returns the kept samples
 */
export function retainMachineSeries({
  samples,
  nowIso,
}: {
  samples: readonly MachineSeriesSample[];
  nowIso: string;
}): readonly MachineSeriesSample[] {
  const nowMs = Date.parse(nowIso);
  return samples
    .filter((sample) => {
      const at = Date.parse(sample.observedAtIso);
      return at <= nowMs && nowMs - at <= MACHINE_SERIES_WINDOW_MS;
    })
    .toSorted((a, b) => Date.parse(a.observedAtIso) - Date.parse(b.observedAtIso))
    .slice(-MACHINE_SERIES_MAX_SAMPLES);
}

/**
 * Whether a sample's load holds — at or over its hold while `top` reads under the idle floor, the very predicate
 * `./capacity.ts` holds on (`./capacityHolds.ts`'s `cpuLoadHolding`). A sample with no idle is judged on load.
 *
 * @returns true when held
 */
function held({ sample }: { sample: MachineSeriesSample }): boolean {
  return cpuLoadHolding({ idlePct: sample.cpu.idlePct, load1: sample.load.load1, loadHold: sample.load.holdAt });
}

/**
 * When the current load hold began, read off the ring: walk back from the newest sample while it is held. The
 * first held sample after a clear one is the start, as close as the sampling cadence allows. A walk that meets an
 * unsampled gap first says only that the hold was seen from the sample after it, since the load may have cleared
 * inside the gap. A ring held throughout names only its oldest sample, never an earlier start.
 * The site's `loadHoldOf` mirrors this rule and its reader refuses a hold that disagrees with it.
 *
 * @param samples the ring, oldest first
 * @returns the hold
 */
export function currentLoadHoldOf({ samples }: { samples: readonly MachineSeriesSample[] }): CurrentLoadHold {
  const newest = samples.at(-1);
  if (newest === undefined || !held({ sample: newest })) {
    return { kind: "clear" };
  }
  const joinMs = MACHINE_SERIES_MINIMUM_GAP_MS * MACHINE_SERIES_JOIN_GAPS;
  for (let at = samples.length - 2; at >= 0; at -= 1) {
    const after = samples[at + 1]!;
    if (Date.parse(after.observedAtIso) - Date.parse(samples[at]!.observedAtIso) > joinMs) {
      return { earliestHeldIso: after.observedAtIso, kind: "after-gap" };
    }
    if (!held({ sample: samples[at]! })) {
      return { kind: "since", startedAtIso: after.observedAtIso };
    }
  }
  return { kind: "before-window", oldestObservedAtIso: samples[0]!.observedAtIso };
}

/**
 * The document the verb prints over a ring.
 *
 * @param samples the ring, oldest first, never empty: a verb that took no sample has nothing to print
 * @returns the document, or the error naming an empty ring
 */
export function machineSeriesDocument({
  samples,
}: {
  samples: readonly MachineSeriesSample[];
}): Result<MachineSeriesDocument, MachineSeriesError> {
  const newest = samples.at(-1);
  if (newest === undefined) {
    return err(MachineSeriesErrors.seriesEmpty());
  }
  return ok({
    currentLoadHold: currentLoadHoldOf({ samples }),
    minimumSampleGapSeconds: MACHINE_SERIES_MINIMUM_GAP_MS / 1000,
    observedAtIso: newest.observedAtIso,
    samples,
    windowSeconds: MACHINE_SERIES_WINDOW_MS / 1000,
  });
}

/**
 * Whether the ring's newest sample is recent enough that another `top` would only repeat it: within one gap of
 * now on EITHER side. A sample dated a little in the future is a wall clock that stepped back under it, and
 * resampling there would buy a second `top` inside the gap; one dated a whole gap or more ahead is
 * a ring from another clock, so this samples once and {@link retainMachineSeries} drops the future rows. A backward
 * step of a gap or more therefore costs one extra `top`, and no more, since the instants are wall-clock and no
 * monotonic clock survives between two runs of the verb.
 *
 * @param nowIso the instant the verb runs at
 * @returns true when no new sample is due
 */
export function sampleFresh({ samples, nowIso }: { samples: readonly MachineSeriesSample[]; nowIso: string }): boolean {
  const newest = samples.at(-1);
  if (newest === undefined) {
    return false;
  }
  const age = Date.parse(nowIso) - Date.parse(newest.observedAtIso);
  return Math.abs(age) < MACHINE_SERIES_MINIMUM_GAP_MS;
}
