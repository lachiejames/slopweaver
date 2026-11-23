/**
 * The typed domain errors for the Google SecOps door — see `.claude/rules/error-handling.md` for the shape.
 *
 * Two unions, never shared. {@link GoogleSecopsDoorError} is the grant lifecycle, every variant emitted by
 * the shared Google consent code. {@link GoogleSecopsReadError} is what this door's own code refuses before
 * or during a read: an instance it cannot address, a URL outside the one host and instance it may reach,
 * and a call that did not answer.
 */
import { type GoogleCredentialError, googleCredentialErrors } from "../google/credentialErrors.js";

/** Every failure a Google SecOps grant verb can produce. */
export type GoogleSecopsDoorError = GoogleCredentialError;

/** Factories for every {@link GoogleSecopsDoorError} variant. */
export const GoogleSecopsDoorErrors = googleCredentialErrors({
  connectVerb: "slopweaver atlas google-secops connect",
  productName: "Google Security Operations",
});

/** No SecOps instance is configured for this home. */
export interface SecopsInstanceMissingError {
  readonly code: "INSTANCE_MISSING";
  readonly message: string;
}

/** An instance is configured but is not one resource name this door can address. */
export interface SecopsInstanceMalformedError {
  readonly code: "INSTANCE_MALFORMED";
  readonly message: string;
  readonly value: string;
}

/** A built URL would leave the instance's own regional host. */
export interface SecopsHostRefusedError {
  readonly code: "HOST_REFUSED";
  readonly message: string;
  readonly origin: string;
}

/** A built URL's path would leave the instance, or names an API version this door does not read. */
export interface SecopsPathRefusedError {
  readonly code: "PATH_REFUSED";
  readonly message: string;
  readonly path: string;
}

/** The GET did not answer; `status` is Google's HTTP status, or null when the call never reached it. */
export interface SecopsTransportFailedError {
  readonly code: "TRANSPORT_FAILED";
  readonly message: string;
  readonly status: number | null;
}

/** Every failure this door's own read code produces. */
export type GoogleSecopsReadError =
  | SecopsInstanceMissingError
  | SecopsInstanceMalformedError
  | SecopsHostRefusedError
  | SecopsPathRefusedError
  | SecopsTransportFailedError;

/** How to raise each {@link GoogleSecopsReadError} — the factory the real code and its tests both call. */
export const GoogleSecopsReadErrors = {
  hostRefused: ({ origin, expected }: { origin: string; expected: string }): SecopsHostRefusedError => ({
    code: "HOST_REFUSED",
    message: `refused ${origin}: this door reads ${expected} and no other host`,
    origin,
  }),
  instanceMalformed: ({ value }: { value: string }): SecopsInstanceMalformedError => ({
    code: "INSTANCE_MALFORMED",
    message:
      `google-secops-instance is not a Chronicle instance resource name: ${value} — expected ` +
      "projects/<project>/locations/<location>/instances/<uuid>",
    value,
  }),
  instanceMissing: (): SecopsInstanceMissingError => ({
    code: "INSTANCE_MISSING",
    message:
      "no Google SecOps instance is configured — run `slopweaver secrets set google-secops-instance` with " +
      "projects/<project>/locations/<location>/instances/<uuid>",
  }),
  pathRefused: ({ path, why }: { path: string; why: string }): SecopsPathRefusedError => ({
    code: "PATH_REFUSED",
    message: `refused ${path}: ${why}`,
    path,
  }),
  transportFailed: ({ message, status }: { message: string; status: number | null }): SecopsTransportFailedError => ({
    code: "TRANSPORT_FAILED",
    message,
    status,
  }),
} as const;
