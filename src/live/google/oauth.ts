/**
 * The PURE half of the Google user-consent flow, shared by EVERY Google door here: the authorisation URL,
 * the CSRF state, the PKCE pair, and the parsers that read what comes back. No sockets, no clock, no
 * browser — those live in `consent.ts`, so everything decidable without I/O is unit-testable without a seam.
 *
 * Nothing in this file names a Google product. The mail door and the Drive door differ in the SCOPES they
 * ask for and in nothing else about the handshake, which is why the handshake lives here once rather than
 * once per door: `src/devLint/duplicateWindows.ts` would flag a second copy, and it would be right to.
 *
 * ## Why loopback, and why PKCE on a "confidential" client
 *
 * Google's installed-app flow redirects to `http://127.0.0.1:<port>` — the out-of-band `urn:ietf:wg:oauth`
 * redirect it replaced was retired, and a hosted redirect would mean running a server this product does not
 * have. The client secret of a Desktop-app client is therefore not a secret in the usual sense (it ships
 * with the application), which is exactly why PKCE is applied anyway: the code challenge is what actually
 * binds the authorisation code to this process, and a code intercepted on the loopback interface is useless
 * without the verifier that never left it.
 *
 * `access_type=offline` + `prompt=consent` are both load-bearing rather than defensive. Google issues a
 * refresh token only for an offline grant, and only on the FIRST consent for a given client/account pair —
 * so a re-run that omits `prompt=consent` returns an access token with no refresh token, and the grant this
 * repo stores would be unusable an hour later. Measured behaviour of Google's own endpoint, not a guess.
 *
 * ## The parameter that is DELIBERATELY absent: `include_granted_scopes`
 *
 * Google's incremental authorisation, switched on with `include_granted_scopes=true`, mints a token
 * covering every scope the CLIENT already holds for the account rather than the scopes the screen asked
 * for. So a consent screen asking only for readonly scopes, through a client once granted write scopes on
 * the same account, lands a grant carrying those writes too — none of them on the screen.
 *
 * Without it, a stored grant equals its own consent screen, which is the property every door's status
 * report and every capability check is written as if it had. The cost is that a door widening its grant
 * must request its whole capability set rather than the delta, and every door here already does exactly
 * that — `scopesToRequest` builds the full set on every consent. So there is no delta to lose.
 *
 * It is the SECOND half of the separation, not the whole of it: the first is that the Google Workspace
 * Admin door consents through its own OAuth client (`google-admin-client-id`), so the merge could not
 * cross the user-data/admin line even if this parameter came back. The rule: write on
 * gmail, Drive, Docs and calendar; read-only on Google admin. `actsOnlyAsTheBoundAccount.test.ts` is what
 * keeps both halves true.
 */
import { createHash, randomBytes } from "node:crypto";

import { err, ok, type Result } from "../../lib/result.js";
import { type GoogleOauthError, GoogleOauthErrors } from "./errors.js";

/** Google's authorisation endpoint — where the browser is sent for consent. */
export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

/** Google's token endpoint — where an authorisation code is exchanged and a refresh token is spent. */
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Google's OpenID userinfo endpoint — the one call that says which mailbox a grant bound to. */
export const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

/** Google's revocation endpoint — where a stored grant is withdrawn for good. */
export const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/** PKCE verifier length. RFC 7636 allows 43-128 characters; 64 random bytes lands comfortably inside that. */
const VERIFIER_BYTES = 64;

/** CSRF state length — enough entropy that a guess is not a threat, short enough to sit in a URL. */
const STATE_BYTES = 32;

/** The one-flow secrets: the PKCE pair and the CSRF state, generated together and never reused. */
export interface ConsentSecrets {
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly state: string;
}

/**
 * Generate a fresh PKCE verifier/challenge pair and a CSRF state.
 *
 * @param randomBase64Url an injectable source of base64url randomness, defaulting to `node:crypto`
 * @returns the three one-flow secrets
 */
export function makeConsentSecrets({
  randomBase64Url = ({ bytes }) => randomBytes(bytes).toString("base64url"),
}: { randomBase64Url?: (args: { bytes: number }) => string } = {}): ConsentSecrets {
  const codeVerifier = randomBase64Url({ bytes: VERIFIER_BYTES });
  return {
    codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url"),
    codeVerifier,
    state: randomBase64Url({ bytes: STATE_BYTES }),
  };
}

