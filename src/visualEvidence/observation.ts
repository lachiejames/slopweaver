/**
 * What an evidence capture OBSERVED about its target — measured values, never ready/pass flags.
 *
 * Every number here was read in the owner's browser by a source-owned snippet
 * (`src/browser/evidenceAdapters/datadogLogs.ts`) and validated in Node before anything is judged on it.
 * The judgement itself is `./readiness.ts`, pure, so the incident's own shape — a summary count above an
 * empty panel — is a unit test rather than a memory.
 *
 * ## Coordinates, and why the picture is the VIEWPORT rather than the page
 *
 * Every rectangle is in VIEWPORT CSS pixels — `getBoundingClientRect()` as read, with the scroll offset
 * carried beside it. The screenshot is a viewport capture, never `fullPage`, and that is a finding rather
 * than a preference. MEASURED on the incident's own Log Explorer address, through this
 * adapter: the in-page observation reported the chart drawn (9,403 canvas samples with alpha), a
 * `fullPage: true` screenshot taken in the same second showed the panel EMPTY, a second full-page shot
 * 1.5s later showed it empty again, and a plain viewport screenshot showed the bars. A full-page capture
 * emulates a taller viewport to stitch the page, the chart's canvases are re-laid-out and cleared by that
 * resize, and Chrome photographs them before they redraw. That — not a slow data request — is most likely
 * what put `6 service values found` above a white panel: the panel had probably loaded, and the capture
 * blanked it. So the frame is the viewport, the page is SCROLLED so the target and its context sit inside
 * it — the union framed is the chart, the summary line, the query and the time range, never the results
 * panel's whole box, whose bottom padding is 250 CSS px of nothing — each region's visibility is checked
 * in-page, and the scale from viewport to image pixels is the page's own `devicePixelRatio` — checked
 * against the image's size, which on the owner's zoomed Chrome is LARGER than the painted frame (`./crop.ts`
 * carries that measurement).
 */
import type { PageTextWalk } from "./frameText.js";

/**
 * Whether a region can actually be seen in the viewport as laid out.
 *
 * `clipped` is partly or wholly outside the viewport; `occluded` is inside it but covered — the Log
 * Explorer's sticky top bar covers the query editor once the page scrolls under it, and a crop of that
 * frame would carry the bar where the query should be. Judged in-page with `elementFromPoint` at the
 * region's own sample points, which is the one check that sees stacking as the compositor does.
 */
export type RegionVisibility = "visible" | "clipped" | "occluded";

/** A rectangle in viewport CSS pixels. Non-integer edges are allowed; the crop rounds outward. */
export interface CssRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The results summary the Log Explorer prints above its grouped panel, parsed.
 *
 * MEASURED on the Log Explorer (`/logs?…viz=timeseries&agg_q=service`): a populated view reads
 * `2 service values found ( based on 32 logs )`; a query matching nothing reads `0 service values found (
 * based on 0 logs )` — there is no separate "no logs" element, the zero IS the zero-state. A view whose data
 * request has not answered has no summary at all, so `null` here is "unloaded", never zero.
 */
export interface ResultsSummary {
  readonly groups: number;
  readonly logs: number;
  /** The text as rendered, capped, so a reader can check the parse. */
  readonly text: string;
  readonly rect: CssRect;
  readonly visibility: RegionVisibility;
}

/** What the chart inside the target had drawn, read from its own canvases. */
export interface ChartObservation {
  readonly canvasCount: number;
  /**
   * How many sampled pixels across the target's canvases carried any alpha at all, and how many were
   * sampled. MEASURED: the populated view's data canvas sampled 183,120 pixels and 9,403 of
   * them were drawn; the zero-results view sampled the same canvases and drew 0. Gridlines and axes are
   * DOM text and SVG on this page, not canvas ink, which is what makes ink a data witness here.
   */
  readonly inkSamples: number;
  readonly sampledPixels: number;
  /** Why the canvases could not be read, when they could not — a tainted canvas, say. Never silent. */
  readonly inkError: string | null;
  /** The chart root's rectangle, or `null` when the target had no chart yet. */
  readonly rect: CssRect | null;
  /** The chart root's visibility, or `null` when there is no chart. */
  readonly visibility: RegionVisibility | null;
}

/** One observation of the target, taken at one instant. */
export interface TargetObservation {
  readonly observedAtMs: number;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly scroll: { readonly x: number; readonly y: number };
  /** How many elements matched the target's own selector. Exactly one is the only acceptable answer. */
  readonly targetMatches: number;
  readonly targetRect: CssRect | null;
  /** `[role="progressbar"]` elements inside the target — Datadog's loading indicator. */
  readonly progressIndicators: number;
  readonly summary: ResultsSummary | null;
  readonly chart: ChartObservation;
  /** The query editor's rectangle, its rendered text (capped) and visibility, or `null` when absent. */
  readonly query: { readonly rect: CssRect; readonly text: string; readonly visibility: RegionVisibility } | null;
  /** The time-range picker's rectangle, its value (capped) and visibility, or `null` when absent. */
  readonly timeRange: { readonly rect: CssRect; readonly text: string; readonly visibility: RegionVisibility } | null;
  /** The smallest computed font size among the target's own text leaves — the feature legibility rests on. */
  readonly smallestFontPx: number | null;
  /** Milliseconds since the last request started, finished or failed, as the snippet counted them. */
  readonly networkQuietMs: number;
  readonly document: { readonly width: number; readonly height: number };
}

/** The page's dimensions as the snippet read them alongside the capture. */
export interface PageGeometry {
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly devicePixelRatio: number;
}

/**
 * Everything one evidence capture attempt returned from the browser.
 *
 * `before` is the observation taken after the page was scrolled to frame the target, immediately before
 * the shutter; `after` was taken once the screenshot returned. Both are kept because a page that moved
 * between them invalidates the picture, and `./readiness.ts`'s `stabilityIssues` is where that is decided —
 * over every required region and the after-observation's own readiness, not just the target and the chart,
 * because the crop is computed from BEFORE's rectangles.
 */
export interface EvidenceCaptureResult {
  readonly finalUrl: string;
  readonly title: string;
  readonly readiness: "ready" | "timeout";
  readonly elapsedMs: number;
  readonly polls: number;
  readonly before: TargetObservation;
  readonly after: TargetObservation | null;
  readonly geometry: PageGeometry;
  /**
   * The page's visible text, walked once the frame was final and immediately before the shutter — `null` when the
   * capture never got that far. `./frameText.ts`'s `pageFrameText` crops it to the picture.
   */
  readonly pageText: PageTextWalk | null;
  readonly screenshotWritten: boolean;
  readonly screenshotError: string | null;
}
