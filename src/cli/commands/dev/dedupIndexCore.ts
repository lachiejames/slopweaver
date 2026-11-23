/**
 * The pure half of `slopweaver dev dedup-index`: the flag spec, the per-record arithmetic, and the
 * rendering.
 *
 * What the verb measures is the post-GC LIVE heap the bronze writer's dedup index retains — never peak RSS.
 * Peak RSS varies by hundreds of MB between identical runs because V8 lets garbage accumulate when the
 * ceiling is high; the live heap after a forced collection is deterministic to about a MiB and is the number
 * that decides whether a refresh can index its own corpus. The shell forces the collection; this file turns
 * the reading into a per-record cost and a verdict on the shipped constant.
 */
import { DEDUP_INDEX_BYTES_PER_RECORD } from "../../../corpus/bronzeDedupIndex.js";
import { type CorpusSource } from "../../../corpus/types.js";
import { BRONZE_SOURCES } from "../../../integrations/corpusSources.js";
import { toMib } from "../../../lib/heapBudget.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";

export const DEV_DEDUP_INDEX_USAGE =
  "usage: slopweaver dev dedup-index --source <github|slack|linear|notion|gmail|self> [--home <dir>] [--json]\n" +
  "  Measure what the bronze writer's dedup index HOLDS: post-GC live heap after streaming every stored row\n" +
  "  of one source, divided by the rows it absorbed. Prints the per-record cost, the constant the writer's\n" +
  "  heap guard projects with, and whether that constant still covers the measurement.\n" +
  "  Runs at this process's own ceiling, so a source it cannot index refuses exactly as a refresh would,\n" +
  "  and a larger one is measured with NODE_OPTIONS=--max-old-space-size=<MiB>.";

const FLAGS: FlagSpec = { boolean: ["json"], string: ["home", "source"] };

/** `--`-prefixed, for the help-truth ratchet. */
export const DEV_DEDUP_INDEX_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: FLAGS }),
  ...booleanFlagsOf({ spec: FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `dev dedup-index` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the argv tail after the verb
 * @returns the parsed flags, or the parse errors
 */
export function parseDevDedupIndexArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: FLAGS });
}

/**
 * The bronze source a `--source` value names.
 *
 * Required rather than defaulted: the whole point of this measurement is that the per-record cost should be
 * the SAME for every source, so silently picking one would hide the one result that would falsify the
 * constant.
 *
 * @param value the flag's raw value (`undefined` when absent)
 * @returns the source, or the errors when the value names none
 */
export function parseDedupSource({ value }: { value: string | undefined }): Result<CorpusSource> {
  if (value === undefined) {
    return err([`--source is required (one of ${BRONZE_SOURCES.join("|")})`]);
  }
  const match = BRONZE_SOURCES.find((candidate) => candidate === value);
  return match === undefined ? err([`--source must be one of ${BRONZE_SOURCES.join("|")}, got ${value}`]) : ok(match);
}

/** Everything the measurement produced, before any arithmetic. */
export interface DedupIndexSample {
  readonly source: CorpusSource;
  readonly fileCount: number;
  readonly diskBytes: number;
  readonly rows: number;
  /** Distinct `sourceId`s the index keyed — the `newestTs` map's size. */
  readonly ids: number;
  /** Live heap before the build, after a forced collection. */
  readonly startBytes: number;
  /** Live heap with the index still held, after a forced collection. */
  readonly heldBytes: number;
  readonly limitBytes: number;
  readonly elapsedMs: number;
  /** The paths the build could not read — a measurement over a partial source is not one. */
  readonly unreadable: readonly string[];
  /** True when the heap guard stopped the build, so the source was not fully indexed. */
  readonly refused: boolean;
}

/**
 * The derived cost, and whether the shipped constant still covers it.
 *
 * @internal — {@link deriveDedupIndexCost} returns it and the renderer + verdict read it; the verb passes it
 * between them without naming the shape.
 */
