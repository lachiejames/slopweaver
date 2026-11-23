/**
 * The words under an evidence crop: what the page reported, the query, and where the picture came from.
 *
 * Pure text from one observation. `./capturePipeline.ts` calls it and `./annotate.ts` draws what it returns.
 */
import { MAX_CAPTION_LINE_CHARS } from "./annotate.js";
import type { TargetObservation } from "./observation.js";

/**
 * The caption the crop carries: the summary and range first and largest, then the query, then provenance.
 *
 * @param observation the observation the shutter fired on
 * @param finalUrl where the page settled
 * @param capturedAtIso the instant the shutter fired, printed as provenance
 * @param lead an optional first line the caller supplies — the claim the picture backs
 * @returns the lines, at most four
 */
export function captionLinesFor({
  observation,
  finalUrl,
  capturedAtIso,
  lead,
}: {
  observation: TargetObservation;
  finalUrl: string;
  capturedAtIso: string;
  lead: string | null;
}): readonly string[] {
  const summary = observation.summary === null ? "no results summary" : observation.summary.text;
  const range = observation.timeRange === null ? "" : ` · ${observation.timeRange.text}`;
  const query = observation.query === null ? "query not read" : observation.query.text;
  let host = finalUrl;
  try {
    host = new URL(finalUrl).host;
  } catch {
    host = finalUrl;
  }
  const lines = [
    `${summary}${range}`,
    `query: ${query}`,
    `captured ${capturedAtIso} from ${host} by slopweaver browser shot`,
  ];
  // A line is context, not the evidence — the picture carries the query itself — so a long one is cut
  // with an ellipsis rather than refusing the whole capture over a caption.
  const fitted = (lead === null ? lines : [lead, ...lines]).map((line) =>
    line.length > MAX_CAPTION_LINE_CHARS ? `${line.slice(0, MAX_CAPTION_LINE_CHARS - 1)}…` : line,
  );
  return fitted;
}
