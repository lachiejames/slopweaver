/**
 * The pure half of `slopweaver dev heap-curve`: the flag spec, the per-phase arithmetic, and the rendering.
 *
 * What the verb measures is post-GC LIVE heap on both sides of a whole-corpus load — never peak RSS. Peak RSS
 * varies by hundreds of MB between identical runs because V8 lets garbage accumulate when the ceiling is
 * high; the live heap after a forced collection is deterministic to about a MiB and is the number that
 * decides whether a process dies at a given ceiling. The shell forces the collection; this file turns the
 * readings into a curve a reader can act on, and into a verdict on the guard's coefficients.
 */
import { type CorpusProjection, HEAP_BYTES_PER_DISK_BYTE } from "../../../corpus/corpusRowCore.js";
import { toMib } from "../../../lib/heapBudget.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";

export const DEV_HEAP_CURVE_USAGE =
  "usage: slopweaver dev heap-curve [--corpus <dir>] [--projection bronze|retrieval|derive] [--home <dir>] [--json]\n" +
  "  Measure what a whole-corpus pass HOLDS: post-GC live heap before and after the load, against the\n" +
  "  corpus's size on disk. Prints the load's cost, the ratio the heap guard projects with, and whether\n" +
  "  the shipped coefficient band still brackets it.\n" +
  "  --projection bronze (default) keeps `raw`, what `compact` and `distil` load; retrieval drops it;\n" +
  "               derive drops `text` and all but four `raw` scalars, what `slopweaver derive` loads.\n" +
  "  Runs at this process's own ceiling: a corpus that would not fit refuses exactly as a real pass would, and a\n" +
  "  larger one is measured with NODE_OPTIONS=--max-old-space-size=<MiB>.";

const FLAGS: FlagSpec = { boolean: ["json"], string: ["home", "corpus", "projection"] };

const PROJECTIONS: readonly CorpusProjection[] = ["retrieval", "bronze", "derive"];

/**
 * The projection a `--projection` value names, or the errors when it names none.
 *
 * @param value the flag's raw value (`undefined` when absent)
 * @returns the projection, defaulting to `retrieval`
 */
export function parseProjection({ value }: { value: string | undefined }): Result<CorpusProjection> {
  if (value === undefined) {
    return ok("bronze");
  }
  const match = PROJECTIONS.find((candidate) => candidate === value);
  return match === undefined ? err([`--projection must be one of ${PROJECTIONS.join("|")}, got ${value}`]) : ok(match);
}

/** `--`-prefixed, for the help-truth ratchet. */
export const DEV_HEAP_CURVE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: FLAGS }),
  ...booleanFlagsOf({ spec: FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `dev heap-curve` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv tail after the verb
 * @returns the parsed flags, or the parse errors
 */
export function parseDevHeapCurveArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: FLAGS });
}

/** One phase of the load, with the heap read AFTER it settled. */
export interface HeapPhase {
  readonly phase: "start" | "records";
  readonly liveBytes: number;
  readonly externalBytes: number;
  readonly elapsedMs: number;
}

/** Everything the measurement produced, before any arithmetic. */
export interface HeapCurveSample {
  readonly corpusDir: string;
  readonly projection: CorpusProjection;
  readonly diskBytes: number;
  readonly fileCount: number;
  readonly recordCount: number;
  readonly limitBytes: number;
  readonly phases: readonly HeapPhase[];
}

/** The derived curve: per-phase deltas and the ratios the guard's coefficients are checked against. */
export interface HeapCurve {
  readonly sample: HeapCurveSample;
  /** Live bytes the records retained per byte of bronze on disk (the `retrieval` projection). */
  readonly recordsPerDiskByte: number;
  /** The final live heap as a fraction of the ceiling. */
  readonly peakFractionOfLimit: number;
  /** Whether the shipped band brackets what was measured. */
  readonly coefficients: {
    readonly records: {
      readonly floor: number;
      readonly ceiling: number;
      readonly measured: number;
      readonly covers: boolean;
    };
  };
}

/** The phase of that name, or `undefined` when that phase did not run. */
function phaseNamed({
  phases,
  phase,
}: {
  phases: readonly HeapPhase[];
  phase: HeapPhase["phase"];
}): HeapPhase | undefined {
  return phases.find((candidate) => candidate.phase === phase);
}

/**
 * The live heap a phase settled at — or, when that phase did not run, `before`, the reading it would have
 * moved, so a phase that never ran contributes no delta rather than a fabricated one.
 */