export interface DedupIndexCost {
  readonly sample: DedupIndexSample;
  /** Live bytes the index retained per row absorbed. */
  readonly bytesPerRecord: number;
  /** Live bytes the index retained per byte of bronze on disk — reported, never projected with. */
  readonly bytesPerDiskByte: number;
  readonly shipped: number;
  /** Whether the shipped constant is at or above the measured per-record cost. */
  readonly covers: boolean;
}

/**
 * Derive the per-record cost from a sample. Pure.
 *
 * A negative delta — the build settling BELOW where it started, which a collection of something unrelated
 * can produce on a source small enough to sit inside the process's own allocation noise — clamps to zero. It
 * is not a measurement of the index, and a negative "bytes per record" would report a constant that covers
 * everything.
 *
 * @param sample the measured build
 * @returns the per-record cost and the verdict on the shipped constant
 */
export function deriveDedupIndexCost({ sample }: { sample: DedupIndexSample }): DedupIndexCost {
  const retained = Math.max(0, sample.heldBytes - sample.startBytes);
  const bytesPerRecord = sample.rows > 0 ? retained / sample.rows : 0;
  return {
    bytesPerDiskByte: sample.diskBytes > 0 ? retained / sample.diskBytes : 0,
    bytesPerRecord,
    covers: DEDUP_INDEX_BYTES_PER_RECORD >= bytesPerRecord,
    sample,
    shipped: DEDUP_INDEX_BYTES_PER_RECORD,
  };
}

/**
 * Render the cost as the lines the verb prints. Pure.
 *
 * @param cost the derived cost
 * @returns the corpus line, the heap line, and the verdict on the shipped constant
 */
export function renderDedupIndexCost({ cost }: { cost: DedupIndexCost }): readonly string[] {
  const { sample } = cost;
  const mib = ({ bytes }: { bytes: number }): string => String(toMib({ bytes }));
  const lines: string[] = [
    `source: ${sample.source} — ${String(sample.fileCount)} file(s), ${mib({ bytes: sample.diskBytes })} MiB on disk, ` +
      `${String(sample.rows)} row(s) indexed, ${String(sample.ids)} distinct sourceId(s)`,
    `ceiling: ${mib({ bytes: sample.limitBytes })} MiB (this process's --max-old-space-size, or V8's default)`,
    `live heap: ${mib({ bytes: sample.startBytes })} MiB before → ${mib({ bytes: sample.heldBytes })} MiB with the ` +
      `index held, in ${(sample.elapsedMs / 1000).toFixed(1)}s`,
    `index cost: ${cost.bytesPerRecord.toFixed(0)} live bytes per record (${cost.bytesPerDiskByte.toFixed(3)} per ` +
      `disk byte) — shipped constant ${String(cost.shipped)} ` +
      `${cost.covers ? "covers it" : "UNDER-PROJECTS: raise DEDUP_INDEX_BYTES_PER_RECORD"}`,
  ];
  if (sample.refused) {
    lines.push(
      "the heap guard STOPPED this build, so the source was only partially indexed — the cost above is a " +
        "lower bound; re-run with a bigger NODE_OPTIONS=--max-old-space-size to measure the whole source",
    );
  }
  for (const path of sample.unreadable) {
    lines.push(`unreadable: ${path} — this measurement covers less than the source holds`);
  }
  return lines;
}

/**
 * Whether the measurement is one the shipped constant may be trusted against: it covered the whole source,
 * and the constant is at or above what was measured. The verb's exit code turns on this, so a cost that has
 * grown past the guard fails loudly rather than printing a table nobody reads.
 *
 * @param cost the derived cost
 * @returns `true` when the whole source was indexed and the shipped constant covers it
 */
export function dedupConstantHolds({ cost }: { cost: DedupIndexCost }): boolean {
  return cost.covers && !cost.sample.refused && cost.sample.unreadable.length === 0;
}
