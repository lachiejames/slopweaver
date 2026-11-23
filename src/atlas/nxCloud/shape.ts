/**
 * How this atlas recognises a path segment that is a VALUE rather than a field name.
 *
 * `kit/responseShape.ts` owns the walk and the redaction; what it cannot own is which segments look like
 * values, because that is per-platform and getting it wrong is not a cosmetic mistake. The first Slack
 * version of that reduction shipped real object ids into a committed file, because its redaction only
 * knew about timestamps. So each platform declares its own classifier, in its own module, where a reviewer
 * reads it beside the ids it is meant to catch.
 *
 * Nx Cloud has exactly two identifier shapes, and both are here:
 *
 * - **A 24-character lowercase hex id** — organisations, workspaces and pipeline executions. This is a
 *   Mongo ObjectId, and no field name in these payloads is 24 hex characters.
 * - **A 10-character mixed-case alphanumeric id** — a run id, e.g. the ones a pipeline page links to.
 *   Length alone would swallow real field names (`statusCode` is ten alphanumeric characters), so the
 *   pattern requires a digit AND both cases, which every observed run id has and no camelCase field name
 *   does.
 *
 * Neither collapses with a previous segment: unlike a Slack timestamp, which the dotted path splits across
 * two segments that were one value, an Nx Cloud id is always one segment.
 */
import type { SegmentVerdict } from "../kit/responseShape.js";

/** A Mongo-style object id: organisations, workspaces, pipeline executions. */
const OBJECT_ID = /^[0-9a-f]{24}$/;

/** A run id: ten alphanumerics carrying at least one digit and both cases. */
const RUN_ID = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])[0-9A-Za-z]{10}$/;

/**
 * How deep a response is walked before its paths stop being recorded.
 *
 * Six rather than the shallower caps elsewhere because Nx Cloud's own nesting is deep: a task's cache
 * status sits under run group, then run, then task, and a cap that stopped short would report the family
 * shape without the field the family exists to answer for.
 */
export const NX_CLOUD_SHAPE_DEPTH_CAP = 6;

/**
 * Classify one path segment.
 *
 * @param segment the segment straight from the capture
 * @returns what to write instead, or `null` when the segment is a field name
 */
export function classifyNxCloudSegment({ segment }: { segment: string }): SegmentVerdict | null {
  if (OBJECT_ID.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "<id>" };
  }
  if (RUN_ID.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "<rid>" };
  }
  return null;
}
