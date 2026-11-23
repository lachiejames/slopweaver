/**
 * The typed domain errors for the KnowBe4 Reporting API door — see `.claude/rules/error-handling.md` for the
 * shape.
 *
 * One union: what this door refuses before a read (no token, an unreadable one, a path outside the closed call
 * list) and what a read that was sent comes back as.
 */

/** No Reporting API token is stored in the secrets store, the one route `credential.ts` reads. */
export interface Knowbe4TokenMissingError {
  readonly code: "TOKEN_MISSING";
  readonly message: string;
  readonly checked: readonly string[];
}

/** A secret file is present and could not be read, or reads empty. */
export interface Knowbe4CredentialUnreadableError {
  readonly code: "CREDENTIAL_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A built path is not one the closed call list admits. */
export interface Knowbe4PathRefusedError {
  readonly code: "PATH_REFUSED";
  readonly message: string;
  readonly path: string;
}

/** The GET did not answer 2xx; `status` is KnowBe4's HTTP status, or `null` when it never answered. */
export interface Knowbe4TransportFailedError {
  readonly code: "TRANSPORT_FAILED";
  readonly message: string;
  readonly status: number | null;
}

/** The body answered 2xx and is not JSON. */
export interface Knowbe4BodyNotJsonError {
  readonly code: "BODY_NOT_JSON";
  readonly message: string;
  readonly path: string;
}

/** Every failure this door produces. */
export type Knowbe4ReadError =
  | Knowbe4TokenMissingError
  | Knowbe4CredentialUnreadableError
  | Knowbe4PathRefusedError
  | Knowbe4TransportFailedError
  | Knowbe4BodyNotJsonError;

/** How to raise each {@link Knowbe4ReadError} — the factory the real code and its tests both call. */
export const Knowbe4ReadErrors = {
  bodyNotJson: ({ path }: { path: string }): Knowbe4BodyNotJsonError => ({
    code: "BODY_NOT_JSON",
    message: `${path} answered a body that is not JSON`,
    path,
  }),
  credentialUnreadable: ({ path, reason }: { path: string; reason: string }): Knowbe4CredentialUnreadableError => ({
    code: "CREDENTIAL_UNREADABLE",
    message: `${path} is present and could not be read: ${reason}`,
    path,
  }),
  pathRefused: ({ path, why }: { path: string; why: string }): Knowbe4PathRefusedError => ({
    code: "PATH_REFUSED",
    message: `refused ${path}: ${why}`,
    path,
  }),
  tokenMissing: ({ checked }: { checked: readonly string[] }): Knowbe4TokenMissingError => ({
    checked,
    code: "TOKEN_MISSING",
    message: `no KnowBe4 Reporting API token is configured (checked ${checked.join(", ")})`,
  }),
  transportFailed: ({ message, status }: { message: string; status: number | null }): Knowbe4TransportFailedError => ({
    code: "TRANSPORT_FAILED",
    message,
    status,
  }),
} as const;
