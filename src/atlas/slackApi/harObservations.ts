/**
 * Turn a browser capture into atlas rows — method names, parameter names and response field paths, and
 * nothing else.
 *
 * ## This file is the redaction, and that is why it is committed rather than scripted
 *
 * A HAR of a Slack session carries the owner's `xoxc` token, their `d` cookie, every request body and every
 * response body of one real workspace. The atlas must record what the API can DO, never what this account
 * did — so the reduction from capture to rows has to be a thing that can be read, reviewed and tested, not
 * a shell one-liner somebody ran once. Written as a script, the first version of this shipped real
 * Slack object IDs into a committed file, because `client.counts` keys two of its maps BY CHANNEL ID and a
 * redaction pass that only looked for timestamps sailed straight past them. The public hygiene gate caught
 * it; {@link redactPath} is what makes the gate's job unnecessary.
 *
 * Three reductions, each losing something on purpose:
 *
 *  - **Values are never read.** Only object KEYS and array positions become paths.
 *  - **A key that is itself a value is redacted.** Slack uses message timestamps and object IDs as map
 *    keys, so a `latest_updates` entry and a `threads.unread_count_by_channel` entry are both field paths
 *    whose last segment is data. They become `<ts>` and `<id>`.
 *  - **Session telemetry is dropped, not filtered later.** {@link TELEMETRY_PARAM} covers the `_x_*` bundle
 *    the web client stamps on every call, and `token`.
 *
 * The WALK and the redaction pass now live in `atlas/kit/responseShape.ts`, because a second console needed
 * exactly the same three reductions with different constants. What stays here is everything that is Slack's
 * own: the id and timestamp shapes below, the depth, and the SDK diff that turns a reduced call into a row.
 * Nothing about the output changed — {@link SLACK_SEGMENTS} is the same two patterns, applied by the kit.
 */
import { redactValueSegments, responseFieldPaths, type SegmentClassifier } from "../kit/responseShape.js";

import { BROWSER_PATH_CAP, type BrowserObservedMethod, TELEMETRY_PARAM } from "./model.js";

/** A Slack object id: one leading letter, then at least eight more of `[A-Z0-9]`. Channel, user, team, file. */
const SLACK_OBJECT_ID = /^[A-Z][A-Z0-9]{8,}$/;

/** A bare run of digits — a message timestamp arrives as two such segments either side of a dot. */
const DIGITS_ONLY = /^[0-9]+$/;

/** How deep a response path is kept. Three is where `history.messages[].reply_count` lives. */
const PATH_DEPTH = 3;

/**
 * Slack's own value-segment shapes, handed to the kit's redaction pass.
 *
 * A message timestamp keys a map as `<seconds>.<micros>`, which arrives as two adjacent digit segments that
 * were ONE value before the dot split it — hence `collapsesWithPrevious`. An object id keys one as a single
 * upper-case token and each is its own value, so two adjacent ones stay two.
 *
 * @param segment one dot-separated path segment
 * @returns how to redact it, or `null` when it is a genuine field name
 *
 * @internal
 */
export const SLACK_SEGMENTS: SegmentClassifier = ({ segment }) => {
  if (DIGITS_ONLY.test(segment)) {
    return { collapsesWithPrevious: true, placeholder: "<ts>" };
  }
  return SLACK_OBJECT_ID.test(segment) ? { collapsesWithPrevious: false, placeholder: "<id>" } : null;
};

/**
 * Redact any path segment that is a VALUE rather than a field name.
 *
 * @param path the dotted path, straight from the capture
 * @returns the path with every value-shaped segment replaced
 */
export function redactPath({ path }: { path: string }): string {
  return redactValueSegments({ classify: SLACK_SEGMENTS, path });
}

/** One captured call, reduced to what the atlas may see. The caller extracts these from the HAR. */
export interface CapturedCall {
  /** The dotted method name, from the `/api/<name>` path. */
  readonly name: string;
  /** Every request parameter NAME, telemetry included — this module drops it. */
  readonly paramNames: readonly string[];
  /** The parsed response body, or `undefined` when it was absent or not JSON. */
  readonly body: unknown;
}

/** What the captured calls have shown about one method so far. */
interface MethodSightings {
  params: Set<string>;
  paths: Set<string>;
}

/** The sightings a method already holds, or a fresh empty pair the first time a call names it. */
function sightingsFor({ held }: { held: MethodSightings | undefined }): MethodSightings {
  if (held == null) {
    return { params: new Set<string>(), paths: new Set<string>() };
  }
  return held;
}

/** The argument names the SDK declares for a method, or none when the SDK does not declare it at all. */
function declaredParams({ held }: { held: ReadonlySet<string> | undefined }): ReadonlySet<string> {
  if (held == null) {
    return new Set<string>();
  }
  return held;
}

/**
 * Reduce captured calls to atlas rows.
 *
 * @param calls the captured calls
 * @param sdkMethodNames every method the installed SDK declares, so `publicSurface` is measured
 * @param sdkParamsByMethod each SDK method's declared argument names, so `undocumentedParams` is a diff
 * @returns one row per distinct method, sorted by name
 */
export function observationsFromCalls({
  calls,
  sdkMethodNames,
  sdkParamsByMethod,
}: {
  calls: readonly CapturedCall[];
  sdkMethodNames: ReadonlySet<string>;
  sdkParamsByMethod: ReadonlyMap<string, ReadonlySet<string>>;
}): readonly BrowserObservedMethod[] {
  const byMethod = new Map<string, MethodSightings>();
  for (const call of calls) {
    const entry = sightingsFor({ held: byMethod.get(call.name) });
    for (const param of call.paramNames.filter((name) => !TELEMETRY_PARAM.test(name))) {
      entry.params.add(param);
    }
    for (const path of responseFieldPaths({ body: call.body, classify: SLACK_SEGMENTS, depthCap: PATH_DEPTH })) {
      entry.paths.add(path);
    }
    byMethod.set(call.name, entry);
  }
  return [...byMethod.entries()]
    .map(([name, entry]): BrowserObservedMethod => {
      const declared = declaredParams({ held: sdkParamsByMethod.get(name) });
      const paths = [...entry.paths].toSorted();
      return {
        name,
        publicSurface: sdkMethodNames.has(name),
        responsePaths: paths.slice(0, BROWSER_PATH_CAP),
        responsePathsTotal: paths.length,
        undocumentedParams: [...entry.params].filter((param) => !declared.has(param)).toSorted(),
      };
    })
    .toSorted((a, b) => a.name.localeCompare(b.name));
}
