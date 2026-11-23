/**
 * The perf baseline: what a subject cost last time it was recorded, and whether this run regressed.
 *
 * **Only the HEAP half is a gate.** Post-GC live heap is deterministic to about a MiB and is the number that
 * decides whether a process dies under a ceiling — the property `src/cli/commands/dev/heapCurveCore.ts`
 * already measures on the corpus, and the one the whole `NODE_OPTIONS` workstream is about. Wall time on a
 * shared runner is not a measurement: it moves with whatever else the machine was doing, so it is recorded
 * and reported and never fails a run. A perf gate that goes red because a runner was busy gets muted within
 * a week, and then the heap half is muted with it.
 *
 * The band exists for the same reason the heap budget's does. Measured on the `named-object-params` gate,
 * three consecutive runs of the identical command have reported figures 7 MiB apart — that is GC timing, not
 * a regression, and a band narrower than the instrument's own noise reports noise. Reproduce:
 * `SLOPWEAVER_HEAP_PHASES=1 yarn tsx --expose-gc --max-old-space-size=8192 src/devLint/namedObjectParams.entry.ts`
 */
import { z } from "zod";

/** The widest a heap reading may drift above its baseline before it is a regression, as a fraction. */
const HEAP_DRIFT_FRACTION = 0.02;

/**
 * The floor under that band, in MiB, so a small subject is not gated on its own GC noise.
 *
 * 16 MiB, against the 7 MiB spread three identical runs of the heaviest gate in this repo have shown.
 */
export const HEAP_DRIFT_FLOOR_MIB = 16;

/** How far wall time may drift before the report NOTES it. Advisory — it never fails a run. */
const WALL_DRIFT_FRACTION = 0.25;

/** One module's share of a recorded run, kept so a regression says where the cost moved. */
const moduleShareSchema = z.object({ module: z.string(), share: z.number() });

/** One subject's recorded cost. */
const recordSchema = z.object({
  label: z.string(),
  peakHeapMib: z.number().nullable(),
  phases: z.array(z.object({ label: z.string(), liveMib: z.number().nullable() })),
  recordedAt: z.string(),
  topModules: z.array(moduleShareSchema),
  wallMs: z.number(),
});

/** The whole baseline document, keyed by subject label. */
export const perfBaselineSchema = z.object({ subjects: z.array(recordSchema) });

/** One subject's recorded cost. */
export type PerfRecord = z.infer<typeof recordSchema>;

/** The whole baseline document. */
export type PerfBaseline = z.infer<typeof perfBaselineSchema>;

/** How this run compares to what was recorded. */
export interface PerfComparison {
  readonly label: string;
  /** What the baseline held, or `undefined` when this subject has never been recorded. */
  readonly baseline: PerfRecord | undefined;
  readonly heap: {
    readonly baselineMib: number | undefined;
    readonly measuredMib: number | undefined;
    readonly allowedMib: number | undefined;
    /** True only when both readings exist and the measured one is past the band. */
    readonly regressed: boolean;
  };
  readonly wall: {
    readonly baselineMs: number;
    readonly measuredMs: number;
    /** True when wall time drifted past the advisory band. Never a failure — see the file header. */
    readonly drifted: boolean;
  };
}

/**
 * The most a heap reading may be and still count as unchanged.
 *
 * @param baselineMib what the baseline recorded
 * @returns the ceiling this run's peak is judged against
 */
export function heapAllowance({ baselineMib }: { baselineMib: number }): number {
  return Math.max(baselineMib * (1 + HEAP_DRIFT_FRACTION), baselineMib + HEAP_DRIFT_FLOOR_MIB);
}

/** A stored `null` is a reading the recorded run never took, which is `undefined` everywhere it is used. */
function measuredOrAbsent({ stored }: { stored: number | null }): number | undefined {
  if (stored === null) {
    return undefined;
  }
  return stored;
}

/**
 * Compare one run against the baseline. Pure.
 *
 * An unrecorded subject, or one whose heap could not be read at either end, is NOT a regression: the
 * comparison says it had nothing to compare, and `--record` is the act that fixes that. Reporting a missing
 * baseline as a failure would make the first run of every new subject red, which teaches a reader to pass
 * whatever flag makes it green.
 *
 * @param label the subject's label, as {@link ./subject.resolveSubject} minted it
 * @param baseline the whole recorded document
 * @param peakHeapMib this run's highest measured phase, `undefined` when no phase was measurable
 * @param wallMs this run's elapsed time
 * @returns what changed, and whether the heap half regressed
 */
export function comparePerf({
  label,
  baseline,
  peakHeapMib,
  wallMs,
}: {
  label: string;
  baseline: PerfBaseline;
  peakHeapMib: number | undefined;
  wallMs: number;
}): PerfComparison {
  const recorded = baseline.subjects.find((subject) => subject.label === label);
  if (recorded === undefined) {
    return {
      baseline: undefined,
      heap: { allowedMib: undefined, baselineMib: undefined, measuredMib: peakHeapMib, regressed: false },
      label,
      wall: { baselineMs: 0, drifted: false, measuredMs: wallMs },
    };
  }
  const baselineMib = measuredOrAbsent({ stored: recorded.peakHeapMib });
  const comparable = baselineMib !== undefined && peakHeapMib !== undefined;
  const allowedMib = baselineMib === undefined ? undefined : heapAllowance({ baselineMib });
  const regressed = comparable && allowedMib !== undefined && peakHeapMib > allowedMib;
  const wallBand = recorded.wallMs * WALL_DRIFT_FRACTION;
  return {
    baseline: recorded,
    heap: { allowedMib, baselineMib, measuredMib: peakHeapMib, regressed },
    label,
    wall: {
      baselineMs: recorded.wallMs,
      drifted: Math.abs(wallMs - recorded.wallMs) > wallBand,
      measuredMs: wallMs,
    },
  };
}

/**
 * The baseline with one subject's record replaced, subjects kept sorted so a diff reads.
 *
 * @param baseline the document as read
 * @param record the run to record
 * @returns the document to write
 */
export function withRecord({ baseline, record }: { baseline: PerfBaseline; record: PerfRecord }): PerfBaseline {
  const others = baseline.subjects.filter((subject) => subject.label !== record.label);
  return { subjects: [...others, record].toSorted((a, b) => a.label.localeCompare(b.label)) };
}
