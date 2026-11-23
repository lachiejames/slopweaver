/**
 * The corpus read's own heap arithmetic: what a PARTIAL read has already measured, and the
 * `--max-old-space-size` that would carry the whole corpus in one attempt. Pure.
 *
 * ## The defect this exists for
 *
 * The bronze reader checks the heap between chunks, projecting one {@link ../corpus/corpusStore.READ_CHUNK_BYTES}
 * chunk at a time — 16 MiB at the `bronze` coefficient. That bound is the whole point of the per-chunk
 * check ({@link ../corpus/corpusStore.readFileInto} says why), but it also means the refusal knows only what
 * the NEXT chunk needs. Reported as advice, "needs ~16 MiB more" becomes a suggested ceiling barely above
 * the current one, so a caller who follows it reads a little further and is refused again at the same
 * shortfall. Measured on the owner's 7,814 MiB corpus: `slopweaver derive` refused at 4,288,
 * then 8,384, then 11,456 MiB, each time "~16 MiB more" and each time having read further (1,319 → 6,983
 * MiB). It finally ran at 16,384. The advice was not slow, it was wrong at every level.
 *
 * ## What replaces it
 *
 * A read that has been refused mid-corpus is holding the best coefficient anyone will ever have for THIS
 * corpus: it has read `readBytes` of disk and is retaining `liveBytes` of heap, both measured, in this
 * process, on this data. Extrapolating the remainder from that ratio needs no static coefficient and no
 * assumption about record shape — and it self-corrects as the corpus's mix of sources changes, which is
 * exactly what a hand-measured constant cannot do.
 *
 * The static band still stands in for the two cases the observed ratio cannot speak to, and it stands in
 * DIFFERENTLY for each. A read that has measured a ratio below the band's floor is under-measuring — a
 * cheap first file says nothing about the rest — so the floor replaces it. A read that has measured nothing
 * at all (the whole-corpus preflight) gets the band's CEILING, not its floor, and that asymmetry is a
 * separate defect fixed here rather than a flourish: the preflight REFUSES at the floor so it can never
 * turn away a corpus that would have fitted, and a suggestion built from the same floor is by construction
 * the smallest ceiling that might work. Measured on the owner's 7,821 MiB corpus, the preflight
 * refused at 4,288 MiB and suggested 6,656 — the floor's number — where the read actually needs ~1.78 heap
 * bytes per disk byte and does not fit under 16,384. Refuse on the floor, advise on the ceiling: the two
 * numbers answer two different questions.
 *
 * A projection is only useful if following it works the first time, so it errs high.
 *
 * `liveBytes` must be a POST-COLLECTION reading or the ratio measures garbage — see
 * {@link ../lib/heapBudget.canCollectInto}, whose collector band exists so that it is.
 */
import { HEAP_RESERVE_FRACTION } from "../lib/heapBudget.js";

const MIB = 1024 * 1024;

/** The ceiling suggestion is rounded up to a multiple of this, so it reads as a setting, not a measurement. */
const CEILING_STEP_MIB = 512;

/** What a partial read projects for the WHOLE corpus, and the ceiling that would hold it. */
export interface CorpusHeapProjection {
  /** Live heap bytes retained per byte of `.jsonl` on disk. */
  readonly ratio: number;
  /** Whether `ratio` was MEASURED by this read, or is the static band's floor standing in for one. */
  readonly measured: boolean;
  /** The live heap the whole corpus is projected to retain once the read finishes. */
  readonly wholeCorpusBytes: number;
  /** The `--max-old-space-size` (MiB) that holds {@link wholeCorpusBytes} with the load's reserve intact. */
  readonly ceilingMib: number;
}

/**
 * Project what the whole corpus will retain, from what this read has retained so far. Pure.
 *
 * @param liveBytes the heap retained right now — a post-collection reading, or the ratio measures garbage
 * @param readBytes bytes of `.jsonl` consumed so far — `0` at the whole-corpus preflight
 * @param diskBytes bytes of `.jsonl` in the whole corpus
 * @param band the static coefficients: the floor a measured ratio may not fall below, and the ceiling that
 *   stands in when nothing has been read at all
 * @param reserveFraction the fraction of the ceiling the load must leave free for the collector
 * @returns the ratio, the projected whole-corpus live heap, and the ceiling that would hold it
 */
export function projectWholeCorpusHeap({
  liveBytes,
  readBytes,
  diskBytes,
  band,
  reserveFraction = HEAP_RESERVE_FRACTION,
}: {
  liveBytes: number;
  readBytes: number;
  diskBytes: number;
  band: { readonly floor: number; readonly ceiling: number };
  reserveFraction?: number;
}): CorpusHeapProjection {
  const observed = readBytes > 0 ? liveBytes / readBytes : 0;
  const measured = observed > band.floor;
  const ratio = ratioOf({ band, measured, observed, readBytes });
  const remaining = Math.max(0, diskBytes - readBytes);
  const wholeCorpusBytes = liveBytes + remaining * ratio;
  return {
    ceilingMib: Math.ceil(wholeCorpusBytes / (1 - reserveFraction) / MIB / CEILING_STEP_MIB) * CEILING_STEP_MIB,
    measured,
    ratio,
    wholeCorpusBytes,
  };
}

/** The rate the projection uses: what was measured, the floor under it, or the ceiling when nothing was. */
function ratioOf({
  band,
  measured,
  observed,
  readBytes,
}: {
  band: { readonly floor: number; readonly ceiling: number };
  measured: boolean;
  observed: number;
  readBytes: number;
}): number {
  if (measured) {
    return observed;
  }
  return readBytes > 0 ? band.floor : band.ceiling;
}
