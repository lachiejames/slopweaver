/**
 * The typed failures of `reflect friction-review` (`./frictionReviewRun.ts`) once its flags parsed.
 *
 * Its own domain: the page renderer's refusals (`../../../reflect/frictionReviewPageErrors.ts`) are carried
 * inside one variant rather than merged, because the error-handling rule allows no union shared across
 * domains. Every message is the whole line the verb prints, and every variant raised before the stamp says
 * nothing was stamped, because that is what a caller has to know to recover: run it again.
 */
import { errorMessage } from "../../../lib/errorMessage.js";
import type { FrictionReviewPageError } from "../../../reflect/frictionReviewPageErrors.js";

/** `$home/morning` exists but could not be listed — never read as "no report". */
export interface ReportsUnlistableError {
  readonly code: "REPORTS_UNLISTABLE";
  readonly message: string;
  readonly dir: string;
}

/** A closing flag ran on a home that never wrote a report. */
export interface NoReportError {
  readonly code: "NO_REPORT";
  readonly message: string;
}

/** The newest report could not be read. */
export interface ReportUnreadableError {
  readonly code: "REPORT_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The renderer refused the report, so no page and no stamp. */
export interface PageRefusedError {
  readonly code: "PAGE_REFUSED";
  readonly message: string;
  readonly path: string;
  readonly refusal: FrictionReviewPageError;
}

/** `publishPage` could not write or freeze the page. */
export interface PublishFailedError {
  readonly code: "PUBLISH_FAILED";
  readonly message: string;
  readonly issues: readonly string[];
}

/** The stamp could not be written; a page this run published is named, since it does exist. */
export interface StampUnwritableError {
  readonly code: "STAMP_UNWRITABLE";
  readonly message: string;
  readonly pageUrl: string | null;
}

/** Every way the verb stops after its flags parsed. */
export type FrictionReviewRunError =
  | NoReportError
  | PageRefusedError
  | PublishFailedError
  | ReportUnreadableError
  | ReportsUnlistableError
  | StampUnwritableError;

/** The `--republish` stage's own prefix and its recovery fact, on every failure before the stamp. */
function republishLine({ detail }: { detail: string }): string {
  return `reflect friction-review --republish: ${detail} — nothing was stamped`;
}

/** The only constructors for {@link FrictionReviewRunError}, so a test builds one the way the code does. */
export const FrictionReviewRunErrors = {
  noReport: (): NoReportError => ({
    code: "NO_REPORT",
    message:
      "reflect friction-review: no report exists under $SLOPWEAVER_HOME/morning yet — nothing to publish or stamp",
  }),
  pageRefused: ({ path, refusal }: { path: string; refusal: FrictionReviewPageError }): PageRefusedError => ({
    code: "PAGE_REFUSED",
    message: republishLine({ detail: `${path}: ${refusal.message}` }),
    path,
    refusal,
  }),
  publishFailed: ({ issues }: { issues: readonly string[] }): PublishFailedError => ({
    code: "PUBLISH_FAILED",
    issues,
    message: republishLine({ detail: `the page was not published: ${issues.join("; ")}` }),
  }),
  reportUnreadable: ({ path, cause }: { path: string; cause: unknown }): ReportUnreadableError => ({
    code: "REPORT_UNREADABLE",
    message: republishLine({ detail: `could not read the report at ${path}: ${errorMessage({ error: cause })}` }),
    path,
  }),
  reportsUnlistable: ({ dir, cause }: { dir: string; cause: unknown }): ReportsUnlistableError => ({
    code: "REPORTS_UNLISTABLE",
    dir,
    message: `reflect friction-review: could not list the reports under ${dir}: ${errorMessage({ error: cause })}`,
  }),
  stampUnwritable: ({ cause, pageUrl }: { cause: unknown; pageUrl: string | null }): StampUnwritableError => ({
    code: "STAMP_UNWRITABLE",
    message:
      `reflect friction-review: could not write the stamp: ${errorMessage({ error: cause })}` +
      (pageUrl === null ? "" : ` — the page itself was published at ${pageUrl}`),
    pageUrl,
  }),
} as const;