/**
 * Build the consent URL the owner opens in a browser.
 *
 * @param clientId the Desktop-app OAuth client id
 * @param redirectUri the loopback redirect this process is listening on
 * @param scopes the scope URIs to request
 * @param secrets the PKCE challenge and CSRF state for this flow
 * @param loginHint the mailbox to preselect on the account chooser, when the caller knows which one
 * @returns the complete authorisation URL
 */
export function buildConsentUrl({
  clientId,
  redirectUri,
  scopes,
  secrets,
  loginHint,
}: {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  secrets: ConsentSecrets;
  loginHint?: string;
}): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", secrets.state);
  url.searchParams.set("code_challenge", secrets.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  if (loginHint !== undefined) {
    url.searchParams.set("login_hint", loginHint);
  }
  return url.toString();
}

/**
 * What the browser handed back on the loopback redirect.
 *
 * @internal — the declared shape of `parseConsentCallback`'s success value; callers destructure it.
 */
export interface ConsentCallback {
  readonly code: string;
}

/**
 * Read the loopback callback's query string, checking the CSRF state before anything else is believed.
 *
 * @param requestUrl the raw request URL the loopback server received (path plus query)
 * @param expectedState the state this flow generated
 * @returns the authorisation code, or every reason the callback is not usable
 */
export function parseConsentCallback({
  requestUrl,
  expectedState,
}: {
  requestUrl: string;
  expectedState: string;
}): Result<ConsentCallback, GoogleOauthError> {
  const query = new URL(requestUrl, "http://127.0.0.1").searchParams;
  const error = query.get("error");
  if (error !== null) {
    return err(GoogleOauthErrors.consentRefused({ reason: error }));
  }
  if (query.get("state") !== expectedState) {
    return err(GoogleOauthErrors.callbackStateMismatch());
  }
  const code = query.get("code");
  if (code === null || code.length === 0) {
    return err(GoogleOauthErrors.callbackCodeMissing());
  }
  return ok({ code });
}

/** The fields this repo reads off a Google token response. */
export interface GoogleTokenResponse {
  readonly accessToken: string;
  readonly refreshToken?: string;
  /** How long the refresh token lives, when Google says: only for a client whose consent screen is in Testing. */
  readonly refreshTokenExpiresInSeconds?: number;
  readonly expiresInSeconds: number;
  readonly scope: string | undefined;
}

/**
 * Read one of Google's JSON response bodies into a record, naming WHICH endpoint refused to parse.
 *
 * Three endpoints here answer JSON and all three fail the same two ways, so the two refusals are raised
 * once with the endpoint as a field rather than three times with it baked in.
 *
 * @param body the raw response body
 * @param endpoint how the failure names the endpoint to a reader ("token", "userinfo", "revocation")
 * @returns the parsed object's own fields, or the reason the body could not be read
 */
function parseGoogleJsonObject({
  body,
  endpoint,
}: {
  body: string;
  endpoint: string;
}): Result<Record<string, unknown>, GoogleOauthError> {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return err(GoogleOauthErrors.notJson({ endpoint }));
  }
  if (typeof json !== "object" || json === null) {
    return err(GoogleOauthErrors.notAnObject({ endpoint }));
  }
  return ok({ ...json });
}

/**
 * Parse a token-endpoint response body, refusing anything that does not carry the fields the grant needs.
 *
 * A body with no `refresh_token` is NOT rejected here: a refresh (as opposed to a first exchange) returns
 * only an access token by design, and the caller knows which of the two it asked for.
 *
 * @param body the raw response body
 * @returns the parsed token fields, or every reason the body could not be read
 */
export function parseTokenResponse({ body }: { body: string }): Result<GoogleTokenResponse, GoogleOauthError> {
  const parsed = parseGoogleJsonObject({ body, endpoint: "token" });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const record = parsed.value;
  const errorCode = record["error"];
  if (typeof errorCode === "string") {
    return err(GoogleOauthErrors.tokenExchangeRefused({ description: record["error_description"], errorCode }));
  }
  const accessToken = record["access_token"];
  const expiresIn = record["expires_in"];
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return err(GoogleOauthErrors.tokenFieldMissing({ field: "access_token" }));
  }
  if (expiresIn === undefined) {
    return err(GoogleOauthErrors.tokenFieldMissing({ field: "expires_in" }));
  }
  const lifetime = tokenLifetime({ field: "expires_in", value: expiresIn });
  if (lifetime.isErr()) {
    return err(lifetime.error);
  }
  const refreshLifetime = optionalRefreshLifetime({ value: record["refresh_token_expires_in"] });
  if (refreshLifetime.isErr()) {
    return err(refreshLifetime.error);
  }
  const refreshToken = record["refresh_token"];
  const scope = record["scope"];
  return ok({
    accessToken,
    expiresInSeconds: lifetime.value,
    scope: typeof scope === "string" ? scope : undefined,
    ...(typeof refreshToken === "string" && refreshToken.length > 0 ? { refreshToken } : {}),
    ...refreshLifetime.value,
  });
}

