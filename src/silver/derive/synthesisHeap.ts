/**
 * What derive's SYNTHESIS needs on the heap on top of the records it has read, pure half.
 *
 * The corpus read is guarded (`../../corpus/corpusDirRead.ts`: a whole-corpus preflight, then a check per
 * chunk), and identity resolution after it adds next to nothing. `deriveSilver` was guarded by nothing, and it
 * is where derive dies: its directory, cross-ref graph, opportunities, attribution and curated graph are
 * built from every record at once, and their intermediates are transient — LIVE heap after it returns is only
 * 483 MiB above what the read left, while the working set on the way there is far larger. So a ceiling the read
 * fitted under could still end in `FATAL ERROR: Ineffective mark-compacts near heap limit` and exit 134, inside
 * a send's just-in-time derive (`../rosterForSend.ts`) as readily as inside the verb.
 *
 * MEASURED on the owner's 3,453,536-record corpus:
 *
 * | ceiling     | outcome                                                                  |
 * | ----------- | ------------------------------------------------------------------------ |
 * | 4,096 MiB   | exit 134 in `Building directory`, last full GC 4,068 → 4,066 MB live     |
 * | 5,120 MiB   | completes                                                                |
 * | 12,288 MiB  | completes; post-GC live 2,826 MiB after the read, 3,309 after synthesis  |
 *
 * Repro: `NODE_OPTIONS=--max-old-space-size=4096 slopweaver derive --dry-run`, then `=5120`.
 *
 * The synthesis therefore needs at least ~1,240 MiB beyond the read (it died at 4,066 live from 2,826) and at
 * most ~2,294 (it fitted at 5,120): 376 to 696 bytes per record. Against the guard's 15% reserve, any
 * coefficient from 249 to 513 refuses at 4,096 and passes at 5,120 and 12,288. {@link
 * SYNTHESIS_HEAP_BYTES_PER_RECORD} sits at the measured lower bound, so it refuses only a run the measurement
 * says cannot finish — a ceiling between those two may still pass and die, which is stated residue rather than
 * a guarantee.
 */
import { type HeapShortfall, toMib } from "#lib/heapBudget.js";

/** The heap the synthesis is projected to need per record read, in bytes — see the header for the band. */
export const SYNTHESIS_HEAP_BYTES_PER_RECORD = 384;

/**
 * The bytes the synthesis is projected to add to the heap over this many records. Pure.
 *
 * @param recordCount how many logical-latest records the synthesis will build silver from
 * @returns the projected bytes, zero for no records
 */
export function synthesisHeapProjection({ recordCount }: { recordCount: number }): number {
  return recordCount * SYNTHESIS_HEAP_BYTES_PER_RECORD;
}

/**
 * The one-line refusal derive returns when the synthesis cannot fit under the ceiling. Pure.
 *
 * @param recordCount how many records the synthesis would have built from
 * @param shortfall the heap guard's verdict that it does not fit
 * @returns the refusal, naming the phase, the reading and the ceiling that would hold it
 */
export function synthesisHeapRefusal({
  recordCount,
  shortfall,
}: {
  recordCount: number;
  shortfall: HeapShortfall;
}): string {
  const reading = shortfall.collected ? "live" : "used, garbage included";
  return (
    `refusing to derive: synthesising silver over ${recordCount.toLocaleString("en-US")} records needs ` +
    `~${String(toMib({ bytes: shortfall.projectedBytes }))} MiB more heap, and ${String(toMib({ bytes: shortfall.usedBytes }))} MiB ` +
    `is already ${reading} of a ${String(toMib({ bytes: shortfall.limitBytes }))} MiB ceiling — re-run with ` +
    `NODE_OPTIONS=--max-old-space-size=${String(shortfall.suggestedLimitMib)} slopweaver derive`
  );
}
