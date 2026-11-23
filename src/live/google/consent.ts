/**
 * The EFFECTFUL half of the Google user-consent flow, shared by every Google door here: the loopback wait,
 * one browser hand-off, the token exchange, and the identity call that says which account was bound. The pure
 * half — the URL, the PKCE pair, the parsers — is `./oauth.ts`. The loopback listener itself, the one inbound
 * socket in this product, is `../oauth/loopback.ts`, shared with the Outlook door; Google's installed-app flow
 * redirects to `http://127.0.0.1:<port>`, which is that listener's default.
 *
 * ## Why it is generic over the door's error type
 *
 * `.claude/rules/error-handling.md` forbids one error union shared across domains, and a mail failure and a
 * Drive failure are different domains however alike their shapes. So the flow takes the door's own
 * `consentFailed` FACTORY and never names an error type of its own: the mechanism is shared, the vocabulary
 * is not. The same argument decides the `provider` parameter — it selects the rate-limit entry and prefixes
 * the operation labels, so each door is paced and recorded against itself.
 */
import { safeProviderCall, scopeIdForToken } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import { awaitLoopbackCallback, type LoopbackError, presentConsentUrl } from "../oauth/loopback.js";
import {
  buildConsentUrl,
  type ConsentSecrets,
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_USERINFO_ENDPOINT,
  type GoogleTokenResponse,
  makeConsentSecrets,
  parseConsentCallback,
  parseTokenResponse,
  parseUserinfoEmail,
  tokenExchangeBody,
} from "./oauth.js";

/** The outcome of one completed consent round trip. */
export interface ConsentOutcome {
  readonly tokens: GoogleTokenResponse;
  readonly account: string;
}

/**
 * The door's own way of naming a consent failure — see this file's header for why it is injected.
 *
 * @internal — the declared shape of the `errors` argument; each door passes its own factory object.
 */
export interface ConsentErrorFactory<TError> {
  readonly consentFailed: (args: { message: string; cause?: unknown }) => TError;
}

/** The seams {@link runGoogleConsentFlow} performs its effects through, so the shell is testable with fakes. */
export interface ConsentDeps<TError> {
  /** Bind a loopback listener and resolve with the first request's URL, or reject the reason it failed. */
  readonly awaitCallback: (args: {
    onListening: (args: { redirectUri: string }) => void;
  }) => Promise<Result<{ requestUrl: string }, LoopbackError>>;
  /** POST a form-encoded body and return the raw response text. */
  readonly postForm: (args: { url: string; body: string; operation: string }) => Promise<Result<string, TError>>;
  /** GET a bearer-authenticated endpoint and return the raw response text. */
  readonly getWithToken: (args: {
    url: string;
    accessToken: string;
    operation: string;
  }) => Promise<Result<string, TError>>;
  /** Hand the consent URL to the owner: open a browser if it can, and always print it. */
  readonly present: (args: { url: string }) => void;
}

/**
 * POST a form-encoded body through the paced provider door.
 *
 * @param url the endpoint
 * @param body the form-encoded request body
 * @param operation the registered operation label
 * @param provider the rate-limit registry entry this call is paced against
 * @param scopeId what the shared 429 block counts this call against
 * @param errors the door's own failure factory
 * @returns the raw response text, or the door's typed error
 */
async function postFormThroughDoor<TError>({
  url,
  body,
  operation,
  provider,
  scopeId,
  errors,
}: {
  url: string;
  body: string;
  operation: string;
  provider: string;
  scopeId: string;
  errors: ConsentErrorFactory<TError>;
}): Promise<Result<string, TError>> {
  const result = await safeProviderCall({
    execute: async () => {
      const response = await fetch(url, {
        body,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
      });
      return response.text();
    },
    operation,
    provider,
    // An authorisation code is single-use: a second exchange of the same code is refused by Google, so a
    // retry could only ever turn a transient network fault into a confusing `invalid_grant`.
    retryMode: "never",
    scopeId,
  });
  if (result.isErr()) {
    return err(errors.consentFailed({ cause: result.error, message: result.error.message }));
  }
  return ok(result.value);
}

/**
 * GET a bearer-authenticated endpoint through the paced provider door.
 *
 * @param url the endpoint
 * @param accessToken the freshly minted access token
 * @param operation the registered operation label
 * @param provider the rate-limit registry entry this call is paced against
 * @param scopeId what the shared 429 block counts this call against
 * @param errors the door's own failure factory
 * @returns the raw response text, or the door's typed error
 */
async function getWithTokenThroughDoor<TError>({
  url,
  accessToken,
  operation,
  provider,
  scopeId,
  errors,
}: {
  url: string;
  accessToken: string;
  operation: string;
  provider: string;
  scopeId: string;
  errors: ConsentErrorFactory<TError>;
}): Promise<Result<string, TError>> {
  const result = await safeProviderCall({
    execute: async () => {
      const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
      return response.text();
    },
    operation,
    provider,
    retryMode: "transient",
    scopeId,
  });
  if (result.isErr()) {
    return err(errors.consentFailed({ cause: result.error, message: result.error.message }));
  }
  return ok(result.value);
}

