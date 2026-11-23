/**
 * The four failures that belong to a Google GRANT rather than to any one Google product — declared once,
 * because one implementation produces all four for every door here.
 *
 * ## Why this is not the umbrella `.claude/rules/error-handling.md` bans
 *
 * That rule refuses a shared base type across domains, and refuses merging two domains' unions because
 * they happen to look alike. Neither is what this is. There is no base type: `GmailError` and `DriveError`
 * remain separate unions that stand alone, and a caller still branches on `code` exactly as before. What is
 * shared is a set of VARIANTS emitted by shared CODE — `googleGrantStore` reads the grant,
 * `runGoogleConsentFlow` runs the consent, `missingScopes` checks the scopes — so a mail
 * `CREDENTIAL_UNREADABLE` and a Drive one are not a coincidence of shape, they are the same line of code
 * failing. Copying them per door is how the two drift into reporting the same failure differently, which is
 * the drift the clone ratchet caught the moment the second door was written.
 *
 * The line to hold: a variant belongs here only when the code that PRODUCES it is shared. Gmail's
 * `HISTORY_EXPIRED` and Drive's `EXPORT_UNSUPPORTED` stay in their own doors, because nothing shared can
 * emit either.
 *
 * Pure: no I/O, no clock.
 */

/** No grant is stored for the selected state home — nothing has been authorised yet for this door. */
interface GoogleNotConnectedError {
  readonly code: "NOT_CONNECTED";
  readonly message: string;
}

/** A grant exists but does not carry the scope this verb needs. */
interface GoogleScopeMissingError {
  readonly code: "SCOPE_MISSING";
  readonly message: string;
  /** The scope URIs the verb needs and the stored grant does not have. */
  readonly missing: readonly string[];
}

/** The stored grant could not be read, parsed, or written back — or no OAuth client is configured. */
interface GoogleCredentialUnreadableError {
  readonly code: "CREDENTIAL_UNREADABLE";
  readonly message: string;
  readonly cause?: unknown;
}

/** The consent flow itself failed — the user declined, the state did not match, or the exchange refused. */
interface GoogleConsentFailedError {
  readonly code: "CONSENT_FAILED";
  readonly message: string;
  readonly cause?: unknown;
}

/**
 * Every grant-lifecycle failure a Google door can produce. Each door's own union INCLUDES this rather than
 * extending it, so no umbrella type exists and each union is still a closed set a `switch` can exhaust.
 */
export type GoogleCredentialError =
  GoogleNotConnectedError | GoogleScopeMissingError | GoogleCredentialUnreadableError | GoogleConsentFailedError;

/**
 * One door's factories for the four shared variants.
 *
 * @internal — the declared shape {@link googleCredentialErrors} returns; each door spreads it into its own
 * `<Domain>Errors` object, so callers only ever see that.
 */
export interface GoogleCredentialErrorFactories {
  readonly notConnected: () => GoogleNotConnectedError;
  readonly scopeMissing: (args: { missing: readonly string[] }) => GoogleScopeMissingError;
  readonly credentialUnreadable: (args: { message: string; cause?: unknown }) => GoogleCredentialUnreadableError;
  readonly consentFailed: (args: { message: string; cause?: unknown }) => GoogleConsentFailedError;
}

/**
 * Bind the four factories to one door's vocabulary, so `NOT_CONNECTED` names the verb that fixes it and
 * `SCOPE_MISSING` names the product whose consent screen has to be re-approved.
 *
 * `NOT_CONNECTED` and `SCOPE_MISSING` are separate variants on purpose: the first means run `connect`, the
 * second means run it AGAIN with a wider grant, and telling a reader to re-authorise when they have never
 * authorised is the confusing half of every OAuth integration.
 *
 * @param productName how the door names itself to the owner ("Gmail", "Google Drive")
 * @param connectVerb the command that establishes or widens the grant
 * @returns the door's bound factories
 */
export function googleCredentialErrors({
  productName,
  connectVerb,
}: {
  productName: string;
  connectVerb: string;
}): GoogleCredentialErrorFactories {
  return {
    consentFailed: ({ message, cause }) => ({
      code: "CONSENT_FAILED",
      message,
      ...(cause !== undefined ? { cause } : {}),
    }),
    credentialUnreadable: ({ message, cause }) => ({
      code: "CREDENTIAL_UNREADABLE",
      message,
      ...(cause !== undefined ? { cause } : {}),
    }),
    notConnected: () => ({
      code: "NOT_CONNECTED",
      message: `no ${productName} grant stored for this home — run \`${connectVerb}\``,
    }),
    scopeMissing: ({ missing }) => ({
      code: "SCOPE_MISSING",
      message: `the stored ${productName} grant is missing ${missing.join(", ")} — re-run \`${connectVerb}\` and approve it`,
      missing,
    }),
  };
}
