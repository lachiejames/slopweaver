/**
 * Every way `slopweaver machine series` can fail, one discriminated union each for the sample and for the ring on
 * disk. A caller branches on `code`; `message` is what it prints. A missing reading is always one of these and never
 * a zero: a chart drawn from a zero nobody measured is the exact unbelievable number the owner asked charts to replace.
 */

/** The final `top` sample was not there: `top -l 2` printed one sample or none. */
export interface TopNoSecondSampleError {
  readonly code: "TOP_NO_SECOND_SAMPLE";
  readonly message: string;
}

/** The final `top` sample carried no `PID %CPU MEM` heading, so no process row can be trusted. */
export interface TopNoProcessHeadingError {
  readonly code: "TOP_NO_PROCESS_HEADING";
  readonly message: string;
}

/** The final `top` sample carried no `Load Avg:` line. */
export interface TopNoLoadError {
  readonly code: "TOP_NO_LOAD";
  readonly message: string;
}

/** `vm_stat` printed no page size, or no count for a line the used-memory figure is summed from. */
export interface VmStatIncompleteError {
  readonly code: "VM_STAT_INCOMPLETE";
  readonly message: string;
  /** The line it could not read, as `vm_stat` labels it. */
  readonly field: string;
}

/** One of the machine reads a sample needs could not be taken at all. */
export interface SampleReadFailedError {
  readonly code: "SAMPLE_READ_FAILED";
  readonly message: string;
  /**
   * Which read failed, as the sample names it: `top`, `ps`, `comm`, `cores`, `memory`, `vm_stat`, `compressor` or
   * `swap`.
   */
  readonly read: string;
}

/** The ring held no sample to print, which only a sample that was never taken can cause. */
export interface SeriesEmptyError {
  readonly code: "SERIES_EMPTY";
  readonly message: string;
}

/** A failure taking one sample. */
export type MachineSeriesError =
  | TopNoSecondSampleError
  | TopNoProcessHeadingError
  | TopNoLoadError
  | VmStatIncompleteError
  | SampleReadFailedError
  | SeriesEmptyError;

/** Builds every {@link MachineSeriesError}, so the code and its message are written in one place. */
export const MachineSeriesErrors = {
  readFailed: ({ read }: { read: string }): SampleReadFailedError => ({
    code: "SAMPLE_READ_FAILED",
    message: `machine series: the ${read} read failed, so no sample was taken`,
    read,
  }),
  seriesEmpty: (): SeriesEmptyError => ({
    code: "SERIES_EMPTY",
    message: "machine series: the ring held no sample to print",
  }),
  topNoLoad: (): TopNoLoadError => ({
    code: "TOP_NO_LOAD",
    message: "machine series: top's final sample carried no Load Avg line",
  }),
  topNoProcessHeading: (): TopNoProcessHeadingError => ({
    code: "TOP_NO_PROCESS_HEADING",
    message: "machine series: top's final sample carried no PID %CPU MEM heading",
  }),
  topNoSecondSample: (): TopNoSecondSampleError => ({
    code: "TOP_NO_SECOND_SAMPLE",
    message: "machine series: top printed fewer than two samples, and only the second measures CPU",
  }),
  vmStatIncomplete: ({ field }: { field: string }): VmStatIncompleteError => ({
    code: "VM_STAT_INCOMPLETE",
    field,
    message: `machine series: vm_stat printed no ${field}, so memory in use cannot be summed`,
  }),
} as const;

/** The ring file could not be read at all (anything but its absence). */
export interface SeriesStoreUnreadableError {
  readonly code: "SERIES_STORE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A line of the ring is not JSON. */
export interface SeriesRowMalformedError {
  readonly code: "SERIES_ROW_MALFORMED";
  readonly message: string;
  readonly line: number;
}

/** A line of the ring is JSON but not a sample. */
export interface SeriesRowInvalidError {
  readonly code: "SERIES_ROW_INVALID";
  readonly message: string;
  readonly line: number;
}

/** The ring could not be rewritten. */
export interface SeriesStoreWriteFailedError {
  readonly code: "SERIES_STORE_WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** Another process held the sampling lock past the wait. */
export interface SeriesLockHeldError {
  readonly code: "SERIES_LOCK_HELD";
  readonly message: string;
}

/** A failure reading, writing or locking the ring. */
export type MachineSeriesStoreError =
  | SeriesStoreUnreadableError
  | SeriesRowMalformedError
  | SeriesRowInvalidError
  | SeriesStoreWriteFailedError
  | SeriesLockHeldError;

/**
 * A thrown value's own words.
 *
 * @returns its message, or its string form
 */
function causeWords({ cause }: { cause: unknown }): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
}

/** Builds every {@link MachineSeriesStoreError}. */
export const MachineSeriesStoreErrors = {
  lockHeld: ({ why }: { why: string }): SeriesLockHeldError => ({
    code: "SERIES_LOCK_HELD",
    message: `machine series: another sample holds the lock: ${why}`,
  }),
  rowInvalid: ({ line, why }: { line: number; why: string }): SeriesRowInvalidError => ({
    code: "SERIES_ROW_INVALID",
    line,
    message: `machine series: line ${String(line)} of the ring is not a sample: ${why}`,
  }),
  rowMalformed: ({ line, cause }: { line: number; cause: unknown }): SeriesRowMalformedError => ({
    code: "SERIES_ROW_MALFORMED",
    line,
    message: `machine series: line ${String(line)} of the ring is not JSON: ${causeWords({ cause })}`,
  }),
  unreadable: ({ path, cause }: { path: string; cause: unknown }): SeriesStoreUnreadableError => ({
    code: "SERIES_STORE_UNREADABLE",
    message: `machine series: could not read ${path}: ${causeWords({ cause })}`,
    path,
  }),
  writeFailed: ({ path, cause }: { path: string; cause: unknown }): SeriesStoreWriteFailedError => ({
    code: "SERIES_STORE_WRITE_FAILED",
    message: `machine series: could not write ${path}: ${causeWords({ cause })}`,
    path,
  }),
} as const;
