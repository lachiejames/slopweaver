/**
 * Whether a target had RENDERED when the shutter fired — judged on measured observations, in Node, pure.
 *
 * ## The four states, and the one the incident was
 *
 * `6 service values found (based on 100,794 logs)` above a white panel is `empty-panel`: the summary
 * request had answered and the chart's had not. `zero-results` is a summary of `0 … based on 0 logs`
 * with a chart that drew nothing, which is the honest answer to a query matching nothing. `unloaded` is no
 * summary at all. `data` is a positive count AND drawn canvas ink. A positive count with no ink, or a zero
 * count with ink, is a CONFLICT and refuses — the two witnesses disagree and neither is trusted alone.
 *
 * ## Every threshold carries the measurement that set it
 *
 * `MIN_INK_SAMPLES` is 50 against a measured 9,403 for a 32-log series over 15 days and 0 for the
 * zero-results view (`src/visualEvidence/observation.ts` § ChartObservation carries the run). Reproduce
 * with `slopweaver browser shot --url <log explorer timeseries url> --json` and read `observation.chart`.
 * `MIN_NETWORK_QUIET_MS` is 1,500 against measured quiet windows of 2,737ms (populated) and 5,001ms (zero)
 * once the console had answered, and 21-208ms while it was still fetching.
 */
import { absentAsNull } from "#lib/absent.js";
import type { CssRect, RegionVisibility, TargetObservation } from "./observation.js";
import type { TargetState } from "./types.js";

/** The fewest drawn canvas samples that count as "the chart drew something". */
export const MIN_INK_SAMPLES = 50;

/** How long the network must have been silent for a page to count as settled. */
export const MIN_NETWORK_QUIET_MS = 1_500;

/**
 * How far, in CSS pixels, a rectangle may move between two observations and still be "the same".
 * @internal
 */
export const MAX_RECT_DRIFT_CSS_PX = 1;

/** Why an observation is not ready. A closed set, so a report can name one rather than narrate. */
export type ReadinessIssue =
  | { readonly code: "TARGET_ABSENT"; readonly message: string }
  | { readonly code: "TARGET_AMBIGUOUS"; readonly message: string; readonly matches: number }
  | { readonly code: "STILL_LOADING"; readonly message: string; readonly indicators: number }
  | { readonly code: "NETWORK_ACTIVE"; readonly message: string; readonly quietMs: number }
  | { readonly code: "SUMMARY_ABSENT"; readonly message: string }
  | { readonly code: "CHART_ABSENT"; readonly message: string }
  | { readonly code: "CHART_UNREADABLE"; readonly message: string }
  | { readonly code: "EMPTY_PANEL"; readonly message: string; readonly groups: number }
  | { readonly code: "CONFLICTING_WITNESSES"; readonly message: string }
  | { readonly code: "CONTEXT_ABSENT"; readonly message: string; readonly missing: readonly string[] }
  | { readonly code: "REGION_NOT_VISIBLE"; readonly message: string; readonly regions: readonly string[] };

/**
 * Which of the four states an observation is in, judged on the summary and the canvas ink together.
 *
 * `conflicting` is the fifth answer and it is a refusal: the summary says data and the chart drew none, or
 * the summary says none and the chart drew something.
 *
 * @param observation one reading of the target
 * @returns the state, or `conflicting`
 */
export function targetStateOf({ observation }: { observation: TargetObservation }): TargetState | "conflicting" {
  if (observation.summary === null) {
    return "unloaded";
  }
  const groups = observation.summary.groups;
  if (observation.chart.rect === null || observation.chart.canvasCount === 0) {
    return groups > 0 ? "empty-panel" : "unloaded";
  }
  const drew = observation.chart.inkSamples >= MIN_INK_SAMPLES;
  if (groups > 0 && drew) {
    return "data";
  }
  // Zero-results needs ZERO ink, not merely less than the positive floor. Confirmed by running this function: a 0/0 summary with 1-49 drawn samples read `zero-results`,
  // which is a chart that drew SOMETHING while its own summary counted nothing — the two witnesses
  // disagreeing, which is what `conflicting` is for. MEASURED on the live console the honest zero view draws
  // exactly 0 of 6,429 sampled pixels, so nothing legitimate sits in that band.
  if (groups === 0 && observation.summary.logs === 0 && observation.chart.inkSamples === 0) {
    return "zero-results";
  }
  if (groups > 0 && !drew) {
    return "empty-panel";
  }
  return "conflicting";
}

