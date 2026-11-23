/**
 * `hand line-retire`'s own typed failures — a union of its own rather than more `HandStepError` variants, because these
 * are branched on by one verb only and a caller of the register never meets them.
 */

/** The register itself would not read, or its lock would not be had. */
export interface LineRetireRegisterError {
  readonly code: "REGISTER_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The register changed since the preview whose digest the apply carried. */
export interface LineRetireSourceChangedError {
  readonly code: "SOURCE_CHANGED";
  readonly message: string;
  readonly expected: string;
  readonly actual: string;
}

/** The apply found no line it could prove settled. */
export interface LineRetireNothingEligibleError {
  readonly code: "NOTHING_ELIGIBLE";
  readonly message: string;
}

/** The sidecar append failed. */
export interface LineRetireWriteFailedError {
  readonly code: "WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** The read-back after the append still reports a line the apply retired. */
export interface LineRetireGapPersistsError {
  readonly code: "GAP_PERSISTS";
  readonly message: string;
  readonly lineNumbers: readonly number[];
}

/** Every way `hand line-retire` fails. */
export type LineRetireError =
  | LineRetireRegisterError
  | LineRetireSourceChangedError
  | LineRetireNothingEligibleError
  | LineRetireWriteFailedError
  | LineRetireGapPersistsError;

/** Constructors for {@link LineRetireError}. */
export const LineRetireErrors = {
  gapPersists: ({ lineNumbers }: { lineNumbers: readonly number[] }): LineRetireGapPersistsError => ({
    code: "GAP_PERSISTS",
    lineNumbers,
    message: `the retirement rows were written but line(s) ${lineNumbers.join(", ")} still read as unparsed — the reader does not honour them, so the gap stands`,
  }),
  nothingEligible: (): LineRetireNothingEligibleError => ({
    code: "NOTHING_ELIGIBLE",
    message: "no unreadable line of the register is provably settled, so nothing was retired",
  }),
  registerUnreadable: ({ path, cause }: { path: string; cause: string }): LineRetireRegisterError => ({
    code: "REGISTER_UNREADABLE",
    message: `the hand-step register at ${path} could not be read: ${cause}`,
    path,
  }),
  sourceChanged: ({ expected, actual }: { expected: string; actual: string }): LineRetireSourceChangedError => ({
    actual,
    code: "SOURCE_CHANGED",
    expected,
    message: `the register changed since the preview (preview ${expected}, now ${actual}) — nothing was retired; preview again and apply that digest`,
  }),
  writeFailed: ({ path, cause }: { path: string; cause: string }): LineRetireWriteFailedError => ({
    code: "WRITE_FAILED",
    message: `the retirement sidecar at ${path} could not be appended: ${cause}`,
    path,
  }),
} as const;
