/**
 * The render-check domain's own typed error union — `notion verify`'s failures, and nothing else's.
 *
 * A union rather than the default `readonly string[]` because each of these has a DIFFERENT correction and
 * the caller acts on which it is: a document that will not parse is a re-run of the measurement, one that
 * parses but describes nothing is a page that had not finished drawing when it was measured, and an
 * unwritable output directory is a filesystem problem no re-measurement fixes.
 *
 * ## What left this union
 *
 * Every browser-shaped failure. The owner's ruling (`docs/browser-route.md`; what it retired,
 * `docs/browser-route/screenshot-reading-and-retirement.md`): nothing here
 * launches a browser, so there is no missing Chromium binary, no profile to be signed out of, and no login
 * window to time out. The page is measured in the owner's OWN Chrome by the visible session, and this verb
 * judges the document it hands back — so the failures that remain are all about that document.
 */

/** The observation document will not parse, or does not describe a render observation. */
export interface ObservationUnreadableError {
  readonly code: "OBSERVATION_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly detail: string;
}

/** The report could not be written where it was asked for. */
export interface OutputUnwritableError {
  readonly code: "OUTPUT_UNWRITABLE";
  readonly message: string;
  readonly path: string;
}

/** Every way `notion verify` can fail. */
export type NotionVerifyError = ObservationUnreadableError | OutputUnwritableError;

/** Construct one typed failure. Tests build fixtures through this, exactly as the real code does. */
export const NotionVerifyErrors = {
  observationUnreadable: ({ path, detail }: { path: string; detail: string }): ObservationUnreadableError => ({
    code: "OBSERVATION_UNREADABLE",
    detail,
    message:
      `the observation in ${path} does not describe a rendered page: ${detail}. Re-run the measurement ` +
      "step from `slopweaver notion verify <page>` in your own Chrome and pass what it returns.",
    path,
  }),
  outputUnwritable: ({ path, detail }: { path: string; detail: string }): OutputUnwritableError => ({
    code: "OUTPUT_UNWRITABLE",
    message: `the report could not be written to ${path}: ${detail}`,
    path,
  }),
} as const;
