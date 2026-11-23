/**
 * Every way the zero-references proof cannot be produced (`./referenceExport.ts`, `./referenceTree.ts`), as one
 * discriminated union and the factory each failure is built through.
 */
import type { ReferenceMapError } from "./referenceMap.js";

/** A git or unzip step could not run, or failed. */
interface ExportStepFailedError {
  readonly code: "EXPORT_STEP_FAILED";
  readonly message: string;
  readonly step: "resolve" | "inventory" | "archive" | "unzip" | "walk" | "keep";
}

/** The zip does not hold what the commit holds, so a count over it would not be a count over the commit. */
interface ExportIncompleteError {
  readonly code: "EXPORT_INCOMPLETE";
  readonly message: string;
}

/** The reference map is not at the path the run reads. */
interface ReferenceMapAbsentError {
  readonly code: "REFERENCE_MAP_ABSENT";
  readonly message: string;
  readonly path: string;
}

/** The reference map, or the private denylist, exists and could not be read. */
interface ReferenceInputUnreadableError {
  readonly code: "REFERENCE_INPUT_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** Files in the zip that could not be read: a scan that skipped them has not proven them clean. */
interface ExportedFilesUnreadableError {
  readonly code: "EXPORTED_FILES_UNREADABLE";
  readonly message: string;
  readonly paths: readonly string[];
}

/** The scan ran, but its report could not be written under the home, so nobody can read what it found. */
interface ReportUnwritableError {
  readonly code: "REPORT_UNWRITABLE";
  readonly message: string;
  readonly path: string;
}

/** Every way the proof cannot be produced. */
export type ReferenceExportError =
  | ExportStepFailedError
  | ExportIncompleteError
  | ReferenceMapAbsentError
  | ReferenceInputUnreadableError
  | ExportedFilesUnreadableError
  | ReportUnwritableError
  | ReferenceMapError;

/** The factory every export failure is built through. */
export const ReferenceExportErrors = {
  incomplete: ({ why }: { why: string }): ExportIncompleteError => ({
    code: "EXPORT_INCOMPLETE",
    message: `the zip is not the whole commit (${why}), so a count over it is not the proof`,
  }),
  inputUnreadable: ({ path, why }: { path: string; why: string }): ReferenceInputUnreadableError => ({
    code: "REFERENCE_INPUT_UNREADABLE",
    message: `${path} exists and could not be read (${why}) — a scan without it would undercount`,
    path,
  }),
  mapAbsent: ({ path }: { path: string }): ReferenceMapAbsentError => ({
    code: "REFERENCE_MAP_ABSENT",
    message:
      `no reference map at ${path}: the installation's own names are held off-repo, one row per name ` +
      "(class<TAB>flags<TAB>pattern); without it only the hygiene gate's committed rules would run, and a zero " +
      "over those alone is not the proof",
    path,
  }),
  // The filesystem's own message is dropped on purpose: only the path is known to be safe to show.
  reportUnwritable: ({ path }: { path: string }): ReportUnwritableError => ({
    code: "REPORT_UNWRITABLE",
    message: `the report could not be written to ${path}`,
    path,
  }),
  stepFailed: ({ step, cause }: { step: ExportStepFailedError["step"]; cause: unknown }): ExportStepFailedError => ({
    code: "EXPORT_STEP_FAILED",
    message: `${step} failed: ${cause instanceof Error ? cause.message.split("\n")[0]! : String(cause)}`,
    step,
  }),
  unreadableFiles: ({ paths }: { paths: readonly string[] }): ExportedFilesUnreadableError => ({
    code: "EXPORTED_FILES_UNREADABLE",
    message: `${String(paths.length)} file(s) in the zip could not be read, so the tree is NOT proven clean`,
    paths,
  }),
} as const;
