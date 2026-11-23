/**
 * Heap budgeting: refuse a load that would not fit, BEFORE V8 kills the process for it.
 *
 * ## Why this exists
 *
 * The whole-corpus reader died on the owner's own corpus with `FATAL ERROR: Ineffective mark-compacts near heap
 * limit` — a 46-frame native stack trace, no typed error, nothing naming the fix. Measured
 * against 684,422 records (2,038 MiB of bronze on disk): the live heap after loading the records and building
 * the per-query BM25 index was **4,215 MiB**, on a machine whose default ceiling is 4,288 MB. The run that
 * died was not short of memory for its live set; it was short of the working space V8's collector needs
 * ABOVE the live set. That is why the check here keeps a reserve rather than comparing to the raw ceiling.
 *
 * A V8 fatal is the one failure this repo's error handling cannot dress, so it has to be converted into a
 * refusal at the last point where the process is still in control: before the allocation that would cross
 * the line. The pure core ({@link assessHeapBudget}) decides; the thin edges ({@link readHeap},
 * {@link collectGarbage}, {@link guardHeap}) read the real isolate.
 *
 * ## What the numbers mean
 *
 * `used_heap_size` includes garbage, so a projection against it can refuse a load that a collection would
 * have made room for. {@link guardHeap} handles that honestly: when the projection does not fit, it forces a
 * full collection and asks once more, and only a projection that still does not fit after the collection is a
 * refusal. The collection is only ever triggered on that path, so a comfortably-sized load never pays for it.
 *
 * **With one limit, learned the hard way.** That second look is a claim about a heap with room to work in.
 * When `used` alone is within a hair of the RAW ceiling there is nothing to collect INTO, and the
 * collection becomes the last allocation before the fatal — see {@link canCollectInto}, which is the check
 * that decides, and the measurement that put it there.
 *
 * The reserve is a BAND, not a threshold. The same binary both passed and failed at the same ceiling when
 * its live set sat within a few percent of it, because survival then depends on collector timing. 15% is
 * chosen from the measured failure (4,215 of 4,288 MB died; 4,215 of 6,144 MB — 69% — answered) as the
 * lowest reserve with a run on the safe side of it.
 *
 * **The load's reserve and the collector's are two different bands, and conflating them is what made this
 * guard's advice unreachable.** {@link HEAP_RESERVE_FRACTION} is how much of the ceiling the pending LOAD
 * must leave free; {@link COLLECT_RESERVE_FRACTION} is how tight the heap may get before a collection stops
 * being worth attempting. Using the first for both meant the guard refused to collect at exactly the
 * pressure where a collection had the most garbage to find, so every refusal past 85% of the ceiling
 * reported a DIRTY `used_heap_size` — and every number derived from it, the suggested ceiling included, was
 * derived from garbage. See {@link canCollectInto} for the two measurements that bracket the second band.
 */
