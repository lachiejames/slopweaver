/**
 * The evidence-capture snippet's result, validated field by field.
 *
 * The snippet's JSON is parsed here with the same distrust `playwrightCli.ts`'s `captureFrom` applies: a
 * missing number is a refusal, a rectangle with no area is a refusal, an unknown readiness word is a
 * refusal. A permissive parse would turn a snippet that broke into an observation that happened to say
 * "ready", which is the class this whole pipeline exists to close. `evidenceCapture.ts` is the transport that
 * runs the snippet; this is the half that decides whether what came back can be believed.
 */

import { appendAll } from "../lib/arrays.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import type { PageTextWalk } from "../visualEvidence/frameText.js";
import type {
  ChartObservation,
  CssRect,
  EvidenceCaptureResult,
  PageGeometry,
  RegionVisibility,
  ResultsSummary,
  TargetObservation,
} from "../visualEvidence/observation.js";

import { type BrowserError, BrowserErrors, browserErrorLines } from "./browserErrors.js";
import { contextAt, numberAt, pairAt, problemsOf, rectAt, visibilityAt } from "./evidenceFields.js";

/** The summary's two counts, both non-negative integers, or a named refusal. */
function countsAt({
  record,
  at,
}: {
  record: Record<string, unknown>;
  at: string;
}): Result<{ groups: number; logs: number }, BrowserError> {
  const groups = numberAt({ at, key: "groups", record });
  const logs = numberAt({ at, key: "logs", record });
  if (groups.isErr() || logs.isErr()) {
    return err(BrowserErrors.evidenceRefused({ reasons: problemsOf({ fields: [groups, logs] }) }));
  }
  const wellFormed = [groups.value, logs.value].every((count) => count >= 0 && Number.isInteger(count));
  if (!wellFormed) {
    return err(BrowserErrors.evidenceCountsInvalid({ at }));
  }
  return ok({ groups: groups.value, logs: logs.value });
}

/** The parsed summary, `null`, or a named refusal. */
function summaryAt({
  record,
  at,
}: {
  record: Record<string, unknown>;
  at: string;
}): Result<ResultsSummary | null, BrowserError> {
  const value = record["summary"];
  if (value === null) {
    return ok(null);
  }
  if (!isRecord(value) || typeof value["text"] !== "string") {
    return err(BrowserErrors.evidenceSummaryInvalid({ at }));
  }
  const counts = countsAt({ at: `${at}.summary`, record: value });
  if (counts.isErr()) {
    return err(counts.error);
  }
  const rect = rectAt({ at: `${at}.summary`, key: "rect", record: value });
  const visibility = visibilityAt({ at: `${at}.summary`, key: "visibility", record: value });
  if (rect.isErr() || visibility.isErr()) {
    return err(BrowserErrors.evidenceRefused({ reasons: problemsOf({ fields: [rect, visibility] }) }));
  }
  if (rect.value === null) {
    return err(BrowserErrors.evidenceSummaryRectMissing({ at }));
  }
  return ok({
    groups: counts.value.groups,
    logs: counts.value.logs,
    rect: rect.value,
    text: value["text"],
    visibility: visibility.value,
  });
}

/** The chart observation, or a named refusal. */
function chartAt({
  record,
  at,
}: {
  record: Record<string, unknown>;
  at: string;
}): Result<ChartObservation, BrowserError> {
  const value = record["chart"];
  if (!isRecord(value)) {
    return err(BrowserErrors.evidenceNotAnObject({ at: `${at}.chart` }));
  }
  const canvasCount = numberAt({ at: `${at}.chart`, key: "canvasCount", record: value });
  const inkSamples = numberAt({ at: `${at}.chart`, key: "inkSamples", record: value });
  const sampledPixels = numberAt({ at: `${at}.chart`, key: "sampledPixels", record: value });
  const rect = rectAt({ at: `${at}.chart`, key: "rect", record: value });
  const problems = problemsOf({ fields: [canvasCount, inkSamples, sampledPixels, rect] });
  const inkError = value["inkError"];
  if (inkError !== null && typeof inkError !== "string") {
    problems.push(`${at}.chart.inkError is neither a string nor null`);
  }
  let visibility: RegionVisibility | null = null;
  if (value["visibility"] !== null) {
    const parsedVisibility = visibilityAt({ at: `${at}.chart`, key: "visibility", record: value });
    if (parsedVisibility.isErr()) {
      appendAll({ from: browserErrorLines({ error: parsedVisibility.error }), into: problems });
    } else {
      visibility = parsedVisibility.value;
    }
  }
  if (rect.isOk() && rect.value !== null && visibility === null) {
    problems.push(`${at}.chart.visibility is null while the chart is present`);
  }
  if (problems.length > 0) {
    return err(BrowserErrors.evidenceRefused({ reasons: problems }));
  }
  return ok({
    canvasCount: canvasCount._unsafeUnwrap(),
    inkError: typeof inkError === "string" ? inkError : null,
    inkSamples: inkSamples._unsafeUnwrap(),
    rect: rect._unsafeUnwrap(),
    sampledPixels: sampledPixels._unsafeUnwrap(),
    visibility,
  });
}

