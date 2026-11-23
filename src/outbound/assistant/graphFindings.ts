/**
 * The graph-finding image floor: an answer that reports measured numbers off a Datadog graph attaches at
 * least three distinct screenshots, or the answer form refuses it.
 *
 * ## The ruling
 *
 * A scheduled regression-hunt reply carried three leads, each with before→after figures and a Datadog link,
 * and no image at all. A number and a link make the owner open Datadog to see what the bot saw; the panels ARE
 * the evidence, and a finding the owner may forward into a channel has to stand on its own there. Under doctrine rule 7 the schema refuses the shape, never a reviewer.
 *
 * ## Why this is a floor when rule two is a question
 *
 * `./citedAndShown.ts`'s picture judgement stays a question (the owner's standing ruling): for a free-form answer, what
 * deserves a picture cannot be known in advance. This class is the opposite case — the graphs the answer
 * cites are exactly what to photograph, so there is nothing to judge, and `noPictureBecause` does not answer
 * it. `./answerArm.ts`'s images carry no cap and no general minimum (the owner's standing ruling); this is a minimum on
 * one class only.
 *
 * ## The criterion, and why it is read off the content
 *
 * A graph finding is an answer that BOTH declares at least one `measurements` entry (rule three's own record
 * that it asserts figures — "here are the numbers") AND carries a Datadog console graph view ANYWHERE in the
 * form but its `images`: a body or index link, a citation, the `answering` permalink, the grounding trail, a
 * repro. Every field was walked one at a time first, and review found a new one each round, so the walk is
 * the whole form rather than a list of fields to keep in step with it. A scheduled hunt reaches the answer form as an ordinary ask
 * (`../../live/automation/investigate.ts`), so nothing downstream knows a recipe asked it; reading the content
 * catches a tag-originated finding of the same shape as well. The graph-view path table is deliberately
 * narrower than `../../datadog/shot/targetUrl.ts`'s shottable prefixes: a pipeline, list or settings page is
 * capturable but is not a graph a measured claim rests on.
 *
 * Distinct PATHS count, so one screenshot listed three times is one picture.
 */
import { isDatadogConsoleHost } from "../../datadog/config.js";
import { formUrlsWhere } from "../artifact/datadogCitation.js";
import type { FigureMeasurement } from "./measuredFigures.js";

/**
 * How many distinct screenshots a graph finding carries at least — "at least 3 photos".
 *
 * @internal
 */
export const GRAPH_FINDING_MIN_IMAGES = 3;

/** The journalled hatch for the floor: send a graph finding with fewer screenshots. */
const UNSHOWN_GRAPHS_HATCH = "unshown-graphs";

/**
 * Console paths that ARE a graph view, matched exactly (after a trailing slash is dropped). Every surface
 * `../../datadog/ddLink.ts` links a query to is here — `/rum` was missed once, and a measured RUM finding
 * with no picture parsed clean until a review caught it.
 */
const GRAPH_PATHS: ReadonlySet<string> = new Set([
  "/logs",
  "/apm/traces",
  "/metric/explorer",
  "/metric/summary",
  "/rum",
  "/rum/explorer",
  "/rum/sessions",
]);

/**
 * Console paths that are a graph view of ONE named thing — a dashboard, a notebook, a monitor, a service page.
 * The id segment is required, so a list page (`/dashboard/lists`, `/monitors/manage`) never matches, and
 * anything UNDER the one thing is still its graph — a service operation or resource page, a dashboard slug.
 */
const GRAPH_PATH_PATTERNS: readonly RegExp[] = [
  /^\/dashboard\/(?!lists(\/|$))[^/]+(\/.*)?$/,
  /^\/notebook\/(?!list(\/|$))[^/]+(\/.*)?$/,
  /^\/monitors\/\d+(\/.*)?$/,
  /^\/apm\/services\/[^/]+(\/.*)?$/,
];

/**
 * Whether a URL opens a Datadog console GRAPH view: http(s), which the console redirects, a real console host on any site, and a path the
 * graph-view table names.
 *
 * @param url an absolute URL as the answer carries it; one that does not parse answers false
 * @returns true only for a graph view a measured claim can rest on
 * @internal
 */
