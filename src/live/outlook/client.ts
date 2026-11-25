/**
 * The ONLY file that imports MSAL or the Microsoft Graph SDK (`scheduler-bypass` holds both packages to it), so
 * every token Microsoft issues this door and every Graph request it sends is built here or by a caller holding a
 * client this file built.
 *
 * ## Three decisions, each measured against the pinned packages rather than assumed
 *
 * - **Both SDKs reach the network through the global `fetch`, at request time.** MSAL goes through
 *   {@link identityRequest} below, and the Graph SDK 3.0.7 through its `HTTPMessageHandler`. So a test
 *   that remaps `globalThis.fetch` in the spawned CLI sees every sign-in and Graph call with no override in
 *   production code; nothing here can be pointed at another host.
 * - **No Graph `RetryHandler`.** The SDK's default chain retries a 429 itself, including a POST, beneath
 *   `safeProviderCall`'s own retry — doubling a move or a send. The chain is authentication, then the wire.
 * - **The MSAL cache is the grant.** Each process deserializes the stored cache, asks `acquireTokenSilent`
 *   for the account the grant names by `homeAccountId`, and returns the re-serialized cache whether or not it
 *   changed, so the caller writes a rotated refresh token back before it uses the token it bought.
 * - **Every network call has a deadline.** A silent refresh runs while holding the grant lock, so a token
 *   request that never answers would otherwise hang this process and leave every later Outlook verb waiting
 *   for that lock until it gives up as `GRANT_BUSY`. MSAL Node 7.0.1's own client takes no timeout on a POST
 *   (`HttpClient.sendPostRequestAsync`), and racing the call from outside would release the lock while the
 *   request still ran and could still rotate the token. So MSAL is given its own network client, and both it and
 *   the Graph chain's first middleware hand `fetch` an `AbortSignal.timeout`, which CANCELS the request and its
 *   body read rather than abandoning it. A timeout reaches `safeProviderCall` as a failure: a write reports its
 *   outcome as unknown and is never retried, and a read retries like any dropped connection.
 *
 * Every MSAL call sits directly inside `safeProviderCall` with `retryMode: "never"`: an authorization code is
 * single-use, and a refresh that rotated the token must not be replayed after an ambiguous answer.
 */
import {
  type AuthenticationResult,
  CryptoProvider,
  type INetworkModule,
  InteractionRequiredAuthError,
  type NetworkRequestOptions,
  type NetworkResponse,
  PublicClientApplication,
} from "@azure/msal-node";
import {
  AuthenticationHandler,
  Client,
  HTTPMessageHandler,
  type Middleware,
  ResponseType,
} from "@microsoft/microsoft-graph-client";
import { z } from "zod";

import { defineBoundary } from "#lib/boundary.js";
import type { IngestError } from "#lib/ingestError.js";
import { safeProviderCall, scopeIdForToken } from "#lib/providerCall.js";
import { err, ok, type Result, type ResultAsync } from "#lib/result.js";
import { OUTLOOK_AUTHORITY, OUTLOOK_AUTHORITY_METADATA, OUTLOOK_CLOUD_DISCOVERY_METADATA } from "./authority.js";
import { type OutlookError, OutlookErrors } from "./errors.js";
import { type OutlookProduct, outlookConnectVerb, outlookProductName } from "./scopes.js";

/** The Graph SDK client, under this door's name, so no other file imports the SDK to type it. */
export type GraphClient = Client;

/** The middleware types, re-exported so a test's recording wire is typed without importing the SDK itself. */
export type { Context as GraphContext, Middleware as GraphMiddleware } from "@microsoft/microsoft-graph-client";
/** The SDK's error class, re-exported so `graphThrow.ts` can recognise it without importing the SDK itself. */
export { GraphError } from "@microsoft/microsoft-graph-client";

/** The response type that makes the SDK hand back a file's bytes whatever MIME type Graph labels them. */
export const ARRAYBUFFER_RESPONSE = ResponseType.ARRAYBUFFER;

/**
 * The response type for an answer with no body (`send`'s 202). Left to sniff, the SDK hands back the raw
 * stream for a response with no content type; as text an empty answer is `""`, which the caller can require.
 */
export const TEXT_RESPONSE = ResponseType.TEXT;

/** What one token acquisition hands back: the bearer, and the facts the grant records. */
export interface OutlookToken {
  readonly accessToken: string;
  readonly homeAccountId: string;
  /** The scopes Microsoft says the token carries, in whatever spelling it used. */
  readonly scopes: readonly string[];
  readonly expiryMs: number | undefined;
  /** MSAL's cache after the call, to be written back before the token is used. */
  readonly msalCache: string;
}