/**
 * Everything that stops one observation from being the one a picture is taken on.
 *
 * Empty means ready: exactly one target, no loading indicator inside it, the network quiet for
 * {@link MIN_NETWORK_QUIET_MS}, a summary present, a chart present, and the two witnesses agreeing on either
 * `data` or `zero-results`. Both context controls (query, time range) must be on the page, because a crop
 * that cannot include them is `context-lost` before it is taken — and every region must be wholly VISIBLE
 * in the viewport as scrolled, neither clipped by its edge nor under a sticky bar.
 *
 * @param observation one reading of the target
 * @returns every issue, in the order a reader would check them; empty when ready
 */
export function readinessIssues({ observation }: { observation: TargetObservation }): readonly ReadinessIssue[] {
  if (observation.targetMatches === 0 || observation.targetRect === null) {
    return [{ code: "TARGET_ABSENT", message: "the target's own element is not on the page" }];
  }
  return [
    ...presenceIssues({ observation }),
    ...stateIssues({ observation }),
    ...contextIssues({ observation }),
    ...visibilityIssues({ observation }),
  ];
}

/** Ambiguity, loading indicators, network activity, a missing summary or chart, an unreadable chart. */
function presenceIssues({ observation }: { observation: TargetObservation }): readonly ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  if (observation.targetMatches > 1) {
    issues.push({
      code: "TARGET_AMBIGUOUS",
      matches: observation.targetMatches,
      message: `${String(observation.targetMatches)} elements match the target; exactly one is certifiable`,
    });
  }
  if (observation.progressIndicators > 0) {
    issues.push({
      code: "STILL_LOADING",
      indicators: observation.progressIndicators,
      message: `${String(observation.progressIndicators)} loading indicator(s) inside the target`,
    });
  }
  if (observation.networkQuietMs < MIN_NETWORK_QUIET_MS) {
    issues.push({
      code: "NETWORK_ACTIVE",
      message: `a request moved ${String(observation.networkQuietMs)}ms ago; ${String(MIN_NETWORK_QUIET_MS)}ms of quiet is the floor`,
      quietMs: observation.networkQuietMs,
    });
  }
  if (observation.summary === null) {
    issues.push({
      code: "SUMMARY_ABSENT",
      message: "no results summary has rendered, so the data request has not answered",
    });
  }
  if (observation.chart.rect === null || observation.chart.canvasCount === 0) {
    issues.push({ code: "CHART_ABSENT", message: "no chart has rendered inside the target" });
  }
  if (observation.chart.inkError !== null) {
    issues.push({
      code: "CHART_UNREADABLE",
      message: `the chart's canvases could not be read: ${observation.chart.inkError}`,
    });
  }
  return issues;
}

/** The two-witness verdict: the incident's empty panel, or witnesses that disagree. */
function stateIssues({ observation }: { observation: TargetObservation }): readonly ReadinessIssue[] {
  const state = targetStateOf({ observation });
  if (observation.summary === null) {
    return [];
  }
  if (state === "empty-panel" && observation.chart.inkError === null) {
    return [
      {
        code: "EMPTY_PANEL",
        groups: observation.summary.groups,
        message: `the summary counts ${String(observation.summary.groups)} group(s) and the chart drew nothing — an empty panel its own summary contradicts`,
      },
    ];
  }
  if (state === "conflicting" && observation.chart.rect !== null) {
    return [{ code: "CONFLICTING_WITNESSES", message: "the summary and the drawn chart disagree" }];
  }
  return [];
}

/** The context controls a crop must include, when they are not on the page at all. */
function contextIssues({ observation }: { observation: TargetObservation }): readonly ReadinessIssue[] {
  const missing: string[] = [];
  if (observation.query === null) {
    missing.push("query");
  }
  if (observation.timeRange === null) {
    missing.push("time range");
  }
  if (missing.length === 0) {
    return [];
  }
  return [{ code: "CONTEXT_ABSENT", message: `not on the page: ${missing.join(", ")}`, missing }];
}

