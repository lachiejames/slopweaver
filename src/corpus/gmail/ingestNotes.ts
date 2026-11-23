/**
 * The note lines a `gmail` ingest run prints about its lane, and the two per-batch tallies that feed them, read
 * back off the projected records. Pure: the ingest job in `ingest.ts` crawls, commits and anchors, then hands
 * the counts here to be rendered.
 */
import type { CorpusRecord } from "../types.js";

/**
 * The note lines the run prints about this lane.
 *
 * The lane that ran is named FIRST and always, because "delta" and "window" have different costs and
 * different coverage and the operator cannot tell them apart from the record counts alone — a quiet week
 * and an expired anchor both look like a handful of new messages.
 *
 * @param lane which crawl ran
 * @param projected how many records the projection produced
 * @param transcripts how many of those records are meeting transcripts rather than messages
 * @param transcriptChars how many characters of raw speech those transcripts carry between them
 * @param quotedCharsDropped how many characters the quoted-tail strip removed across them
 * @param anchored the anchor line, when one was written
 * @returns the note lines, in print order
 */
export function gmailIngestNotes({
  lane,
  projected,
  transcripts,
  transcriptChars,
  quotedCharsDropped,
  anchored,
}: {
  lane: string;
  projected: number;
  transcripts: number;
  transcriptChars: number;
  quotedCharsDropped: number;
  anchored: string | undefined;
}): readonly string[] {
  return [
    `${lane} crawl · ${String(projected)} record(s) projected`,
    ...(transcripts > 0
      ? [
          `meeting transcripts: ${String(transcripts)} stored, ${String(transcriptChars)} character(s) of raw ` +
            "speech — a meeting whose document carries only Gemini's summary is refused, and says so in the " +
            "warnings",
        ]
      : []),
    ...(quotedCharsDropped > 0
      ? [`quoted tails and signatures stripped: ${String(quotedCharsDropped)} character(s) not stored`]
      : []),
    ...(anchored !== undefined ? [anchored] : []),
  ];
}

/**
 * How many characters of raw speech a batch's meeting transcripts carry, read off the records themselves.
 *
 * @returns the raw-speech character total across the batch
 */
export function transcriptCharsAcross({ records }: { records: readonly CorpusRecord[] }): number {
  return records.reduce((total, record) => {
    const chars = record.attrs?.["transcriptChars"];
    return total + (typeof chars === "number" ? chars : 0);
  }, 0);
}

/**
 * How many characters the projection dropped across a batch, read back off the records themselves.
 *
 * @returns the dropped-character total across the batch
 */
export function droppedAcross({ records }: { records: readonly CorpusRecord[] }): number {
  return records.reduce((total, record) => {
    const dropped = record.attrs?.["quotedCharsDropped"];
    return total + (typeof dropped === "number" ? dropped : 0);
  }, 0);
}