/** A PKCE pair and a state value for one consent round trip. */
export interface ConsentSecrets {
  readonly verifier: string;
  readonly challenge: string;
  readonly state: string;
}

/**
 * How long one MSAL request may take, body included, before it is cancelled. A chosen bound, not a measurement:
 * a token endpoint answers in well under a second, and this is held while the grant lock is, so it stays short
 * of the lock's own wait.
 */
const OUTLOOK_TOKEN_DEADLINE_MS = 30_000;

/**
 * How long one Graph request may take, body included. A chosen bound, not a measurement: it has to cover a
 * 25 MiB attachment's `$value` on a slow link, and nothing holds the grant lock while it runs.
 */
const OUTLOOK_GRAPH_DEADLINE_MS = 120_000;

/**
 * The Graph middleware that gives each request its own deadline. It is the first link in the chain, so the
 * signal is on the options before authentication and the wire read them.
 *
 * @param deadlineMs how long each request may run before its fetch is aborted
 * @returns a middleware to set ahead of authentication
 */
export function graphDeadlineMiddleware({ deadlineMs }: { deadlineMs: number }): Required<Middleware> {
  const chain: { next: Middleware | undefined } = { next: undefined };
  return {
    execute: async (context) => {
      if (chain.next === undefined) {
        throw new Error("the Graph deadline middleware was built with no next handler");
      }
      context.options = { ...context.options, signal: AbortSignal.timeout(deadlineMs) };
      await chain.next.execute(context);
    },
    setNext: (next) => {
      chain.next = next;
    },
  };
}

/**
 * The identity platform's answer as this transport hands it on: one flat JSON object. MSAL owns its field names
 * and reads them itself, success and error alike, so the wrapper claims only the shape it transports
 * (`area-live.md`): every value a scalar, or a list of them as `error_codes` is. Both discovery documents are
 * pinned (`authority.ts`), so no nested metadata document ever comes through here.
 */
const IDENTITY_ANSWER = defineBoundary({
  endpoint: "login.microsoftonline.com/consumers (every MSAL request)",
  schema: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number()]))]),
  ),
});

/**
 * One MSAL request over the global `fetch`, cancelled once its deadline passes — headers and body read alike,
 * since the signal stays on the response, so a stalled refresh is closed rather than left running to rotate
 * the token after its caller gave up. It throws, as MSAL's own client does, because MSAL is the caller and
 * maps a throw itself. `T` is the response type MSAL's own call names; it reads the fields itself, so the
 * body is handed on as that type once the boundary has checked it is a flat JSON object.
 *
 * @param options MSAL's headers and form body for the request
 * @param deadlineMs how long the request may run, {@link OUTLOOK_TOKEN_DEADLINE_MS} in production
 * @returns the status, headers and JSON object the identity platform answered
 */
export async function identityRequest<T>({
  url,
  method,
  options,
  deadlineMs,
}: {
  url: string;
  method: "GET" | "POST";
  options: NetworkRequestOptions | undefined;
  deadlineMs: number;
}): Promise<NetworkResponse<T>> {
  const response = await fetch(url, {
    ...(method === "POST" && options?.body !== undefined ? { body: options.body } : {}),
    headers: new Headers(options?.headers),
    method,
    signal: AbortSignal.timeout(deadlineMs),
  });
  const body = IDENTITY_ANSWER.parse({ value: await response.json() });
  if (body.isErr()) {
    throw new Error(body.error.message);
  }
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  // `as`: MSAL's `INetworkModule` is generic in `T` and reads the fields itself; the boundary above has
  // checked the body is the flat JSON object every MSAL response type is, which is all this transport claims.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return { body: body.value as T, headers, status: response.status };
}

/** Build the personal-account public client, with no discovery call and no logging of personal data. */
function publicClient({ clientId }: { clientId: string }): PublicClientApplication {
  // devlint: sdk-factory -- the one MSAL client: /consumers, both discovery documents pinned, PII logging off, every request deadlined
  return new PublicClientApplication({
    auth: {
      authority: OUTLOOK_AUTHORITY,
      authorityMetadata: OUTLOOK_AUTHORITY_METADATA,
      clientId,
      cloudDiscoveryMetadata: OUTLOOK_CLOUD_DISCOVERY_METADATA,
    },
    system: {
      loggerOptions: { loggerCallback: () => undefined, piiLoggingEnabled: false },
      networkClient: {
        // MSAL's own `timeout` argument is ignored: every request carries this door's deadline instead.
        sendGetRequestAsync: (url, options) =>
          identityRequest({ deadlineMs: OUTLOOK_TOKEN_DEADLINE_MS, method: "GET", options, url }),
        sendPostRequestAsync: (url, options) =>
          identityRequest({ deadlineMs: OUTLOOK_TOKEN_DEADLINE_MS, method: "POST", options, url }),
      } satisfies INetworkModule,
    },
  });
}