/**
 * One observation, validated.
 *
 * @param value the snippet's own object
 * @param at where in the output it sat, for the refusal
 * @returns the observation, or every field that could not be trusted
 *
 * @internal
 */
export function parseTargetObservation({
  value,
  at,
}: {
  value: unknown;
  at: string;
}): Result<TargetObservation, BrowserError> {
  if (!isRecord(value)) {
    return err(BrowserErrors.evidenceNotAnObject({ at }));
  }
  const problems: string[] = [];
  const need = <T>({ field }: { field: Result<T, BrowserError> }): T | null => {
    if (field.isErr()) {
      appendAll({ from: browserErrorLines({ error: field.error }), into: problems });
      return null;
    }
    return field.value;
  };
  const targetMatches = need({ field: numberAt({ at, key: "targetMatches", record: value }) });
  const progressIndicators = need({ field: numberAt({ at, key: "progressIndicators", record: value }) });
  const networkQuietMs = need({ field: numberAt({ at, key: "networkQuietMs", record: value }) });
  const observedAtMs = need({ field: numberAt({ at, key: "observedAtMs", record: value }) });
  const targetRect = need({ field: rectAt({ at, key: "targetRect", record: value }) });
  const viewport = need({ field: pairAt({ at, fields: ["width", "height"], key: "viewport", record: value }) });
  const scroll = need({ field: pairAt({ at, fields: ["x", "y"], key: "scroll", record: value }) });
  const summary = need({ field: summaryAt({ at, record: value }) });
  const chart = need({ field: chartAt({ at, record: value }) });
  const query = need({ field: contextAt({ at, key: "query", record: value }) });
  const timeRange = need({ field: contextAt({ at, key: "timeRange", record: value }) });
  const smallestFont = value["smallestFontPx"];
  if (smallestFont !== null && (typeof smallestFont !== "number" || !(smallestFont > 0))) {
    problems.push(`${at}.smallestFontPx is neither a positive number nor null`);
  }
  const documentSize = need({ field: pairAt({ at, fields: ["width", "height"], key: "document", record: value }) });
  if (problems.length > 0) {
    return err(BrowserErrors.evidenceRefused({ reasons: problems }));
  }
  return ok({
    chart: chart!,
    document: { height: documentSize![1], width: documentSize![0] },
    networkQuietMs: networkQuietMs!,
    observedAtMs: observedAtMs!,
    progressIndicators: progressIndicators!,
    query,
    scroll: { x: scroll![0], y: scroll![1] },
    smallestFontPx: typeof smallestFont === "number" ? smallestFont : null,
    summary,
    targetMatches: targetMatches!,
    targetRect,
    timeRange,
    viewport: { height: viewport![1], width: viewport![0] },
  });
}

/** The page geometry the snippet read beside the capture, or a named refusal. */
function geometryAt({ output }: { output: Record<string, unknown> }): Result<PageGeometry, BrowserError> {
  const record = output["geometry"];
  if (!isRecord(record)) {
    return err(BrowserErrors.evidenceNotAnObject({ at: "geometry" }));
  }
  const read = ({ key }: { key: string }): Result<number, BrowserError> => numberAt({ at: "geometry", key, record });
  const documentWidth = read({ key: "documentWidth" });
  const documentHeight = read({ key: "documentHeight" });
  const viewportWidth = read({ key: "viewportWidth" });
  const viewportHeight = read({ key: "viewportHeight" });
  const devicePixelRatio = read({ key: "devicePixelRatio" });
  const fields = [documentWidth, documentHeight, viewportWidth, viewportHeight, devicePixelRatio];
  const failed = problemsOf({ fields });
  if (failed.length > 0 || fields.some((field) => field.isErr())) {
    return err(BrowserErrors.evidenceRefused({ reasons: failed }));
  }
  return ok({
    devicePixelRatio: devicePixelRatio._unsafeUnwrap(),
    documentHeight: documentHeight._unsafeUnwrap(),
    documentWidth: documentWidth._unsafeUnwrap(),
    viewportHeight: viewportHeight._unsafeUnwrap(),
    viewportWidth: viewportWidth._unsafeUnwrap(),
  });
}

