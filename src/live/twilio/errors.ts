/**
 * The typed domain errors for the Twilio read door — see `.claude/rules/error-handling.md` for the shape.
 *
 * One union: what this door refuses before a read (no key, an unreadable one, a URL outside the closed call
 * list) and what a read that was sent comes back as. No message here ever carries the key, a phone number, a
 * query string or a response body: a refusal names a PATH, and a path on this door holds only the account SID
 * and a message SID.
 */

/** One or more of the three Twilio secret files is not in the secrets store. */
export interface TwilioTokenMissingError {
  readonly code: "TOKEN_MISSING";
  readonly message: string;
  /** The secret names that are absent, so the hand step can name exactly what is left to provision. */
  readonly missing: readonly string[];
}

/** A secret file is present and could not be used: its mode, its kind, or its shape. */
export interface TwilioCredentialUnreadableError {
  readonly code: "CREDENTIAL_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** A URL is not one the closed call list builds — refused before the key leaves the process. */
export interface TwilioUrlRefusedError {
  readonly code: "URL_REFUSED";
  readonly message: string;
  readonly path: string;
}

/** The GET did not answer 2xx; `status` is Twilio's HTTP status, or `null` when it never answered. */
export interface TwilioTransportFailedError {
  readonly code: "TRANSPORT_FAILED";
  readonly message: string;
  readonly status: number | null;
}

/** Twilio answered 2xx with a body this door's strict boundary will not read — a fault, never an empty result. */
export interface TwilioResponseRefusedError {
  readonly code: "RESPONSE_REFUSED";
  readonly message: string;
  readonly endpoint: string;
}

/** A paged read stopped because continuing would loop or pass the page ceiling. */
export interface TwilioPaginationRefusedError {
  readonly code: "PAGINATION_REFUSED";
  readonly message: string;
}

/** Every failure this door produces. */
export type TwilioReadError =
  | TwilioTokenMissingError
  | TwilioCredentialUnreadableError
  | TwilioUrlRefusedError
  | TwilioTransportFailedError
  | TwilioResponseRefusedError
  | TwilioPaginationRefusedError;

/**
 * The one step only the owner can take when no key is stored. Minting a key is a write in Twilio, so it is the
 * owner's hand and never a session's; a RESTRICTED key granting only message reads is the narrowest Twilio offers.
 *
 * @internal
 */
export const TWILIO_KEY_HAND_STEP =
  "In console.twilio.com → Account → API keys & tokens, create a RESTRICTED API key granting only Messaging → " +
  "Messages → Read (list and fetch), then run `slopweaver secrets set twilio-account-sid`, " +
  "`slopweaver secrets set twilio-api-key-sid` and `slopweaver secrets set twilio-api-key-secret`, then " +
  "`slopweaver twilio verify`";

/** How to raise each {@link TwilioReadError} — the factory the real code and its tests both call. */
export const TwilioReadErrors = {
  credentialUnreadable: ({ path, reason }: { path: string; reason: string }): TwilioCredentialUnreadableError => ({
    code: "CREDENTIAL_UNREADABLE",
    message: `${path} is present and could not be used: ${reason}`,
    path,
  }),
  paginationRefused: ({ why }: { why: string }): TwilioPaginationRefusedError => ({
    code: "PAGINATION_REFUSED",
    message: `stopped paging Twilio messages: ${why}`,
  }),
  responseRefused: ({ endpoint, why }: { endpoint: string; why: string }): TwilioResponseRefusedError => ({
    code: "RESPONSE_REFUSED",
    endpoint,
    message: `${endpoint} answered a body this door will not read — refused, NOT an empty result: ${why}`,
  }),
  tokenMissing: ({ missing }: { missing: readonly string[] }): TwilioTokenMissingError => ({
    code: "TOKEN_MISSING",
    message: `no Twilio API key is configured (missing ${missing.join(", ")} in $SLOPWEAVER_HOME/secrets). ${TWILIO_KEY_HAND_STEP}`,
    missing,
  }),
  transportFailed: ({ message, status }: { message: string; status: number | null }): TwilioTransportFailedError => ({
    code: "TRANSPORT_FAILED",
    message,
    status,
  }),
  urlRefused: ({ path, why }: { path: string; why: string }): TwilioUrlRefusedError => ({
    code: "URL_REFUSED",
    message: `refused ${path}: ${why}`,
    path,
  }),
} as const;
