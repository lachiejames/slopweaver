/**
 * The typed failures of a series submission (`seriesSubmit.ts`), a union of their own per
 * `.claude/rules/error-handling.md`. Held apart so the write module stays under its file-size ceiling.
 */

/** A payload that is not a readable series submission. */
export interface SeriesPayloadInvalidError {
  readonly code: "PAYLOAD_INVALID";
  readonly message: string;
  readonly issues: readonly string[];
}

/** Backdated points were present and the caller did not state `allowLate`. */
export interface SeriesLateRefusedError {
  readonly code: "LATE_POINTS_REFUSED";
  readonly message: string;
  readonly latePointCount: number;
  readonly earliestIso: string;
}

/** Datadog answered a batch with a status that is not success. */
export interface SeriesRejectedError {
  readonly code: "SUBMIT_REJECTED";
  readonly message: string;
  readonly status: number;
  readonly submittedBatches: number;
}

/** A batch never reached Datadog at all — distinct from a rejection, and from an empty result. */
export interface SeriesUnreachableError {
  readonly code: "UNREACHABLE";
  readonly message: string;
  readonly submittedBatches: number;
}

/** Every way a series submission can fail. `code` is what a caller branches on. */
export type DatadogSubmitError =
  SeriesPayloadInvalidError | SeriesLateRefusedError | SeriesRejectedError | SeriesUnreachableError;

/** The factories the real code calls, so a test fixture is built the same way the product builds one. */
export const DatadogSubmitErrors = {
  latePointsRefused: ({
    latePointCount,
    earliestIso,
  }: {
    latePointCount: number;
    earliestIso: string;
  }): SeriesLateRefusedError => ({
    code: "LATE_POINTS_REFUSED",
    earliestIso,
    latePointCount,
    message:
      `${String(latePointCount)} point(s) predate now, the earliest at ${earliestIso}. Datadog accepts a ` +
      "backdated point only where Historical Metrics Ingestion is enabled; sent anywhere else it burns " +
      "that (timestamp, tagset) slot permanently. Pass --allow-late once `slopweaver datadog hmi --metric " +
      "<names>` reads every metric in this payload on",
  }),
  payloadInvalid: ({ issues }: { issues: readonly string[] }): SeriesPayloadInvalidError => ({
    code: "PAYLOAD_INVALID",
    issues,
    message: `the series payload cannot be submitted: ${issues.join("; ")}`,
  }),
  submitRejected: ({
    status,
    submittedBatches,
    detail,
  }: {
    status: number;
    submittedBatches: number;
    detail: string;
  }): SeriesRejectedError => ({
    code: "SUBMIT_REJECTED",
    message: `${detail} — ${String(submittedBatches)} batch(es) had already been accepted before this one`,
    status,
    submittedBatches,
  }),
  unreachable: ({
    detail,
    submittedBatches,
  }: {
    detail: string;
    submittedBatches: number;
  }): SeriesUnreachableError => ({
    code: "UNREACHABLE",
    message: `${detail} — ${String(submittedBatches)} batch(es) had already been accepted before this one`,
    submittedBatches,
  }),
} as const;