/** Every region present but clipped by the viewport's edge or under a sticky bar. */
function visibilityIssues({ observation }: { observation: TargetObservation }): readonly ReadinessIssue[] {
  const regions: readonly (readonly [string, RegionVisibility | null])[] = [
    ["chart", observation.chart.visibility],
    ["summary", observation.summary === null ? null : observation.summary.visibility],
    ["query", observation.query === null ? null : observation.query.visibility],
    ["time range", observation.timeRange === null ? null : observation.timeRange.visibility],
  ];
  const hidden = regions
    .filter(([, visibility]) => visibility !== null && visibility !== "visible")
    .map(([name, visibility]) => `${name} (${String(visibility)})`);
  if (hidden.length === 0) {
    return [];
  }
  return [
    {
      code: "REGION_NOT_VISIBLE",
      message: `not wholly visible in the viewport as scrolled: ${hidden.join(", ")}`,
      regions: hidden,
    },
  ];
}

/** Whether two rectangles are the same place within {@link MAX_RECT_DRIFT_CSS_PX}. */
function sameRect({ a, b }: { a: CssRect | null; b: CssRect | null }): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  const drift = Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.width - b.width),
    Math.abs(a.height - b.height),
  );
  return drift <= MAX_RECT_DRIFT_CSS_PX;
}

/**
 * What changed between the observation the picture was taken on and the one taken after it.
 *
 * A full-page screenshot is a stitch over time, so a page that grew, reflowed or went back to loading
 * during it is a picture of two pages — the incident's second image rendered the whole console chrome
 * twice. Nothing here proves the browser never moved; it proves it was not seen to.
 *
 * @param before the observation the capture was judged ready on
 * @param after the observation taken once the screenshot returned
 * @returns every difference that invalidates the picture; empty when none was seen
 */
export function stabilityIssues({
  before,
  after,
}: {
  before: TargetObservation;
  after: TargetObservation;
}): readonly string[] {
  const issues: string[] = [...movedRegions({ after, before })];
  if (before.document.width !== after.document.width || before.document.height !== after.document.height) {
    issues.push(
      `the document changed size during the capture: ${String(before.document.width)}x${String(before.document.height)} ` +
        `then ${String(after.document.width)}x${String(after.document.height)}`,
    );
  }
  if (before.scroll.x !== after.scroll.x || before.scroll.y !== after.scroll.y) {
    issues.push("the page scrolled during the capture");
  }
  if (targetStateOf({ observation: before }) !== targetStateOf({ observation: after })) {
    issues.push("the target's state changed during the capture");
  }
  const afterIssues = readinessIssues({ observation: after });
  if (afterIssues.length > 0) {
    issues.push(
      `the target stopped being ready during the capture: ${afterIssues.map((issue) => issue.message).join("; ")}`,
    );
  }
  return issues;
}

/**
 * Every required region that moved, changed text, or stopped being visible between the two observations.
 *
 * All four are checked, not just the target and the chart. Executing this module against its own fixture shows why: moving the AFTER query to `y: 900` and marking it `clipped`
 * produced no issue at all, while the crop is computed from the BEFORE rectangles — so the picture would
 * have carried whatever had scrolled into the query's old position, captioned as the query.
 *
 * @param before the observation the capture was judged ready on
 * @param after the observation taken once the screenshot returned
 * @returns one line per region that did not hold still
 */
function movedRegions({ before, after }: { before: TargetObservation; after: TargetObservation }): readonly string[] {
  const issues: string[] = [];
  const pairs: readonly (readonly [string, CssRect | null, CssRect | null])[] = [
    ["target", before.targetRect, after.targetRect],
    ["chart", before.chart.rect, after.chart.rect],
    ["summary", absentAsNull({ value: before.summary?.rect }), absentAsNull({ value: after.summary?.rect })],
    ["query", absentAsNull({ value: before.query?.rect }), absentAsNull({ value: after.query?.rect })],
    ["time range", absentAsNull({ value: before.timeRange?.rect }), absentAsNull({ value: after.timeRange?.rect })],
  ];
  for (const [name, a, b] of pairs) {
    if (!sameRect({ a, b })) {
      issues.push(`the ${name} moved, resized or disappeared during the capture`);
    }
  }
  const texts: readonly (readonly [string, string | undefined, string | undefined])[] = [
    ["query", before.query?.text, after.query?.text],
    ["time range", before.timeRange?.text, after.timeRange?.text],
    ["summary", before.summary?.text, after.summary?.text],
  ];
  for (const [name, a, b] of texts) {
    if (a !== b) {
      issues.push(`the ${name} text changed during the capture`);
    }
  }
  return issues;
}