function liveOrUnchanged({ ran, before }: { ran: HeapPhase | undefined; before: number }): number {
  if (ran === undefined) {
    return before;
  }
  return ran.liveBytes;
}

/**
 * Derive the curve from a sample. Pure.
 *
 * A ratio whose denominator is
 * zero (an empty corpus) reads as zero rather than `Infinity`, so an empty fixture still renders. A NEGATIVE
 * delta — a phase that settled below the one before it, which a collection of something unrelated can
 * produce on a fixture smaller than the process's own allocation noise — clamps to zero: it is not a
 * measurement of the phase, and a negative "bytes per character" would be reported as a coefficient that
 * covers everything.
 *
 * @param sample the measured phases and the corpus they were measured over
 * @returns the per-phase ratios and the verdict on the shipped coefficients
 */
export function deriveHeapCurve({ sample }: { sample: HeapCurveSample }): HeapCurve {
  const start = liveOrUnchanged({ before: 0, ran: phaseNamed({ phase: "start", phases: sample.phases }) });
  const records = liveOrUnchanged({ before: start, ran: phaseNamed({ phase: "records", phases: sample.phases }) });
  const last = liveOrUnchanged({ before: start, ran: sample.phases.at(-1) });
  const recordsPerDiskByte = sample.diskBytes > 0 ? Math.max(0, records - start) / sample.diskBytes : 0;
  const band = HEAP_BYTES_PER_DISK_BYTE[sample.projection];
  return {
    coefficients: {
      records: {
        ceiling: band.ceiling,
        covers: band.floor <= recordsPerDiskByte && recordsPerDiskByte <= band.ceiling,
        floor: band.floor,
        measured: recordsPerDiskByte,
      },
    },
    peakFractionOfLimit: sample.limitBytes > 0 ? last / sample.limitBytes : 0,
    recordsPerDiskByte,
    sample,
  };
}

/**
 * Render the curve as the lines the verb prints. Pure.
 *
 * @param curve the derived curve
 * @returns one line per phase, then the ratios, then the coefficient verdicts
 */
export function renderHeapCurve({ curve }: { curve: HeapCurve }): readonly string[] {
  const { sample } = curve;
  const mib = ({ bytes }: { bytes: number }): string => String(toMib({ bytes }));
  const lines: string[] = [
    `corpus: ${sample.corpusDir} — ${String(sample.fileCount)} file(s), ${mib({ bytes: sample.diskBytes })} MiB on disk, ` +
      `${String(sample.recordCount)} record(s), ` +
      `${sample.projection} projection`,
    `ceiling: ${mib({ bytes: sample.limitBytes })} MiB (this process's --max-old-space-size, or V8's default)`,
    "phase      live MiB   +delta   external MiB   at",
  ];
  let previous = liveOrUnchanged({ before: 0, ran: sample.phases[0] });
  for (const phase of sample.phases) {
    lines.push(
      `${phase.phase.padEnd(10)} ${mib({ bytes: phase.liveBytes }).padStart(8)} ${`+${mib({ bytes: phase.liveBytes - previous })}`.padStart(8)} ` +
        `${mib({ bytes: phase.externalBytes }).padStart(14)}   ${(phase.elapsedMs / 1000).toFixed(1)}s`,
    );
    previous = phase.liveBytes;
  }
  const pct = ({ fraction }: { fraction: number }): string => `${(fraction * 100).toFixed(0)}%`;
  lines.push(
    `peak live heap is ${pct({ fraction: curve.peakFractionOfLimit })} of the ceiling`,
    `records: ${curve.recordsPerDiskByte.toFixed(2)} live bytes per disk byte — shipped band ` +
      `${curve.coefficients.records.floor.toFixed(2)}…${curve.coefficients.records.ceiling.toFixed(2)} ` +
      `${curve.coefficients.records.covers ? "brackets it" : `DOES NOT BRACKET IT: move HEAP_BYTES_PER_DISK_BYTE.${sample.projection}`}`,
  );
  return lines;
}

/**
 * Whether the shipped coefficients cover what was measured — the verb's exit code turns on this, so a curve
 * that has moved past the guard fails loudly rather than printing a table nobody reads.
 *
 * @param curve the derived curve
 * @returns `true` when both coefficients are at or above the measured ratios
 */
export function coefficientsCover({ curve }: { curve: HeapCurve }): boolean {
  return curve.coefficients.records.covers;
}