/**
 * Run one complete consent round trip: listen, hand the URL over, exchange the code, and read the identity.
 *
 * @param clientId the Desktop-app OAuth client id
 * @param clientSecret the Desktop-app OAuth client secret
 * @param scopes the scope URIs to request
 * @param provider the rate-limit registry entry, which also prefixes the two operation labels
 * @param errors the door's own failure factory
 * @param deps the injected effect seams
 * @param secrets the PKCE/CSRF secrets for this flow, generated fresh when not supplied
 * @returns the granted tokens and the bound account, or the typed reason consent did not complete
 */
export async function runGoogleConsentFlow<TError>({
  clientId,
  clientSecret,
  scopes,
  provider,
  errors,
  deps,
  secrets = makeConsentSecrets(),
}: {
  clientId: string;
  clientSecret: string;
  scopes: readonly string[];
  provider: string;
  errors: ConsentErrorFactory<TError>;
  deps: ConsentDeps<TError>;
  secrets?: ConsentSecrets;
}): Promise<Result<ConsentOutcome, TError>> {
  let redirectUri = "";
  const callback = await deps.awaitCallback({
    onListening: ({ redirectUri: uri }) => {
      redirectUri = uri;
      deps.present({ url: buildConsentUrl({ clientId, redirectUri: uri, scopes, secrets }) });
    },
  });
  if (callback.isErr()) {
    return err(errors.consentFailed({ message: callback.error.message }));
  }
  const parsed = parseConsentCallback({ expectedState: secrets.state, requestUrl: callback.value.requestUrl });
  if (parsed.isErr()) {
    return err(errors.consentFailed({ message: parsed.error.message }));
  }
  const exchanged = await deps.postForm({
    body: tokenExchangeBody({
      clientId,
      clientSecret,
      code: parsed.value.code,
      codeVerifier: secrets.codeVerifier,
      redirectUri,
    }),
    operation: `${provider}.oauth.tokenExchange`,
    url: GOOGLE_TOKEN_ENDPOINT,
  });
  if (exchanged.isErr()) {
    return err(exchanged.error);
  }
  const tokens = parseTokenResponse({ body: exchanged.value });
  if (tokens.isErr()) {
    return err(errors.consentFailed({ message: tokens.error.message }));
  }
  return identify({ deps, errors, provider, tokens: tokens.value });
}

/** Read the bound account with the freshly minted access token. */
async function identify<TError>({
  deps,
  errors,
  provider,
  tokens,
}: {
  deps: ConsentDeps<TError>;
  errors: ConsentErrorFactory<TError>;
  provider: string;
  tokens: GoogleTokenResponse;
}): Promise<Result<ConsentOutcome, TError>> {
  const userinfo = await deps.getWithToken({
    accessToken: tokens.accessToken,
    operation: `${provider}.oauth.userinfo`,
    url: GOOGLE_USERINFO_ENDPOINT,
  });
  if (userinfo.isErr()) {
    return err(userinfo.error);
  }
  const account = parseUserinfoEmail({ body: userinfo.value });
  if (account.isErr()) {
    return err(errors.consentFailed({ message: account.error.message }));
  }
  return ok({ account: account.value, tokens });
}

/**
 * The production consent seams. The 429 block is scoped by a digest of the CLIENT id, because at consent
 * time there is no account credential yet to scope by.
 *
 * @param clientId the Desktop-app OAuth client id, hashed into the rate scope
 * @param provider the rate-limit registry entry this door is paced against
 * @param productName the door's own name, shown in the browser and in the printed line
 * @param errors the door's own failure factory
 * @param writeLine where the consent URL is printed
 * @returns the effect seams {@link runGoogleConsentFlow} composes
 */
export function productionConsentDeps<TError>({
  clientId,
  provider,
  productName,
  errors,
  writeLine,
}: {
  clientId: string;
  provider: string;
  productName: string;
  errors: ConsentErrorFactory<TError>;
  writeLine: (line: string) => void;
}): ConsentDeps<TError> {
  const scopeId = scopeIdForToken({ token: clientId });
  return {
    awaitCallback: ({ onListening }) => awaitLoopbackCallback({ onListening, productName }),
    getWithToken: ({ url, accessToken, operation }) =>
      getWithTokenThroughDoor({ accessToken, errors, operation, provider, scopeId, url }),
    postForm: ({ url, body, operation }) => postFormThroughDoor({ body, errors, operation, provider, scopeId, url }),
    present: ({ url }) => {
      presentConsentUrl({ productName, url, writeLine });
    },
  };
}