/**
 * Build the Graph client over a given terminal: the deadline, then authentication, then `wire`. The door passes
 * the network ({@link makeGraphClient}); a unit test passes a recording terminal, so the chain it exercises is
 * this one and no test file builds an SDK client of its own.
 *
 * @param accessToken the bearer from {@link acquireOutlookToken}
 * @param wire the last link, which sends the request and sets `context.response`
 * @returns the SDK client
 */
export function graphClientOverWire({ accessToken, wire }: { accessToken: string; wire: Middleware }): GraphClient {
  const deadline = graphDeadlineMiddleware({ deadlineMs: OUTLOOK_GRAPH_DEADLINE_MS });
  const auth = new AuthenticationHandler({ getAccessToken: () => Promise.resolve(accessToken) });
  deadline.setNext(auth);
  auth.setNext(wire);
  // devlint: sdk-factory -- the one Graph client: a per-request deadline, no RetryHandler under safeProviderCall's own retry
  return Client.initWithMiddleware({ defaultVersion: "v1.0", middleware: deadline });
}

/**
 * Build a Graph client that sends one already-acquired bearer, through authentication and the wire only.
 *
 * @param accessToken the bearer from {@link acquireOutlookToken}
 * @returns the SDK client; callers name it `graph`, which is what `boundary-residue` watches
 */
export function makeGraphClient({ accessToken }: { accessToken: string }): GraphClient {
  return graphClientOverWire({ accessToken, wire: new HTTPMessageHandler() });
}

/** The token facts and the cache, out of one MSAL answer. */
function tokenOf({
  result,
  cache,
}: {
  result: AuthenticationResult;
  cache: string;
}): Result<OutlookToken, OutlookError> {
  if (result.account === null) {
    return err(OutlookErrors.responseFieldMissing({ field: "account", operation: "outlook.msal" }));
  }
  return ok({
    accessToken: result.accessToken,
    expiryMs: result.expiresOn === null ? undefined : result.expiresOn.getTime(),
    homeAccountId: result.account.homeAccountId,
    msalCache: cache,
    scopes: result.scopes,
  });
}

/** Map an MSAL failure: a refresh Microsoft refuses becomes "connect again", everything else an API failure. */
function msalError({ error, product }: { error: IngestError; product: OutlookProduct }): OutlookError {
  if (error.cause instanceof InteractionRequiredAuthError) {
    return OutlookErrors.interactionRequired({ cause: error.cause, product });
  }
  return OutlookErrors.apiFailed({ cause: error, message: error.message });
}

/**
 * Mint the PKCE pair and state for one consent, with MSAL's own crypto provider.
 *
 * @returns the verifier, its S256 challenge and a fresh state value
 */
export async function makeConsentSecrets(): Promise<ConsentSecrets> {
  const crypto = new CryptoProvider();
  const pkce = await crypto.generatePkceCodes();
  return { challenge: pkce.challenge, state: crypto.createNewGuid(), verifier: pkce.verifier };
}

/**
 * The consent URL for one round trip. Local work with both discovery documents pinned, but routed through the
 * door anyway, because nothing here may assume MSAL makes no request.
 *
 * @param clientId the app registration's client id
 * @param scopes the permissions to ask for
 * @param redirectUri the loopback URI the listener announced
 * @param secrets this round trip's PKCE pair and state
 * @param product which product's consent this is, so a refusal names that product's connect verb
 * @returns the URL to send the owner to
 */
export function outlookConsentUrl({
  clientId,
  scopes,
  redirectUri,
  secrets,
  product,
}: {
  clientId: string;
  scopes: readonly string[];
  redirectUri: string;
  secrets: ConsentSecrets;
  product: OutlookProduct;
}): ResultAsync<string, OutlookError> {
  const app = publicClient({ clientId });
  return safeProviderCall({
    execute: () =>
      app.getAuthCodeUrl({
        codeChallenge: secrets.challenge,
        codeChallengeMethod: "S256",
        prompt: "select_account",
        redirectUri,
        scopes: [...scopes],
        state: secrets.state,
      }),
    operation: "outlook.msal.getAuthCodeUrl",
    provider: "outlook",
    retryMode: "never",
    scopeId: scopeIdForToken({ token: clientId }),
  }).mapErr((error) => msalError({ error, product }));
}

