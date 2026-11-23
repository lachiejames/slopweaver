/**
 * The typed failures of the Google consent HANDSHAKE itself — the callback it reads, and the three JSON
 * endpoints it parses (token, userinfo, revocation). Shared by every Google door, because the code that
 * produces each of these is the one handshake in `./oauth.ts` and `./consent.ts`. The loopback wait's own
 * failures are `../oauth/loopback.ts`'s, shared with the Outlook door.
 *
 * A union of its own per `.claude/rules/error-handling.md`, and deliberately not merged into
 * `./credentialErrors.ts`'s variants: those are what a DOOR reports (`CONSENT_FAILED` carries one of these
 * messages), while these are what the handshake found before any door named it. Every variant is one line;
 * none carries a list.
 */

/** The callback carried Google's own refusal — the owner declined, or Google refused the request. */
export interface GoogleConsentRefusedError {
  readonly code: "CONSENT_REFUSED";
  readonly message: string;
  /** Google's `error` query parameter, verbatim. */
  readonly reason: string;
}

/** The callback cannot be believed: its state is not this flow's, or it carries no code. */
export interface GoogleCallbackUnusableError {
  readonly code: "CALLBACK_UNUSABLE";
  readonly message: string;
}

/** An endpoint answered with a body that is not a JSON object. */
export interface GoogleResponseUnreadableError {
  readonly code: "RESPONSE_UNREADABLE";
  readonly message: string;
  readonly endpoint: string;
}

/** An endpoint answered with its own `error` field; `errorCode` is Google's, verbatim. */
export interface GoogleEndpointRefusedError {
  readonly code: "ENDPOINT_REFUSED";
  readonly message: string;
  readonly endpoint: string;
  readonly errorCode: string;
}

/** An endpoint answered without a field the grant cannot be used without. */
export interface GoogleResponseFieldMissingError {
  readonly code: "RESPONSE_FIELD_MISSING";
  readonly message: string;
  readonly endpoint: string;
  readonly field: string;
}

/** An endpoint answered with a field that is present but cannot be what it claims to be. */
export interface GoogleResponseFieldMalformedError {
  readonly code: "RESPONSE_FIELD_MALFORMED";
  readonly message: string;
  readonly endpoint: string;
  readonly field: string;
}

/** Every failure the Google consent handshake authors. */
export type GoogleOauthError =
  | GoogleConsentRefusedError
  | GoogleCallbackUnusableError
  | GoogleResponseUnreadableError
  | GoogleEndpointRefusedError
  | GoogleResponseFieldMissingError
  | GoogleResponseFieldMalformedError;

/**
 * Google's own `error_description`, as the suffix a refusal carries — empty when Google sent none.
 *
 * @param description the response's `error_description` field, whatever it is
 * @returns ` — <description>`, or the empty string
 */
function describedBy({ description }: { description: unknown }): string {
  if (typeof description === "string") {
    return ` — ${description}`;
  }
  return "";
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const GoogleOauthErrors = {
  callbackCodeMissing: (): GoogleCallbackUnusableError => ({
    code: "CALLBACK_UNUSABLE",
    message: "the consent callback carried no authorisation code",
  }),
  callbackStateMismatch: (): GoogleCallbackUnusableError => ({
    code: "CALLBACK_UNUSABLE",
    message: "the consent callback carried the wrong state — the flow was not the one this process started",
  }),
  consentRefused: ({ reason }: { reason: string }): GoogleConsentRefusedError => ({
    code: "CONSENT_REFUSED",
    message: `Google refused the consent request: ${reason}`,
    reason,
  }),
  emailMissing: (): GoogleResponseFieldMissingError => ({
    code: "RESPONSE_FIELD_MISSING",
    endpoint: "userinfo",
    field: "email",
    message: "the Google userinfo endpoint returned no email — was the userinfo.email scope approved?",
  }),
  notAnObject: ({ endpoint }: { endpoint: string }): GoogleResponseUnreadableError => ({
    code: "RESPONSE_UNREADABLE",
    endpoint,
    message: `the Google ${endpoint} endpoint returned a body that is not an object`,
  }),
  notJson: ({ endpoint }: { endpoint: string }): GoogleResponseUnreadableError => ({
    code: "RESPONSE_UNREADABLE",
    endpoint,
    message: `the Google ${endpoint} endpoint returned a body that is not valid JSON`,
  }),
  revocationRefused: ({
    errorCode,
    description,
  }: {
    errorCode: string;
    description: unknown;
  }): GoogleEndpointRefusedError => ({
    code: "ENDPOINT_REFUSED",
    endpoint: "revocation",
    errorCode,
    message: `the Google revocation endpoint refused: ${errorCode}${describedBy({ description })}`,
  }),
  tokenExchangeRefused: ({
    errorCode,
    description,
  }: {
    errorCode: string;
    description: unknown;
  }): GoogleEndpointRefusedError => ({
    code: "ENDPOINT_REFUSED",
    endpoint: "token",
    errorCode,
    message: `the Google token endpoint refused the exchange: ${errorCode}${describedBy({ description })}`,
  }),
  tokenFieldMissing: ({ field }: { field: "access_token" | "expires_in" }): GoogleResponseFieldMissingError => ({
    code: "RESPONSE_FIELD_MISSING",
    endpoint: "token",
    field,
    message: `the Google token endpoint returned no ${field}`,
  }),
  tokenLifetimeMalformed: ({
    field,
    value,
  }: {
    field: "expires_in" | "refresh_token_expires_in";
    value: unknown;
  }): GoogleResponseFieldMalformedError => ({
    code: "RESPONSE_FIELD_MALFORMED",
    endpoint: "token",
    field,
    message: `the Google token endpoint returned ${field} ${String(value)}, which is no positive whole number of seconds an expiry can be recorded from`,
  }),
} as const;
