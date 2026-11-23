/**
 * The typed refusals of the Friction Review page renderer (`./frictionReviewPage.ts`).
 *
 * Its own domain rather than an arm of `./errors.ts`, which scopes itself to the telemetry read: the
 * error-handling rule allows no union shared across domains. Every variant refuses to publish a page under an
 * identity the report does not carry, so nothing is published and nothing is stamped.
 */

/** The value is not a calendar day, so it names no page. */
export interface NotAReportDayError {
  readonly code: "NOT_A_REPORT_DAY";
  readonly message: string;
  readonly date: string;
}

/** The report has no `# ` heading, so the page has no title. */
export interface NoReportHeadingError {
  readonly code: "NO_REPORT_HEADING";
  readonly message: string;
}

/** The report's heading names another day than its filename, which dates the slug and the stamp. */
export interface HeadingDayMismatchError {
  readonly code: "HEADING_DAY_MISMATCH";
  readonly message: string;
  readonly heading: string;
  readonly expected: string;
}

/** Every way the renderer refuses a report. */
export type FrictionReviewPageError = HeadingDayMismatchError | NoReportHeadingError | NotAReportDayError;

/** The only constructors for {@link FrictionReviewPageError}, so a test builds one the way the code does. */
export const FrictionReviewPageErrors = {
  headingDayMismatch: ({ heading, expected }: { heading: string; expected: string }): HeadingDayMismatchError => ({
    code: "HEADING_DAY_MISMATCH",
    expected,
    heading,
    message: `the report's heading is "${heading}", not "${expected}" as its filename says`,
  }),
  noReportHeading: (): NoReportHeadingError => ({
    code: "NO_REPORT_HEADING",
    message: "the report has no `# ` heading, so the page has no title — is this a self-improvement report?",
  }),
  notAReportDay: ({ date }: { date: string }): NotAReportDayError => ({
    code: "NOT_A_REPORT_DAY",
    date,
    message: `"${date}" is not a report day (YYYY-MM-DD), so it names no friction review page`,
  }),
} as const;
