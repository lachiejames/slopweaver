/**
 * What proves a Datadog capture is the capture it claims to be — pure, and all that survived this lane's
 * browser being taken away.
 *
 * Owner ruling (`docs/browser-route.md`; what it retired,
 * `docs/browser-route/screenshot-reading-and-retirement.md`): nothing here launches a Chromium or keeps a profile.
 * The console is opened in the owner's own Chrome by the visible session, which reports back what it saw;
 * this module judges that report. The judgement never moved, and that is deliberate — the reason this verb
 * exists at all is that **a capture is graded before it is reported**, and a grade that ran in the same
 * place the picture came from is a grade nobody can check.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { type DatadogShotError, DatadogShotErrors } from "./errors.js";

/** `to - from` for a genuine seven-day backtest, in seconds. Datadog's own picker produces this exactly. */
export const SEVEN_DAYS_SECONDS = 604800;

/**
 * How far a preview's span may drift from seven days and still count — UI rounding, nothing more.
 * @internal
 */
export const SEVEN_DAYS_TOLERANCE_SECONDS = 60;

/**
 * The console's own evaluation endpoint, whose query string carries the window the panel was computed over.
 *
 * It is the only place that window is stated as a fact rather than as a label, which is why a capture's
 * proof is graded from the network rather than from the picker's text. The capture snippet
 * (`browser/datadogMonitorBacktestSnippet.ts`) matches responses on this same constant.
 */
export const EVALUATION_PREVIEW_PATH = "/api/ui/monitor/evaluation_preview";

/**
 * Whether a URL is an evaluation-preview call whose span is a genuine seven days.
 *
 * @param url the request URL the console issued
 * @returns `true` when this call evaluated a seven-day window
 */
export function isSevenDayPreviewUrl({ url }: { url: string }): boolean {
  const span = previewSpanSeconds({ url });
  return span !== null && Math.abs(span - SEVEN_DAYS_SECONDS) <= SEVEN_DAYS_TOLERANCE_SECONDS;
}

/**
 * The span, in seconds, one evaluation-preview call covered.
 *
 * @param url the request URL the console issued
 * @returns the span, or `null` when this is not a readable evaluation-preview call
 */
export function previewSpanSeconds({ url }: { url: string }): number | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!parsed.pathname.endsWith(EVALUATION_PREVIEW_PATH)) {
    return null;
  }
  const rawFrom = parsed.searchParams.get("from");
  const rawTo = parsed.searchParams.get("to");
  // Checked for absence BEFORE conversion: `Number(null)` is 0, so a preview carrying no bounds would read
  // as a zero-second span — and `judgeWindowProof` would then refuse a perfectly good capture on the
  // strength of a window the console never named. Caught by its own unit test rather than in the field.
  if (rawFrom === null || rawTo === null) {
    return null;
  }
  const from = Number(rawFrom);
  const to = Number(rawTo);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }
  return to - from;
}

/**
 * Which proof of the captured window this run actually obtained.
 * @internal
 */
export type WindowProof = "evaluation-preview" | "picker-value";

/**
 * Judge the window from what the console evaluated, falling back to what the picker displayed.
 *
 * Stated as a returned GRADE rather than folded into a boolean, because the two are not equally strong and a
 * reader of the result deserves to know which one they got. A vendor that renames the preview endpoint
 * degrades this to the picker's own value instead of failing every capture — but a preview that IS observed
 * and is not seven days is a hard refusal, because that is the console telling us the panel on screen was
 * computed over something else.
 *
 * @param spans every evaluation-preview span this capture observed, in seconds
 * @returns which proof was obtained, or the refusal when the console evaluated a different window
 */
export function judgeWindowProof({ spans }: { spans: readonly number[] }): Result<WindowProof, DatadogShotError> {
  if (spans.length === 0) {
    return ok("picker-value");
  }
  if (spans.some((span) => Math.abs(span - SEVEN_DAYS_SECONDS) <= SEVEN_DAYS_TOLERANCE_SECONDS)) {
    return ok("evaluation-preview");
  }
  const closest = spans.reduce((best, span) =>
    Math.abs(span - SEVEN_DAYS_SECONDS) < Math.abs(best - SEVEN_DAYS_SECONDS) ? span : best,
  );
  return err(DatadogShotErrors.previewWindowWrong({ expectedSeconds: SEVEN_DAYS_SECONDS, observedSeconds: closest }));
}

/**
 * Whether the address the browser is standing on is Datadog's sign-in wall rather than the console.
 *
 * Judged by leaving the console host as much as by the login path, because the wall is usually an identity
 * provider on another host entirely — a check that only knew `/account/login` would report a Google consent
 * screen as "the view did not draw".
 *
 * @param url the address the browser settled on
 * @param consoleHost the console host this install is configured for
 * @returns `true` when this is a sign-in wall rather than the console
 */
export function isDatadogSignInWall({ url, consoleHost }: { url: string; consoleHost: string }): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.host !== consoleHost) {
    return true;
  }
  return /^\/account\/(login|saml)/.test(parsed.pathname);
}