export function isDatadogGraphUrl({ url }: { url: string }): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    !isDatadogConsoleHost({ hostname: parsed.hostname })
  ) {
    return false;
  }
  const path = servedPath({ pathname: parsed.pathname });
  if (path === undefined) {
    return false;
  }
  return GRAPH_PATHS.has(path) || GRAPH_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * The path a browser is served: each segment's percent-encoding undone and trailing slashes dropped. Encoding a
 * path character is legal and still opens the graph, so `/%6cogs` has to match as `/logs` or it walks past the
 * allowlist. Decoding is per SEGMENT, and a slash a segment decodes to stays `%2F`: a service tag such as
 * `team%2Fcheckout` is one segment, and decoding the whole path split it into two the service pattern refused.
 *
 * @param pathname a parsed URL pathname, still percent-encoded
 * @returns the decoded path, or undefined when its percent-encoding is malformed
 * @internal
 */
export function servedPath({ pathname }: { pathname: string }): string | undefined {
  let decoded: string;
  try {
    decoded = pathname
      .split("/")
      .map((segment) => decodeURIComponent(segment).replaceAll("/", "%2F"))
      .join("/");
  } catch {
    return undefined;
  }
  return decoded.length > 1 ? decoded.replace(/\/+$/, "") : decoded;
}

/**
 * What the floor decided about one answer.
 *
 * @internal
 */
export type GraphFindingAssessment =
  | { readonly kind: "not-graph-finding" }
  | { readonly kind: "clear"; readonly graphUrls: readonly string[]; readonly distinctImageCount: number }
  | { readonly kind: "missing-images"; readonly graphUrls: readonly string[]; readonly distinctImageCount: number };

/**
 * Every Datadog graph URL anywhere in a form value except under an `images` key, which holds picture paths. The
 * walk is `../artifact/datadogCitation.ts`'s, judged by the graph classifier: an extractor narrower than
 * `new URL` is a hole the width of the difference, and review found four such widths one at a time.
 *
 * @param value the form, or any part of it
 * @returns the graph URLs in walk order
 */
function formGraphUrls({ value }: { value: unknown }): readonly string[] {
  return formUrlsWhere({ matches: isDatadogGraphUrl, value });
}

/**
 * Judge one answer against the graph-finding floor. Pure: the caller supplies the images it will really send.
 *
 * @param form the whole answer form, walked for Datadog graph URLs in every field but `images`
 * @param images the image paths the send attaches; duplicates count once
 * @param measurements the answer's declared measurements — none, and it is not a finding of this shape
 * @returns `not-graph-finding`, or `clear`/`missing-images` with the graph URLs that made it one
 */
export function graphFindingAssessment({
  form,
  images,
  measurements,
}: {
  form: unknown;
  images: readonly string[];
  measurements: readonly FigureMeasurement[];
}): GraphFindingAssessment {
  if (measurements.length === 0) {
    return { kind: "not-graph-finding" };
  }
  const graphUrls = [...new Set(formGraphUrls({ value: form }))];
  if (graphUrls.length === 0) {
    return { kind: "not-graph-finding" };
  }
  const distinctImageCount = new Set(images).size;
  if (distinctImageCount >= GRAPH_FINDING_MIN_IMAGES) {
    return { distinctImageCount, graphUrls, kind: "clear" };
  }
  return { distinctImageCount, graphUrls, kind: "missing-images" };
}

/**
 * The refusal line for a `missing-images` assessment — one shape for every door that enforces the floor.
 *
 * @param assessment the missing-images judgement to explain
 * @returns the operator-facing refusal, naming the count, the graphs, how to capture them and the hatch
 */
export function graphFindingRefusal({
  assessment,
}: {
  assessment: Extract<GraphFindingAssessment, { kind: "missing-images" }>;
}): string {
  const shown = assessment.graphUrls.slice(0, 3).join(", ");
  const more = assessment.graphUrls.length > 3 ? ` and ${String(assessment.graphUrls.length - 3)} more` : "";
  return (
    `images: this answer reports measured figures off a Datadog graph (${shown}${more}) and attaches ` +
    `${String(assessment.distinctImageCount)} distinct screenshot(s); a graph finding carries at least ` +
    `${String(GRAPH_FINDING_MIN_IMAGES)} — each lead's before/after panel, the error-rate or latency panel, the ` +
    "log query. Take them with " +
    "`slopweaver datadog shot explorer --url <link>` and `slopweaver browser shot`, record each with " +
    "`slopweaver browser image-record`, and list them in `images`. `noPictureBecause` does not answer this. " +
    "For one deliberate exception open the journalled hatch: " +
    `\`slopweaver hatch open ${UNSHOWN_GRAPHS_HATCH} --reason "<why>"\`.`
  );
}
