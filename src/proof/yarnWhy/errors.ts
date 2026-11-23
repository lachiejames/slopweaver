/**
 * The typed failures the `yarn why` golden-proof pipeline authors: an input the VHS tape cannot carry, a VHS
 * capture that failed or recorded nothing, and a composition that could not be written. Scoped to this
 * directory per `.claude/rules/error-handling.md`.
 *
 * {@link yarnWhyErrorLines} renders each variant to the exact lines the pipeline has always printed, and
 * `./orchestrate.ts` flattens through it so the public `buildGoldenProof` contract stays a string list.
 */

/** A dependency that is not a package name, so it will not be typed into a shell. */
export interface YarnWhyPackageNameUnsafeError {
  readonly code: "PACKAGE_NAME_UNSAFE";
  readonly message: string;
  readonly dependency: string;
}

/** A frames directory that is not absolute. */
export interface YarnWhyFramesDirRelativeError {
  readonly code: "FRAMES_DIR_RELATIVE";
  readonly message: string;
  readonly framesDir: string;
}

/** A frames directory a VHS tape string cannot carry. */
export interface YarnWhyFramesDirTapeUnsafeError {
  readonly code: "FRAMES_DIR_TAPE_UNSAFE";
  readonly message: string;
  readonly framesDir: string;
}

/** One reason the tape builder refused an input. */
export type YarnWhyInputProblem =
  YarnWhyPackageNameUnsafeError | YarnWhyFramesDirRelativeError | YarnWhyFramesDirTapeUnsafeError;

/** The tape builder refused one or more inputs; `reasons` is each problem's message, in order. */
export interface YarnWhyInputRefusedError {
  readonly code: "INPUT_REFUSED";
  readonly message: string;
  readonly problems: readonly YarnWhyInputProblem[];
  readonly reasons: readonly string[];
}

/** VHS failed while capturing one pane. */
export interface YarnWhyCaptureFailedError {
  readonly code: "CAPTURE_FAILED";
  readonly message: string;
  readonly dependency: string;
  readonly worktree: string;
  readonly cause: unknown;
}

/** VHS exited cleanly but recorded no terminal frame. */
export interface YarnWhyNoFramesError {
  readonly code: "NO_FRAMES";
  readonly message: string;
  readonly dependency: string;
  readonly worktree: string;
}

/** The output path is not a PNG path. */
export interface YarnWhyOutputPathInvalidError {
  readonly code: "OUTPUT_PATH_INVALID";
  readonly message: string;
  readonly outPath: string;
}

/** The composition threw. */
export interface YarnWhyComposeFailedError {
  readonly code: "COMPOSE_FAILED";
  readonly message: string;
  readonly cause: unknown;
}

/** Every failure the golden-proof pipeline raises. */
export type YarnWhyError =
  | YarnWhyInputRefusedError
  | YarnWhyCaptureFailedError
  | YarnWhyNoFramesError
  | YarnWhyOutputPathInvalidError
  | YarnWhyComposeFailedError;

/** The factory the pipeline calls, so a test built the same way catches a drift. */
export const YarnWhyErrors = {
  captureFailed: ({
    dependency,
    worktree,
    cause,
  }: {
    dependency: string;
    worktree: string;
    cause: unknown;
  }): YarnWhyCaptureFailedError => ({
    cause,
    code: "CAPTURE_FAILED",
    dependency,
    message:
      `vhs failed capturing "yarn why ${dependency}" in ${worktree}: ` +
      `${cause instanceof Error ? cause.message : String(cause)}`,
    worktree,
  }),
  composeFailed: ({ cause }: { cause: unknown }): YarnWhyComposeFailedError => ({
    cause,
    code: "COMPOSE_FAILED",
    message: `golden-proof compose failed: ${cause instanceof Error ? cause.message : String(cause)}`,
  }),
  framesDirRelative: ({ framesDir }: { framesDir: string }): YarnWhyFramesDirRelativeError => ({
    code: "FRAMES_DIR_RELATIVE",
    framesDir,
    message: `frames directory must be absolute, got ${framesDir}`,
  }),
  framesDirTapeUnsafe: ({ framesDir }: { framesDir: string }): YarnWhyFramesDirTapeUnsafeError => ({
    code: "FRAMES_DIR_TAPE_UNSAFE",
    framesDir,
    message: `frames directory cannot be written into a VHS tape: ${framesDir}`,
  }),
  inputRefused: ({ problems }: { problems: readonly YarnWhyInputProblem[] }): YarnWhyInputRefusedError => {
    const reasons = problems.map((problem) => problem.message);
    return { code: "INPUT_REFUSED", message: reasons.join("; "), problems, reasons };
  },
  noFrames: ({ dependency, worktree }: { dependency: string; worktree: string }): YarnWhyNoFramesError => ({
    code: "NO_FRAMES",
    dependency,
    message: `vhs recorded no frames for "yarn why ${dependency}" in ${worktree}`,
    worktree,
  }),
  outputPathInvalid: ({ outPath }: { outPath: string }): YarnWhyOutputPathInvalidError => ({
    code: "OUTPUT_PATH_INVALID",
    message: `golden-proof compose failed: outPath must end in .png, got ${outPath}`,
    outPath,
  }),
  packageNameUnsafe: ({ dependency }: { dependency: string }): YarnWhyPackageNameUnsafeError => ({
    code: "PACKAGE_NAME_UNSAFE",
    dependency,
    message: `not a package name, so it will not be typed: ${dependency}`,
  }),
} as const;

/**
 * The lines a failure prints: every reason of a refused input on its own line, otherwise the one message.
 *
 * @returns the diagnostic lines, byte for byte what the pipeline has always printed
 */
export function yarnWhyErrorLines({ error }: { error: YarnWhyError }): readonly string[] {
  if (error.code === "INPUT_REFUSED") {
    return error.reasons;
  }
  return [error.message];
}
