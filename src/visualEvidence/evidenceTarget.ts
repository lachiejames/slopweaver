/**
 * The CLOSED set of things `browser shot` knows how to wait for and crop to — an adapter id and a target
 * id, never a selector.
 *
 * ## Why a caller chooses from an enum and cannot name a selector
 *
 * An incident image was once a Log Explorer page whose facet sidebar had finished rendering
 * (`Showing 251 of 251`) while the results panel under `6 service values found` had not. A caller allowed to
 * say "wait for `.sidebar`" could certify that page as loaded and be telling the truth about the sidebar.
 * JSON escaping solves injection, not evidence selection. So what a caller
 * may pick is which SOURCE-OWNED target to certify, and the selectors, the readiness predicate and the
 * context regions for it are all fixed in `src/browser/evidenceAdapters/`. Adding a target here is adding
 * an adapter module and its measured fixture, never a string.
 *
 * ## How a target is inferred, and when a caller must say
 *
 * `inferEvidenceTarget` reads the address: a Datadog Log Explorer or Trace Explorer URL whose `viz` is
 * `timeseries` resolves without a flag, each to its own adapter. An unstated `viz` is the console's LIST
 * view, which no adapter covers yet, so it is `unsupported` like everything else — reported by name, never
 * answered with a full-page picture, because the incident was a full-page picture reported as success. A
 * citation is a list view by construction, so `live/automation/digestShots.ts` is what rewrites one to the
 * timeseries address a capture can be taken of.
 */
import { err, ok, type Result } from "#lib/result.js";
import { type VisualEvidenceError, VisualEvidenceErrors } from "./evidenceErrors.js";

/**
 * The adapters that exist. Two: one console, two explorers, measured separately
 * (`src/browser/evidenceAdapters/`).
 * @internal — a field type of {@link EvidenceTarget}.
 */
export type EvidenceAdapterId = "datadog-logs-v1" | "datadog-apm-traces-v1";

/**
 * What an explorer capture may certify. `timeseries` is the incident's own view, and it is the view a
 * digest's citation is rewritten to — a list of rows photographs as a wall of text nobody can read.
 * @internal — a field type of {@link EvidenceTarget}.
 */
export type DatadogExplorerTargetId = "timeseries";

/** One closed adapter-and-target pair. */
export interface EvidenceTarget {
  readonly adapterId: EvidenceAdapterId;
  readonly targetId: DatadogExplorerTargetId;
}

/** Every target this build can capture, spelled the way `--target` takes it. */
export const EVIDENCE_TARGET_IDS: readonly string[] = [
  "datadog-logs-v1:timeseries",
  "datadog-apm-traces-v1:timeseries",
];

/**
 * The `--target` spelling of one target.
 *
 * @returns `adapter:target`
 */
export function evidenceTargetLabel({ target }: { target: EvidenceTarget }): string {
  return `${target.adapterId}:${target.targetId}`;
}

/**
 * Parse a `--target` value against the closed set.
 *
 * @param text the raw flag value, `adapter:target`
 * @returns the target, or the refusal naming every id that exists
 */
export function parseEvidenceTarget({ text }: { text: string }): Result<EvidenceTarget, VisualEvidenceError> {
  if (text === "datadog-logs-v1:timeseries") {
    return ok({ adapterId: "datadog-logs-v1", targetId: "timeseries" });
  }
  if (text === "datadog-apm-traces-v1:timeseries") {
    return ok({ adapterId: "datadog-apm-traces-v1", targetId: "timeseries" });
  }
  return err(VisualEvidenceErrors.unknownTarget({ got: text, known: EVIDENCE_TARGET_IDS }));
}

/** Datadog's console hosts, every region: `app.datadoghq.com`, `us3.datadoghq.com`, `app.datadoghq.eu`. */
const DATADOG_HOST = /^(app|ap\d|us\d|eu\d?)\.datadoghq\.(com|eu)$/;

/**
 * Which target an address implies, when it implies exactly one.
 *
 * @param url the absolute address `browser shot` was given
 * @returns the target, or `null` when the address is not one any adapter covers
 */
export function inferEvidenceTarget({ url }: { url: string }): EvidenceTarget | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!DATADOG_HOST.test(parsed.hostname) || parsed.searchParams.get("viz") !== "timeseries") {
    return null;
  }
  if (parsed.pathname === "/logs") {
    return { adapterId: "datadog-logs-v1", targetId: "timeseries" };
  }
  if (parsed.pathname === "/apm/traces") {
    return { adapterId: "datadog-apm-traces-v1", targetId: "timeseries" };
  }
  return null;
}

/**
 * The page zoom one adapter's page is photographed at, as a CSS `zoom` factor.
 *
 * MEASURED on the owner's own Chrome, whose window is 1512x662 CSS pixels. NEITHER explorer's evidence
 * stack fits it. The Trace Explorer's is the taller: the picker sits at y=97, the query editor wraps to 177px,
 * and the visualization panel runs from y=427 to y=984, so the union is 887 CSS pixels tall against 662 of
 * viewport, and every capture reported `chart (clipped)` with nothing to scroll to — the framing refuses
 * to scroll a union that cannot fit. The two ways out of that both failed or do not exist:
 * `Emulation.setDeviceMetricsOverride` answers `Target.attachToBrowserTarget: Not allowed` through the
 * extension relay, and the window is the owner's.
 *
 * So the page is zoomed for the shutter, which is layout rather than emulation, and 0.7 was the factor
 * measured to fit: the capture came back `data`, framed, with `10.1px smallest feature once fitted to
 * slack-desktop-expanded-v1 — passes`. A zoom that blanked the chart's canvases could not ship anyway —
 * the readiness loop demands drawn ink in two consecutive stable observations, which is the same gate that
 * catches every other blank.
 *
 * The Log Explorer is the same story, measured on the Knock and integrity-audit
 * citations: grouped, ready in 7.3s, and refused at
 * `chart (clipped)` until it was zoomed too. The factor is the same 0.7 for both rather than tuned per
 * page — the constraint is the owner's window, which both pages share.
 */
const CAPTURE_ZOOM: Readonly<Record<EvidenceAdapterId, number>> = {
  "datadog-apm-traces-v1": 0.7,
  "datadog-logs-v1": 0.7,
};

/**
 * The zoom this target's page is photographed at.
 *
 * @param target the closed target
 * @returns the CSS `zoom` factor, 1 when the page is photographed as it stands
 */
export function captureZoomFor({ target }: { target: EvidenceTarget }): number {
  return CAPTURE_ZOOM[target.adapterId];
}