/**
 * Read one lifetime field, in whole seconds. The grant stores `grantedAt + seconds * 1000`, so a lifetime whose
 * milliseconds are not a safe integer would become `Infinity` there and be written to disk as JSON `null`, a
 * grant with no expiry again; anything but a positive safe integer is refused as malformed.
 *
 * @param field which of the token response's two lifetimes this is
 * @param value what the response carried there
 * @returns the seconds, or why they cannot be recorded
 */
function tokenLifetime({
  field,
  value,
}: {
  field: "expires_in" | "refresh_token_expires_in";
  value: unknown;
}): Result<number, GoogleOauthError> {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || !Number.isSafeInteger(value * 1000)) {
    return err(GoogleOauthErrors.tokenLifetimeMalformed({ field, value }));
  }
  return ok(value);
}

/**
 * Read `refresh_token_expires_in`, which Google sends only when the OAuth client's consent screen is in Testing
 * status, where a refresh token dies after seven days. A Production client gets none, so absence stays absence
 * rather than becoming a sentinel; a present value is held to the same rule as `expires_in`.
 *
 * @param value what the response carried under `refresh_token_expires_in`
 * @returns the field to spread onto the token response, empty when Google named no lapse
 */
function optionalRefreshLifetime({
  value,
}: {
  value: unknown;
}): Result<{ readonly refreshTokenExpiresInSeconds?: number }, GoogleOauthError> {
  if (value === undefined) {
    return ok({});
  }
  return tokenLifetime({ field: "refresh_token_expires_in", value }).map((seconds) => ({
    refreshTokenExpiresInSeconds: seconds,
  }));
}

/**
 * Read the mailbox address out of an OpenID userinfo response.
 *
 * @param body the raw userinfo response body
 * @returns the bound email address, or the reason it could not be established
 */
export function parseUserinfoEmail({ body }: { body: string }): Result<string, GoogleOauthError> {
  const parsed = parseGoogleJsonObject({ body, endpoint: "userinfo" });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const email = parsed.value["email"];
  if (typeof email !== "string" || email.length === 0) {
    return err(GoogleOauthErrors.emailMissing());
  }
  return ok(email);
}

/**
 * The form-encoded body of a first-exchange token request. Google's token endpoint takes
 * `application/x-www-form-urlencoded`, not JSON — a JSON body is refused with `invalid_request`.
 *
 * @param clientId the Desktop-app OAuth client id
 * @param clientSecret the Desktop-app OAuth client secret
 * @param code the authorisation code the loopback callback carried
 * @param codeVerifier the PKCE verifier that never left this process
 * @param redirectUri the same loopback URI the consent URL named
 * @returns the encoded request body
 */
export function tokenExchangeBody({
  clientId,
  clientSecret,
  code,
  codeVerifier,
  redirectUri,
}: {
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): string {
  return new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  }).toString();
}

/**
 * The form-encoded body of a revocation request. Passing the REFRESH token withdraws the whole
 * `(client, account)` grant — every access token minted from it and every scope it carries — which is
 * Google's own all-or-nothing shape and the only lever that retires a scope a client was granted earlier.
 *
 * @param refreshToken the long-lived credential from the stored grant
 * @returns the encoded request body
 */
export function tokenRevokeBody({ refreshToken }: { refreshToken: string }): string {
  return new URLSearchParams({ token: refreshToken }).toString();
}

/**
 * Read a revocation response. Google answers `200` with an EMPTY body on success and a JSON `error` on
 * failure, so an empty body is the success signal rather than an absence to be suspicious of.
 *
 * @param body the raw response body
 * @returns nothing on success, or the reason Google refused the revocation
 */
export function parseRevokeResponse({ body }: { body: string }): Result<undefined, GoogleOauthError> {
  if (body.trim().length === 0) {
    return ok(undefined);
  }
  const parsed = parseGoogleJsonObject({ body, endpoint: "revocation" });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const errorCode = parsed.value["error"];
  if (typeof errorCode === "string") {
    return err(GoogleOauthErrors.revocationRefused({ description: parsed.value["error_description"], errorCode }));
  }
  return ok(undefined);
}
