/**
 * Why a profile delivery marker, or the transcript it is checked against, could not be read or written, as a typed
 * union (`./profileDelivery.ts`).
 *
 * Every caller does the same thing with any of these — it holds the call, since an unreadable marker is no marker —
 * so `message` is what it shows. The union exists because `error-shape-threshold` counts `src/context`'s plain
 * message shapes, and this module's four were the ones that took the directory past the threshold.
 *
 * Read `.message` to display; `.code` to branch.
 */
import { errorMessage } from "#lib/errorMessage.js";

/** The context id carries something `deliveryContextOf`'s grammar could not have produced, a separator say. */
export interface ProfileDeliveryContextIdError {
  readonly code: "CONTEXT_ID_INVALID";
  readonly message: string;
  readonly contextId: string;
}

/** The marker is there and could not be read. */
export interface ProfileDeliveryMarkerUnreadableError {
  readonly code: "MARKER_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** The marker, or the directory it lives in, could not be written. */
export interface ProfileDeliveryMarkerUnwritableError {
  readonly code: "MARKER_UNWRITABLE";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** The transcript a marker is checked against is there and could not be read. */
export interface ProfileDeliveryTranscriptUnreadableError {
  readonly code: "TRANSCRIPT_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** Every way reading or writing a delivery marker can fail. */
export type ProfileDeliveryError =
  | ProfileDeliveryContextIdError
  | ProfileDeliveryMarkerUnreadableError
  | ProfileDeliveryMarkerUnwritableError
  | ProfileDeliveryTranscriptUnreadableError;

/** Build one of the four, so a test constructs a failure the same way the real code does. */
export const ProfileDeliveryErrors = {
  contextIdInvalid: ({ contextId }: { contextId: string }): ProfileDeliveryContextIdError => ({
    code: "CONTEXT_ID_INVALID",
    contextId,
    message: `context id ${JSON.stringify(contextId)} is not one a profile delivery can be recorded for`,
  }),
  markerUnreadable: ({ path, cause }: { path: string; cause: unknown }): ProfileDeliveryMarkerUnreadableError => ({
    cause,
    code: "MARKER_UNREADABLE",
    message: `the profile delivery marker ${path} could not be read: ${errorMessage({ error: cause })}`,
    path,
  }),
  markerUnwritable: ({ path, cause }: { path: string; cause: unknown }): ProfileDeliveryMarkerUnwritableError => ({
    cause,
    code: "MARKER_UNWRITABLE",
    message: `the profile delivery marker ${path} could not be written: ${errorMessage({ error: cause })}`,
    path,
  }),
  transcriptUnreadable: ({
    path,
    cause,
  }: {
    path: string;
    cause: unknown;
  }): ProfileDeliveryTranscriptUnreadableError => ({
    cause,
    code: "TRANSCRIPT_UNREADABLE",
    message: `the transcript ${path} could not be read: ${errorMessage({ error: cause })}`,
    path,
  }),
} as const;
