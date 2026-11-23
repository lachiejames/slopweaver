/**
 * The typed failure kinds of reading the subscription dates a Codex store's own sign-in states
 * (`./subscriptionDates.ts`).
 *
 * Per `.claude/rules/error-handling.md` this union stands alone. A store whose dates do not read says nothing about
 * whether it is signed in or which account it holds, so it shares no base with `./signInErrors.ts`.
 *
 * **No variant carries a credential, a decoded claim or a parser's own words.** Each names the `auth.json` path and
 * the structural stage that failed, and nothing else: a `JSON.parse` message quotes the input, and a schema issue can
 * carry the value it refused, so neither is ever forwarded.
 */

/** `auth.json` is absent or could not be read — the store has no sign-in to read dates from. */
export interface CodexSubscriptionAuthUnreadableError {
  readonly code: "CODEX_SUBSCRIPTION_AUTH_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** `auth.json` read, but it is not JSON or carries no `tokens.id_token` string. */
export interface CodexSubscriptionAuthInvalidError {
  readonly code: "CODEX_SUBSCRIPTION_AUTH_INVALID";
  readonly message: string;
  readonly path: string;
}

/** The `id_token` is not three segments whose middle one is canonical base64url of a JSON object. */
export interface CodexSubscriptionIdTokenInvalidError {
  readonly code: "CODEX_SUBSCRIPTION_ID_TOKEN_INVALID";
  readonly message: string;
  readonly path: string;
}

/**
 * The token decodes, and its ChatGPT claims carry no subscription dates: a sign-in with no paid ChatGPT subscription
 * behind it, or the provider having renamed the claims. Either way the provider states no date here.
 */
export interface CodexSubscriptionClaimsAbsentError {
  readonly code: "CODEX_SUBSCRIPTION_CLAIMS_ABSENT";
  readonly message: string;
  readonly path: string;
}

/** The subscription claims are present and one is not an ISO-8601 instant with an offset. */
export interface CodexSubscriptionClaimsInvalidError {
  readonly code: "CODEX_SUBSCRIPTION_CLAIMS_INVALID";
  readonly message: string;
  readonly path: string;
}

/** Every failure kind reading a Codex store's subscription dates can produce. */
export type CodexSubscriptionDatesError =
  | CodexSubscriptionAuthUnreadableError
  | CodexSubscriptionAuthInvalidError
  | CodexSubscriptionIdTokenInvalidError
  | CodexSubscriptionClaimsAbsentError
  | CodexSubscriptionClaimsInvalidError;

/** Construct a {@link CodexSubscriptionDatesError}. Tests build fixtures through here, never as object literals. */
export const CodexSubscriptionDatesErrors = {
  authUnreadable: ({ path }: { path: string }): CodexSubscriptionAuthUnreadableError => ({
    code: "CODEX_SUBSCRIPTION_AUTH_UNREADABLE",
    message: `${path} could not be read, so this store states no subscription date`,
    path,
  }),
  authInvalid: ({ path }: { path: string }): CodexSubscriptionAuthInvalidError => ({
    code: "CODEX_SUBSCRIPTION_AUTH_INVALID",
    message: `${path} is not JSON carrying a tokens.id_token string, so its subscription dates could not be read`,
    path,
  }),
  idTokenInvalid: ({ path }: { path: string }): CodexSubscriptionIdTokenInvalidError => ({
    code: "CODEX_SUBSCRIPTION_ID_TOKEN_INVALID",
    message: `the id_token in ${path} is not a JWT whose payload decodes, so its subscription dates could not be read`,
    path,
  }),
  claimsAbsent: ({ path }: { path: string }): CodexSubscriptionClaimsAbsentError => ({
    code: "CODEX_SUBSCRIPTION_CLAIMS_ABSENT",
    message: `the sign-in in ${path} carries no ChatGPT subscription dates`,
    path,
  }),
  claimsInvalid: ({ path }: { path: string }): CodexSubscriptionClaimsInvalidError => ({
    code: "CODEX_SUBSCRIPTION_CLAIMS_INVALID",
    message: `the sign-in in ${path} carries a subscription date that is not an ISO-8601 instant`,
    path,
  }),
} as const;