/** One reported box: a rectangle with positive area, or the problem naming where it sat. */
function boxAt({ value, at }: { value: unknown; at: string }): Result<CssRect, BrowserError> {
  const rect = rectAt({ at, key: "box", record: { box: value } });
  if (rect.isErr()) {
    return err(rect.error);
  }
  if (rect.value === null) {
    return err(BrowserErrors.evidenceRefused({ reasons: [`${at} is null where a box is required`] }));
  }
  return ok(rect.value);
}

/**
 * The page-text walk, `null` when the snippet took none, or a named refusal.
 *
 * Every node must carry a non-empty string and a box, every opaque region a box, and `truncated` must be a boolean:
 * a walk this cannot vouch for is refused rather than read as "no text", which is the reading that would let a
 * scan pass over a frame it never saw.
 */
function pageTextAt({ output }: { output: Record<string, unknown> }): Result<PageTextWalk | null, BrowserError> {
  const value = output["pageText"];
  if (value === null || value === undefined) {
    return ok(null);
  }
  if (!isRecord(value) || !Array.isArray(value["nodes"]) || !Array.isArray(value["opaque"])) {
    return err(BrowserErrors.evidenceNotAnObject({ at: "pageText" }));
  }
  const problems: string[] = [];
  if (typeof value["truncated"] !== "boolean") {
    problems.push("pageText.truncated is not a boolean");
  }
  const nodes = value["nodes"].flatMap((node: unknown, index): PageTextWalk["nodes"][number][] => {
    const at = `pageText.nodes[${String(index)}]`;
    if (!isRecord(node) || typeof node["text"] !== "string" || node["text"] === "") {
      problems.push(`${at}.text is not a non-empty string`);
      return [];
    }
    const box = boxAt({ at: `${at}.rect`, value: node["rect"] });
    if (box.isErr()) {
      appendAll({ from: browserErrorLines({ error: box.error }), into: problems });
      return [];
    }
    return [{ rect: box.value, text: node["text"] }];
  });
  const opaque = value["opaque"].flatMap((rect: unknown, index): CssRect[] => {
    const box = boxAt({ at: `pageText.opaque[${String(index)}]`, value: rect });
    if (box.isErr()) {
      appendAll({ from: browserErrorLines({ error: box.error }), into: problems });
      return [];
    }
    return [box.value];
  });
  if (problems.length > 0) {
    return err(BrowserErrors.evidenceRefused({ reasons: problems }));
  }
  return ok({ nodes, opaque, truncated: value["truncated"] === true });
}

/** The after-observation, `null` when the snippet took none, or a named refusal. */
function afterAt({ output }: { output: Record<string, unknown> }): Result<TargetObservation | null, BrowserError> {
  if (output["after"] === null) {
    return ok(null);
  }
  return parseTargetObservation({ at: "after", value: output["after"] });
}

/**
 * The whole snippet result, validated.
 *
 * @param output the snippet's parsed JSON
 * @param finalUrl where the page settled, already checked against the lease
 * @returns the result, or every field that could not be trusted
 */
export function parseEvidenceCaptureResult({
  output,
  finalUrl,
}: {
  output: Record<string, unknown>;
  finalUrl: string;
}): Result<EvidenceCaptureResult, BrowserError> {
  const problems: string[] = [];
  const need = <T>({ field }: { field: Result<T, BrowserError> }): T | null => {
    if (field.isErr()) {
      appendAll({ from: browserErrorLines({ error: field.error }), into: problems });
      return null;
    }
    return field.value;
  };
  const readiness = output["readiness"];
  if (readiness !== "ready" && readiness !== "timeout") {
    problems.push(`readiness is '${String(readiness)}', neither ready nor timeout`);
  }
  const before = need({ field: parseTargetObservation({ at: "before", value: output["before"] }) });
  const after = need({ field: afterAt({ output }) });
  const geometry = need({ field: geometryAt({ output }) });
  const elapsedMs = need({ field: numberAt({ at: "result", key: "elapsedMs", record: output }) });
  const polls = need({ field: numberAt({ at: "result", key: "polls", record: output }) });
  const pageText = need({ field: pageTextAt({ output }) });
  const screenshotError = output["screenshotError"];
  if (screenshotError !== null && typeof screenshotError !== "string") {
    problems.push("screenshotError is neither a string nor null");
  }
  if (readiness === "ready" && after === null) {
    problems.push("a ready capture must carry an after-observation");
  }
  if (problems.length > 0) {
    return err(BrowserErrors.evidenceRefused({ reasons: problems }));
  }
  return ok({
    after,
    before: before!,
    elapsedMs: elapsedMs!,
    finalUrl,
    geometry: geometry!,
    pageText,
    polls: polls!,
    readiness: readiness === "ready" ? "ready" : "timeout",
    screenshotError: typeof screenshotError === "string" ? screenshotError : null,
    screenshotWritten: output["screenshotWritten"] === true,
    title: typeof output["title"] === "string" ? output["title"] : "",
  });
}
