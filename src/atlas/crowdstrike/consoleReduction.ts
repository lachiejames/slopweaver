/**
 * Turn what the Falcon console asked for into atlas rows — method, path SHAPE and response field NAMES.
 *
 * ## This file is the redaction, and it is committed so it can be reviewed rather than trusted
 *
 * A signed-in Falcon console session carries real detections about real people's machines, a bearer the
 * page holds in memory, and every response body behind them. The atlas must record what the console can
 * ASK FOR, never what a tenant contains — so the reduction has to be a thing a reviewer can read.
 *
 * The walk and the redaction pass are `kit/responseShape.ts`, shared with the Slack atlas. What is Falcon's
 * own is here, and it is exactly the part that could not be shared: Slack's id pattern is
 * `^[A-Z][A-Z0-9]{8,}$`, which matches NONE of Falcon's lowercase 32-hex agent ids, so reducing a Falcon
 * capture with Slack's constants would have kept every real device id it saw.
 *
 * ## Three reductions, each losing something on purpose
 *
 * - **Values are never read.** Only object keys and array positions become paths.
 * - **A path segment that is itself a value is redacted** — an agent id, a policy id, a trace uuid.
 * - **Session telemetry is dropped at extraction**, not filtered at render.
 */
import {
  type ConsoleFoldSpec,
  foldConsoleCalls,
  isRecordableResponse,
  type ObservedCall,
  paramNamesOf,
  pathShapeOf,
} from "../kit/consoleFold.js";
import type { SegmentClassifier } from "../kit/responseShape.js";

export { isRecordableResponse };

import type { ConsoleRequestObservation } from "./projectConsole.js";

/**
 * A Falcon identifier: 32 lowercase hex characters. Agent ids, policy ids and CIDs all share this shape.
 *
 * Measured against live Falcon responses — `device_id`, `policy_id` and `cid` are all 32-hex, and the
 * composite alert id is two of them joined by an underscore, which is why the second pattern exists.
 */
const FALCON_HEX_ID = /^[0-9a-f]{32}(?:_[0-9a-f]{32})?$/;

/** A trace or correlation uuid, which the console stamps on its own calls. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A bare run of digits — an epoch, an offset, or a numeric id used as a map key. */
const DIGITS_ONLY = /^[0-9]+$/;

/**
 * Falcon's own value-segment shapes, handed to the kit's redaction pass.
 *
 * None collapses with its neighbour: unlike a Slack timestamp, no Falcon value is split across two dotted
 * segments, so two adjacent ids are genuinely two ids and flattening them would understate the shape.
 *
 * @param segment one dot-separated path segment
 * @returns how to redact it, or `null` when it is a genuine field name
 */
export const FALCON_SEGMENTS: SegmentClassifier = ({ segment }) => {
  if (FALCON_HEX_ID.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "<aid>" };
  }
  if (UUID.test(segment)) {
    return { collapsesWithPrevious: false, placeholder: "<uuid>" };
  }
  return DIGITS_ONLY.test(segment) ? { collapsesWithPrevious: false, placeholder: "<n>" } : null;
};

/**
 * Query parameters dropped before a request is recorded.
 *
 * Everything beginning with an underscore is the console's own cache-busting and analytics bundle, and the
 * named entries are session material. A parameter NAME says what an endpoint accepts; these say what this
 * session was, which is the thing the atlas must not keep.
 *
 * @internal
 */
export const FALCON_TELEMETRY_PARAM = /^(?:_|cb$|t$|timestamp$|token$|access_token$|csrf|nonce$)/i;

/**
 * How deep a response path is kept, matched to where Falcon's own list payloads carry their fields.
 *
 * @internal
 */
export const FALCON_PATH_DEPTH = 4;

/**
 * The most response paths one recorded call retains.
 *
 * A cap rather than the whole shape: the console's feature-flag and preference documents carry
 * per-tenant configuration paths past the cap that say nothing about what an endpoint can do.
 * {@link ConsoleRequestObservation.responseFieldPaths} is what a reader sees, and the accumulator below
 * keeps the omission visible by counting before it truncates.
 *
 * @internal
 */
export const FALCON_PATH_CAP = 100;

/**
 * One first-party call the walk observed on one page.
 *
 * @internal
 */
export type ObservedConsoleCall = ObservedCall;

/** The four platform-specific values the kit's fold cannot decide for Falcon. */
const FALCON_FOLD_SPEC: ConsoleFoldSpec = {
  classify: FALCON_SEGMENTS,
  depthCap: FALCON_PATH_DEPTH,
  pathCap: FALCON_PATH_CAP,
  telemetryParam: FALCON_TELEMETRY_PARAM,
};

/**
 * Canonicalise a request URL into a path SHAPE, with Falcon's own classifier.
 *
 * @param url the absolute request URL
 * @returns the path shape, or `null` when the URL cannot be parsed
 *
 * @internal
 */
export function falconPathShape({ url }: { url: string }): string | null {
  return pathShapeOf({ classify: FALCON_SEGMENTS, url });
}

/**
 * Every query parameter NAME on a request URL, Falcon's telemetry names dropped.
 *
 * @param url the absolute request URL
 * @returns the surviving parameter names, sorted
 *
 * @internal
 */
export function falconParamNames({ url }: { url: string }): readonly string[] {
  return paramNamesOf({ telemetryParam: FALCON_TELEMETRY_PARAM, url });
}

/**
 * Fold every call a whole walk observed into one row per distinct endpoint.
 *
 * @param calls every call the walk observed, from every page
 * @returns one observation per distinct method-and-path-shape, sorted
 */
export function reduceConsoleCalls({
  calls,
}: {
  calls: readonly ObservedConsoleCall[];
}): readonly ConsoleRequestObservation[] {
  return foldConsoleCalls({ calls, spec: FALCON_FOLD_SPEC });
}
