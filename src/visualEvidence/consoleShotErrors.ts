/**
 * `browser console-shot`'s typed failures, one union for this capture alone per `.claude/rules/error-handling.md`: a
 * caller branches on `code` and displays `message`.
 */

/** No walk is registered under the name given. */
export interface ConsoleWalkUnknownError {
  readonly code: "CONSOLE_WALK_UNKNOWN";
  readonly message: string;
}

/** The maintenance connection the throwaway store is created through cannot be derived safely. */
export interface ConsoleStoreUnavailableError {
  readonly code: "CONSOLE_STORE_UNAVAILABLE";
  readonly message: string;
}

/** A build or the capture lane itself did not finish. */
export interface ConsoleLaneFailedError {
  readonly code: "CONSOLE_LANE_FAILED";
  readonly message: string;
}

/** The observation the capture spec left is absent, unreadable or not the walk that was asked for. */
export interface ConsoleObservationInvalidError {
  readonly code: "CONSOLE_OBSERVATION_INVALID";
  readonly message: string;
}

/** The region cut was the whole viewport, which proves nothing narrower than "a screen". */
export interface ConsoleWholeFrameError {
  readonly code: "CONSOLE_WHOLE_FRAME";
  readonly message: string;
}

/** The picture could not be decoded, stripped or written. */
export interface ConsoleImageFailedError {
  readonly code: "CONSOLE_IMAGE_FAILED";
  readonly message: string;
}

/** `--out` already exists as something a picture cannot replace, such as a directory. */
export interface ConsoleOutNotAFileError {
  readonly code: "CONSOLE_OUT_NOT_A_FILE";
  readonly message: string;
}

/** Every way `browser console-shot` fails. */
export type ConsoleShotError =
  | ConsoleWalkUnknownError
  | ConsoleStoreUnavailableError
  | ConsoleLaneFailedError
  | ConsoleObservationInvalidError
  | ConsoleWholeFrameError
  | ConsoleImageFailedError
  | ConsoleOutNotAFileError;

/** The factory every `browser console-shot` failure is built through. */
export const ConsoleShotErrors = {
  imageFailed: ({ detail }: { detail: string }): ConsoleImageFailedError => ({
    code: "CONSOLE_IMAGE_FAILED",
    message: `the console shot's picture could not be finished: ${detail}`,
  }),
  laneFailed: ({ step, status }: { step: string; status: string }): ConsoleLaneFailedError => ({
    code: "CONSOLE_LANE_FAILED",
    message: `the console shot stopped at ${step} (${status}); its own output above says why`,
  }),
  observationInvalid: ({ detail }: { detail: string }): ConsoleObservationInvalidError => ({
    code: "CONSOLE_OBSERVATION_INVALID",
    message: `the capture left no usable observation: ${detail}`,
  }),
  outNotAFile: ({ out }: { out: string }): ConsoleOutNotAFileError => ({
    code: "CONSOLE_OUT_NOT_A_FILE",
    message: `--out ${out} exists and is not a file, so the console shot's picture cannot replace it`,
  }),
  storeUnavailable: ({ detail }: { detail: string }): ConsoleStoreUnavailableError => ({
    code: "CONSOLE_STORE_UNAVAILABLE",
    message: `no throwaway store can be created for the console shot: ${detail}`,
  }),
  walkUnknown: ({ name, known }: { name: string; known: readonly string[] }): ConsoleWalkUnknownError => ({
    code: "CONSOLE_WALK_UNKNOWN",
    message: `no console walk is named '${name}'; the registered walks are ${known.join(", ")}`,
  }),
  wholeFrame: ({ detail }: { detail: string }): ConsoleWholeFrameError => ({
    code: "CONSOLE_WHOLE_FRAME",
    message: `the walk's region is the whole viewport: ${detail}`,
  }),
} as const;
