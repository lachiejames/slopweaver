/**
 * How a driven-browser walk verb REPORTS what it did, shared by every atlas that runs one.
 *
 * ## No URL is ever printed, in either shape
 *
 * Both atlases running a page walk address URLs that carry a private identifier — a Notion workspace slug, a
 * Xero organisation short code. Both report shapes therefore name the declared SURFACE and its outcome and
 * never the address, so redirecting a walk verb's output into a file cannot put one somewhere it does not
 * belong. A sibling verb claims its tenant root never leaves the process while serialising every requested
 * and final URL under `--json`; that is the shape this exists to make unrepeatable rather than re-argued.
 */
import type { PageObservation } from "../../../atlas/kit/pageWalk.js";

/** The one word a page's row leads with. */
function pageVerdict<TCall>({ page }: { page: PageObservation<TCall> }): string {
  if (!page.attempted) {
    return "NOT-ATTEMPTED";
  }
  if (page.unreachableBecause !== null) {
    return "UNREACHABLE";
  }
  return page.screenshotMissingBecause === null ? "held" : "NO-SCREENSHOT";
}

/**
 * One page's row: the declared surface and what became of it — never its URL.
 *
 * @param page the observation to render
 * @returns the line, carrying the verdict, the call and body counts, and every reason the page is not held
 */
export function pageLine<TCall>({ page }: { page: PageObservation<TCall> }): string {
  const reach = pageVerdict({ page });
  const counts = `${String(page.responseAccounting.bodySucceeded)} kept / ${String(page.responseAccounting.eligible)} eligible`;
  const why = page.unreachableBecause === null ? "" : ` — ${page.unreachableBecause}`;
  const shot = page.screenshotMissingBecause === null ? "" : ` — ${page.screenshotMissingBecause}`;
  return `  ${page.surface.padEnd(28)} ${reach.padEnd(14)} ${String(page.calls.length)} call(s), ${counts}${why}${shot}`;
}

/**
 * What the `--json` shape carries for one page: the surface and its verdict, with every URL deliberately
 * absent.
 *
 * @param page the observation to render
 * @returns the serialisable row
 */
export function jsonPage<TCall>({ page }: { page: PageObservation<TCall> }): Record<string, unknown> {
  return {
    attempted: page.attempted,
    callCount: page.calls.length,
    captureComplete: page.captureComplete,
    redirected: page.redirected,
    responseAccounting: page.responseAccounting,
    screenshotMissingBecause: page.screenshotMissingBecause,
    statusCode: page.statusCode,
    surface: page.surface,
    unreachableBecause: page.unreachableBecause,
  };
}
