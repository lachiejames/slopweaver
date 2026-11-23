/**
 * The typed failure union for an alert-probe set, beside the package's other bounded unions — config
 * (`configErrors.ts`), query (`queryErrors.ts`, `metricsScalarErrors.ts`), domain (`domainErrors.ts`) and
 * citation (`citationErrors.ts`) — and deliberately not merged into any of them.
 *
 * A probe set is read from a file somebody outside the repository wrote, so its failures are
 * genuinely distinct facts — the document is not JSON, the document is JSON but not a probe set, a probe
 * declares a shape its kind cannot serve — and each one has a different fix. A caller that can only print
 * the message still can; a caller deciding whether to retry, refuse or report can branch on `code`.
 *
 * The second reason it is a union rather than four more strings is mechanical: `error-shape-threshold`
 * refuses a directory past four plain shapes authored into an `err`, so a new one here would fail
 * `yarn lint` by construction. The gate and the design point the same way.
 */

/** The `--probes` document is not JSON at all, or was too large to parse. */
export interface ProbeDocumentUnreadableError {
  readonly code: "PROBE_DOCUMENT_UNREADABLE";
  readonly message: string;
  readonly detail: string;
}

/** The document parsed as JSON but is not a probe set. */
export interface ProbeSetInvalidError {
  readonly code: "PROBE_SET_INVALID";
  readonly message: string;
  readonly issues: readonly string[];
}

/** One probe declares a field its own kind cannot use, or omits one that kind requires. */
export interface ProbeShapeMismatchError {
  readonly code: "PROBE_SHAPE_MISMATCH";
  readonly message: string;
  readonly probeId: string;
}

/** The set declares more probes than one card can carry, so some finding would be dropped unseen. */
export interface ProbeSetTooLargeError {
  readonly code: "PROBE_SET_TOO_LARGE";
  readonly message: string;
  readonly declared: number;
  readonly cap: number;
}

/**
 * A probe's aggregate came back, and the number is not one a card row can carry.
 *
 * A digest row's count is `.int().min(0)` (`outbound/artifact/digestFields.ts`), and a facet sum or a non-count
 * metric aggregation can legitimately return a fraction. Caught as its own fact so the run says which probe
 * and what it returned, rather than the door refusing the whole card on a schema error nobody can act on.
 */
export interface ProbeReadingNotCountableError {
  readonly code: "PROBE_READING_NOT_COUNTABLE";
  readonly message: string;
  readonly probeId: string;
  readonly value: number;
}

/** Two probes in one set carry the same id, so a reader cannot tell their rows apart. */
export interface ProbeIdDuplicatedError {
  readonly code: "PROBE_ID_DUPLICATED";
  readonly message: string;
  readonly probeId: string;
}

/** Every way a probe set can fail to become a runnable investigation. */
export type AlertProbeError =
  | ProbeDocumentUnreadableError
  | ProbeSetInvalidError
  | ProbeSetTooLargeError
  | ProbeShapeMismatchError
  | ProbeReadingNotCountableError
  | ProbeIdDuplicatedError;

/**
 * Construct one {@link AlertProbeError}. Tests build fixtures through these, never a hand-built literal,
 * so a factory that stops matching its own type reddens a test rather than shipping.
 */
export const AlertProbeErrors = {
  documentUnreadable: ({ detail }: { readonly detail: string }): ProbeDocumentUnreadableError => ({
    code: "PROBE_DOCUMENT_UNREADABLE",
    detail,
    message: `the probe document could not be read as JSON: ${detail}`,
  }),
  idDuplicated: ({ probeId }: { readonly probeId: string }): ProbeIdDuplicatedError => ({
    code: "PROBE_ID_DUPLICATED",
    message:
      `two probes both declare id '${probeId}' — an id names one row on the card and one line in the ` +
      "report, so a duplicate makes a finding impossible to attribute",
    probeId,
  }),
  readingNotCountable: ({
    probeId,
    value,
  }: {
    readonly probeId: string;
    readonly value: number;
  }): ProbeReadingNotCountableError => ({
    code: "PROBE_READING_NOT_COUNTABLE",
    message:
      `probe '${probeId}' aggregate returned ${String(value)}, and a card row is a whole number of things from 0 ` +
      `to ${String(Number.MAX_SAFE_INTEGER)} — point this probe at something countable, or use kind 'logs-count'`,
    probeId,
    value,
  }),
  setInvalid: ({ issues }: { readonly issues: readonly string[] }): ProbeSetInvalidError => ({
    code: "PROBE_SET_INVALID",
    issues,
    message: `not a probe set: ${issues.join("; ")}`,
  }),
  setTooLarge: ({ declared, cap }: { readonly declared: number; readonly cap: number }): ProbeSetTooLargeError => ({
    cap,
    code: "PROBE_SET_TOO_LARGE",
    declared,
    message:
      `this set declares ${String(declared)} probes and a digest card carries ${String(cap)} rows — split it ` +
      "into two postings rather than letting the card decide which findings nobody sees",
  }),
  shapeMismatch: ({
    probeId,
    detail,
  }: {
    readonly probeId: string;
    readonly detail: string;
  }): ProbeShapeMismatchError => ({
    code: "PROBE_SHAPE_MISMATCH",
    message: `probe '${probeId}' cannot run as declared: ${detail}`,
    probeId,
  }),
} as const;
