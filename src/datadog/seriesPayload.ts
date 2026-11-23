/**
 * The INPUT half of `datadog submit`: the `{ "series": [...] }` payload file a caller hands the door, read and
 * refused before anything is sent.
 *
 * Its own module because it is not a provider read. `seriesSubmit.ts` posts to Datadog and reads the answer for
 * its status alone; the JSON this file parses is the caller's, so the `boundary-schema` gate's criterion (a bare
 * fetch and a JSON read in one file) no longer reads a local file as a provider answer owed a boundary.
 *
 * ## Gauges and counts only, by the schema
 *
 * A submitted series declares `type: "gauge"`, or `type: "count"` WITH the `interval` its points cover. A
 * distribution cannot be backfilled through Historical Metrics Ingestion at all, and a count without its
 * interval, or a rate, would be accepted by Datadog and then read wrong forever — Datadog cannot delete
 * metric points — so the refusal is at the schema rather than in prose. Counts arrived with `datadog hmi`:
 * Datadog will not switch HMI on for a metric it has never received, and registering a count
 * metric with a gauge point would risk recording the wrong type for it.
 */
import { z } from "zod";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";

import { type DatadogSubmitError, DatadogSubmitErrors } from "./seriesSubmitErrors.js";

/** One gauge series: a metric name, its tags, and the points to stamp. */
const gaugeSeriesSchema = z.object({
  metric: z.string().min(1),
  points: z.array(z.tuple([z.number().int(), z.number()])).min(1),
  tags: z.array(z.string().min(1)).default([]),
  type: z.literal("gauge"),
});

/** One gauge series, parsed. */
export type GaugeSeries = z.infer<typeof gaugeSeriesSchema>;

/**
 * One count series: a gauge's fields plus the `interval` in seconds each point covers, which is what makes a
 * count readable at all — without it Datadog cannot say what a point's total was a total OF.
 */
const countSeriesSchema = gaugeSeriesSchema.extend({
  interval: z.number().int().positive(),
  type: z.literal("count"),
});

/** Any series this door submits: a gauge, or a count with its interval. */
const submittedSeriesSchema = z.discriminatedUnion("type", [gaugeSeriesSchema, countSeriesSchema]);

/** One submittable series, parsed. */
export type SubmittedSeries = z.infer<typeof submittedSeriesSchema>;

/** The submission payload's own shape — exactly what `/api/v1/series` takes. */
const seriesPayloadSchema = z.object({ series: z.array(submittedSeriesSchema).min(1) });

/**
 * Read a `{ "series": [...] }` payload, refusing anything that is not a submittable gauge or count series.
 *
 * `safeJsonParse` rather than a bare `JSON.parse`: a series file's size is a property of the DATA (days ×
 * tagsets), which is exactly the class the repo's whole-file-string rule governs.
 *
 * @param text the file's contents
 * @param label how the file is named in a refusal
 * @returns the parsed series, or why the payload cannot be believed
 */
export function parseSeriesPayload({
  text,
  label,
}: {
  text: string;
  label: string;
}): Result<readonly SubmittedSeries[], DatadogSubmitError> {
  let json: unknown;
  try {
    json = safeJsonParse({ text, label });
  } catch (error: unknown) {
    return err(
      DatadogSubmitErrors.payloadInvalid({ issues: [`${label} is not readable JSON: ${errorMessage({ error })}`] }),
    );
  }
  const parsed = seriesPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return err(
      DatadogSubmitErrors.payloadInvalid({
        issues: parsed.error.issues.map((issue) => `${issuePlace({ path: issue.path })}: ${issue.message}`),
      }),
    );
  }
  return ok(parsed.data.series);
}

/**
 * Where in the payload one schema issue sits, as a dotted path.
 *
 * Zod reports an issue about the whole document — a payload that is not an object at all — with an empty
 * path, which joins to nothing, so that place is named as the root rather than printed as a bare colon.
 */
function issuePlace({ path }: { path: readonly PropertyKey[] }): string {
  const joined = path.join(".");
  if (joined === "") {
    return "(root)";
  }
  return joined;
}