/**
 * Redeem the authorization code the loopback callback carried, into a token and a fresh cache.
 *
 * @param clientId the app registration's client id
 * @param scopes the permissions the consent asked for
 * @param redirectUri the exact URI the consent used
 * @param code the callback's `code`
 * @param clientInfo the callback's `client_info`, when Microsoft sent one — MSAL keys the account on it
 * @param verifier the PKCE verifier whose challenge the consent carried
 * @param product which product's consent this is, so a refusal names that product's connect verb
 * @returns the token facts and the cache to store, or why the exchange failed
 */
export async function redeemOutlookCode({
  clientId,
  scopes,
  redirectUri,
  code,
  clientInfo,
  verifier,
  product,
}: {
  clientId: string;
  scopes: readonly string[];
  redirectUri: string;
  code: string;
  clientInfo: string | undefined;
  verifier: string;
  product: OutlookProduct;
}): Promise<Result<OutlookToken, OutlookError>> {
  const app = publicClient({ clientId });
  const redeemed = await safeProviderCall({
    execute: () =>
      app.acquireTokenByCode({
        code,
        codeVerifier: verifier,
        redirectUri,
        scopes: [...scopes],
        ...(clientInfo !== undefined ? { clientInfo } : {}),
      }),
    operation: "outlook.msal.acquireTokenByCode",
    provider: "outlook",
    retryMode: "never",
    scopeId: scopeIdForToken({ token: clientId }),
  });
  if (redeemed.isErr()) {
    return err(msalError({ error: redeemed.error, product }));
  }
  return tokenOf({ cache: app.getTokenCache().serialize(), result: redeemed.value });
}

/**
 * Buy a token silently from a stored cache, refreshing (and rotating the refresh token) when MSAL must.
 *
 * @param clientId the app registration's client id
 * @param msalCache the grant's serialized cache
 * @param homeAccountId the account the grant was bound to, as MSAL keys it
 * @param scopes the permissions to ask the token for
 * @param product whose connect verb every refusal names as the remedy
 * @param cacheGrant which product's grant file the cache was read from, named when the cache itself is refused —
 *   the mail grant's when the calendar reads over it, while the remedy stays the calendar's own connect
 * @returns the token facts and the cache to write back, or why no token could be had without the owner
 */
export async function acquireOutlookToken({
  clientId,
  msalCache,
  homeAccountId,
  scopes,
  product,
  cacheGrant,
}: {
  clientId: string;
  msalCache: string;
  homeAccountId: string;
  scopes: readonly string[];
  product: OutlookProduct;
  cacheGrant: OutlookProduct;
}): Promise<Result<OutlookToken, OutlookError>> {
  const app = publicClient({ clientId });
  const cache = app.getTokenCache();
  const name = outlookProductName({ product: cacheGrant });
  const verb = outlookConnectVerb({ product });
  // A cache that will not deserialize is refused WITHOUT its parser's message: V8 quotes the input it choked
  // on, and that input is the refresh token. Repro: node -e 'try{JSON.parse("REFRESH_TOKEN")}catch(e){console.log(e.message)}'
  try {
    cache.deserialize(msalCache);
  } catch {
    return err(
      OutlookErrors.credentialUnreadable({
        message:
          `the stored ${name} grant's cache is not a readable MSAL cache (the parser's detail is withheld: it ` +
          `quotes the cache) — run \`${verb}\` again`,
      }),
    );
  }
  const account = await cache.getAccountByHomeId(homeAccountId);
  if (account === null) {
    return err(
      OutlookErrors.credentialUnreadable({
        message: `the stored ${name} grant's cache does not hold the account it names — run \`${verb}\` again`,
      }),
    );
  }
  const acquired = await safeProviderCall({
    execute: () => app.acquireTokenSilent({ account, scopes: [...scopes] }),
    operation: "outlook.msal.acquireTokenSilent",
    provider: "outlook",
    retryMode: "never",
    scopeId: scopeIdForToken({ token: homeAccountId }),
  });
  if (acquired.isErr()) {
    return err(msalError({ error: acquired.error, product }));
  }
  return tokenOf({ cache: cache.serialize(), result: acquired.value });
}
