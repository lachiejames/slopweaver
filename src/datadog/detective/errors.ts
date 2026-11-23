/**
 * The typed failures of building and reading a Datadog shape catalogue.
 *
 * Its own union rather than the default `Result<T>` because callers genuinely branch here: a catalogue that
 * has never been built is a routing decision (`store detect` gates on Datadog having something to say, so an
 * absent catalogue means "do not fan a detective there" rather than "report an error"), while a catalogue
 * whose file will not parse is a fault that has to surface. Those two cannot share a message string.
 */

/** No catalogue has been built under this home. */
export interface CatalogueAbsentError {
  readonly code: "CATALOGUE_ABSENT";
  readonly message: string;
  readonly path: string;
}

/** A catalogue file exists but does not hold what a catalogue holds. */
export interface CatalogueUnreadableError {
  readonly code: "CATALOGUE_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause?: unknown;
}

/** A Datadog call the build or the ladder depends on did not come back usable. */
export interface DatadogCallFailedError {
  readonly code: "DATADOG_CALL_FAILED";
  readonly message: string;
  /** Which call, named the way the reproduce line names it. */
  readonly what: string;
  readonly cause?: unknown;
}

/** The window the caller asked for reaches past what the index retains. */
export interface WindowPastRetentionError {
  readonly code: "WINDOW_PAST_RETENTION";
  readonly message: string;
  readonly requestedDays: number;
  readonly retainedDays: number;
}

/** Every way the catalogue and the ladder fail. */
export type DatadogDetectiveError =
  CatalogueAbsentError | CatalogueUnreadableError | DatadogCallFailedError | WindowPastRetentionError;

/** Construct one failure. Tests build fixtures through these, never through a hand-written literal. */
export const DatadogDetectiveErrors = {
  catalogueAbsent: ({ path }: { path: string }): CatalogueAbsentError => ({
    code: "CATALOGUE_ABSENT",
    message: `no Datadog shape catalogue at ${path} — build one with \`slopweaver datadog catalogue build\``,
    path,
  }),
  catalogueUnreadable: ({ path, cause }: { path: string; cause: unknown }): CatalogueUnreadableError => ({
    cause,
    code: "CATALOGUE_UNREADABLE",
    message: `the Datadog shape catalogue at ${path} could not be read as one — rebuild it with \`slopweaver datadog catalogue build\``,
    path,
  }),
  callFailed: ({ what, cause }: { what: string; cause: unknown }): DatadogCallFailedError => ({
    cause,
    code: "DATADOG_CALL_FAILED",
    message: `${what} did not come back usable: ${cause instanceof Error ? cause.message : String(cause)}`,
    what,
  }),
  windowPastRetention: ({
    requestedDays,
    retainedDays,
  }: {
    requestedDays: number;
    retainedDays: number;
  }): WindowPastRetentionError => ({
    code: "WINDOW_PAST_RETENTION",
    message:
      `a ${String(requestedDays)}-day window reaches past this index's ${String(retainedDays)}-day retention. ` +
      'A zero for an older window means "not retained", never "no events" — narrow the window rather than believing the count.',
    requestedDays,
    retainedDays,
  }),
} as const;