import { getHeapStatistics, setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

/** The fraction of the ceiling the pending LOAD must leave free for the collector to work in. */
export const HEAP_RESERVE_FRACTION = 0.15;

/**
 * The fraction of the ceiling below which a collection is still worth attempting. Deliberately much smaller
 * than {@link HEAP_RESERVE_FRACTION} — see {@link canCollectInto} for the two measurements it sits between.
 */
export const COLLECT_RESERVE_FRACTION = 0.05;

const MIB = 1024 * 1024;

/**
 * A reading of the isolate's heap: what is used (garbage included), the ceiling it may grow to, and what
 * sits OUTSIDE the heap — typed-array and `Buffer` backing stores, which the ceiling does not govern but
 * the machine still pays for.
 */
export interface HeapReading {
  readonly usedBytes: number;
  readonly limitBytes: number;
  readonly externalBytes: number;
}

/** A load that fits under the ceiling with the reserve intact. */
interface HeapFits {
  readonly fits: true;
  /** Bytes left under the reserved ceiling once the projected load lands. */
  readonly headroomBytes: number;
}

/** A load that would cross the reserved ceiling — what was used, what was asked, what is missing. */
export interface HeapShortfall {
  readonly fits: false;
  readonly usedBytes: number;
  readonly limitBytes: number;
  readonly projectedBytes: number;
  /** How far past the reserved ceiling the load would land. */
  readonly shortfallBytes: number;
  /** The `--max-old-space-size` value (MiB) that would hold the projected load with the reserve intact. */
  readonly suggestedLimitMib: number;
  /**
   * Whether `usedBytes` is a post-collection LIVE reading. `false` means it still counts garbage, so every
   * number derived from it is an over-estimate — which a message that quotes it must not claim otherwise.
   */
  readonly collected: boolean;
}

export type HeapVerdict = HeapFits | HeapShortfall;

/**
 * Decide whether a projected allocation fits under the ceiling with the reserve intact. Pure.
 *
 * @param reading the isolate's current used bytes and ceiling
 * @param projectedBytes the bytes the pending load is expected to RETAIN on the heap
 * @param reserveFraction the fraction of the ceiling kept free for the collector
 * @returns `fits` with the headroom left, or the shortfall with a suggested ceiling that would hold it
 */
export function assessHeapBudget({
  reading,
  projectedBytes,
  reserveFraction = HEAP_RESERVE_FRACTION,
}: {
  reading: HeapReading;
  projectedBytes: number;
  reserveFraction?: number;
}): HeapVerdict {
  const usable = reading.limitBytes * (1 - reserveFraction);
  const landing = reading.usedBytes + Math.max(0, projectedBytes);
  if (landing <= usable) {
    return { fits: true, headroomBytes: usable - landing };
  }
  // Round the suggestion UP to the next 512 MiB so it reads as a setting, not a measurement.
  const suggestedLimitMib = Math.ceil(landing / (1 - reserveFraction) / MIB / 512) * 512;
  return {
    // Pure: this function never collects, so it can only ever report the reading it was handed.
    collected: false,
    fits: false,
    limitBytes: reading.limitBytes,
    projectedBytes,
    shortfallBytes: landing - usable,
    suggestedLimitMib,
    usedBytes: reading.usedBytes,
  };
}

/**
 * Whether a collection can safely be attempted at this reading — i.e. whether the heap still has the
 * collector's own working space free. Pure.
 *
 * Once `used` ALONE is within a hair of the raw ceiling there is nothing left to collect into, and a full
 * collection attempted there is not a recovery, it is the last allocation before the fatal. Measured
 * on the real corpus: the whole-corpus reader at the default ceiling died with
 * `FATAL ERROR: Ineffective mark-compacts near heap limit`, and native frame 10 of that trace is
 * `v8::internal::GCExtension::GC` — the process died INSIDE {@link collectGarbage}, called from
 * {@link guardHeap}'s own failing path. The guard whose whole purpose is to turn an out-of-memory kill into
 * a typed refusal was the thing doing the killing.
 *
 * **It used to share {@link HEAP_RESERVE_FRACTION}, and that is the defect this parameter exists to fix.**
 * The load's reserve is 15%, so a collection was refused from 85% of the ceiling upwards — the exact band
 * where the heap is fullest of garbage and a collection is worth the most. Two measurements on the owner's
 * own 7,821 MiB corpus bracket the band this needs instead:
 *
 * - `slopweaver derive` at `--max-old-space-size=6656`: refused with 5,823 MiB used of a
 *   6,848 MiB ceiling — **85.0%** — after reading 1,323 MiB of disk, which no coefficient in
 *   `HEAP_BYTES_PER_DISK_BYTE` can retain (the ceiling coefficient would make it 2,646 MiB). Most of that
 *   reading was garbage, and it must be collectable. Reproduce:
 *   `NODE_OPTIONS=--max-old-space-size=6656 slopweaver derive`.
 * - The whole-corpus reader: **4,215 MiB live of a 4,288 MB ceiling — 98.3%** — is the reading that
 *   died inside the collector. It must stay refused.
 *
 * 5% sits between them with room on both sides, and it is a band rather than a threshold for the same
 * reason the load's reserve is: survival within a few percent of the ceiling depends on collector timing.
 *
 * @param reading the isolate's current used bytes and ceiling
 * @param reserveFraction how tight the heap may get before a collection stops being worth attempting
 * @returns whether a collection may be attempted
 */
export function canCollectInto({
  reading,
  reserveFraction = COLLECT_RESERVE_FRACTION,
}: {
  reading: HeapReading;
  reserveFraction?: number;
}): boolean {
  return reading.usedBytes < reading.limitBytes * (1 - reserveFraction);
}

/**
 * Bytes as whole MiB, for messages. Pure.
 *
 * @param bytes the byte count
 * @returns the count in MiB, rounded to the nearest whole number
 */
export function toMib({ bytes }: { bytes: number }): number {
  return Math.round(bytes / MIB);
}

/**
 * Read the isolate's heap: used bytes (garbage included) and the ceiling it may grow to. The ceiling is what
 * `--max-old-space-size` sets, or V8's machine-derived default when nothing set it.
 *
 * @returns the current reading
 */
export function readHeap(): HeapReading {
  const stats = getHeapStatistics();
  return { externalBytes: stats.external_memory, limitBytes: stats.heap_size_limit, usedBytes: stats.used_heap_size };
}

/**
 * Force a full garbage collection, whether or not the process was started with `--expose-gc`.
 *
 * Without the flag `globalThis.gc` is absent (the `@types/node` declaration is a runtime lie), so this turns
 * the flag on from inside the process and reads the binding out of a fresh context, which is the documented
 * way to reach it after startup. Used only on the path that is about to refuse — a load that fits never
 * pays for a collection.
 *
 * @returns `true` when a collection ran, `false` when no binding could be reached
 */
export function collectGarbage(): boolean {
  const collector = resolveCollector();
  if (collector === undefined) {
    return false;
  }
  collector();
  return true;
}

/**
 * The `gc` binding, resolved ONCE and remembered.
 *
 * `runInNewContext` builds a whole new V8 context, which is itself an allocation — and this is only ever
 * reached when the heap is already tight enough for a guard to be refusing. Rebuilding a context per check,
 * once per read chunk near the ceiling, was adding allocation pressure on precisely the path that exists to
 * relieve it. The binding does not change over a process's life, so resolving it once is both cheaper and
 * the only version that is safe to call when memory is short.
 *
 * Deliberately NOT unit-tested, and worth saying why rather than leaving a gap someone fills badly: the
 * memo has no observable behaviour without a spy, which this repo bans. `runInNewContext("gc")` does not
 * populate `globalThis.gc` (measured — it stays `undefined` before and after), so an identity assertion
 * against it passes whether or not the memo exists, and a test that cannot fail is worse than none. What IS
 * behavioural here is {@link canCollectInto}, and that is covered.
 */
function resolveCollector(): (() => void) | undefined {
  if (RESOLVED.collector !== undefined) {
    return RESOLVED.collector;
  }
  const existing: unknown = (globalThis as { gc?: unknown }).gc;
  if (isCollector(existing)) {
    RESOLVED.collector = existing;
    return existing;
  }
  setFlagsFromString("--expose-gc");
  const fromContext: unknown = runInNewContext("gc");
  if (!isCollector(fromContext)) {
    return undefined;
  }
  RESOLVED.collector = fromContext;
  return fromContext;
}

/** The memo for {@link resolveCollector} — one binding per process, never re-derived. */
const RESOLVED: { collector?: () => void } = {};

/** Type guard for the `gc` binding. Positional — TS1230 forbids destructuring in a type predicate. */
function isCollector(value: unknown): value is () => void {
  return typeof value === "function";
}

/**
 * Guard a pending allocation against the real isolate: project it, and if it does not fit, collect garbage
 * once and project again. Only a load that still does not fit after the collection is refused.
 *
 * A refusal that comes back from here therefore carries `collected: true` whenever a collection was safe to
 * run — which is what makes the numbers in it, and the ceiling derived from them, a claim about the LIVE
 * set rather than about garbage. The only shortfall that still reports `collected: false` is one taken so
 * close to the raw ceiling that {@link canCollectInto} refused to collect at all.
 *
 * @param projectedBytes the bytes the pending load is expected to retain on the heap
 * @param reserveFraction the fraction of the ceiling the load must leave free for the collector
 * @returns the verdict against the post-collection reading when a collection was needed, else the first
 */
export function guardHeap({
  projectedBytes,
  reserveFraction = HEAP_RESERVE_FRACTION,
}: {
  projectedBytes: number;
  reserveFraction?: number;
}): HeapVerdict {
  const reading = readHeap();
  const first = assessHeapBudget({ projectedBytes, reading, reserveFraction });
  if (first.fits) {
    return first;
  }
  // REFUSE rather than collect when there is no room to collect into. The second look exists because
  // `used_heap_size` counts garbage, so a collection can make room a projection said was not there — but
  // that is a claim about a heap with space to work in. Within a hair of the RAW ceiling the collection is
  // the last allocation before the fatal, and this guard exists to prevent exactly that. See
  // {@link canCollectInto} for the two measurements that bracket the band.
  if (!canCollectInto({ reading })) {
    return first;
  }
  collectGarbage();
  const second = assessHeapBudget({ projectedBytes, reading: readHeap(), reserveFraction });
  return second.fits ? second : { ...second, collected: true };
}

/** The shape of a guard the corpus reader accepts — {@link guardHeap} in production, a plain fake in tests. */
export type HeapGuard = (args: { projectedBytes: number }) => HeapVerdict;

/**
 * A guard that always fits — for callers that have no ceiling to respect (tests, tiny fixtures).
 *
 * @param projectedBytes the bytes the pending load is expected to retain on the heap
 * @returns a verdict that fits, with the headroom left under the largest safe integer
 */
export const unguardedHeap: HeapGuard = ({ projectedBytes }) => ({
  fits: true,
  headroomBytes: Number.MAX_SAFE_INTEGER - projectedBytes,
});
