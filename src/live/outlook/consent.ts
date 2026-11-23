/**
 * One Outlook consent round trip: listen on the loopback, show the consent URL, take the code the browser
 * brings back, redeem it with MSAL, and ask Graph which mailbox it bound.
 *
 * The listener is `../oauth/loopback.ts`, shared with the Google doors, advertising `http://localhost` — what a
 * portal-made "Mobile and desktop applications" registration accepts (that file's header). Unlike Google's,
 * the consent URL is built by an ASYNC MSAL call that needs the redirect URI first, so the flow waits for the
 * listener to announce itself, builds the URL, and only then presents it; a URL that cannot be built aborts the
 * listener rather than leaving a socket open until its deadline.
 *
 * Every effect is a seam on {@link OutlookConsentDeps}; the ordering and the refusals are tested with plain
 * fakes, and the real MSAL and Graph wiring is {@link productionOutlookConsentDeps}.
 */
import { err, ok, type Result } from "#lib/result.js";
import { awaitLoopbackCallback, type LoopbackError, presentConsentUrl } from "../oauth/loopback.js";
import { makeOutlookApi } from "./api.js";
import type { OutlookIdentity } from "./apiCore.js";
import {
  type ConsentSecrets,
  makeConsentSecrets,
  makeGraphClient,
  type OutlookToken,
  outlookConsentUrl,
  redeemOutlookCode,
} from "./client.js";
import { type OutlookError, OutlookErrors } from "./errors.js";
import { grantedOutlookScopes } from "./scopes.js";

/** What one completed consent hands the grant writer. */
export interface OutlookConsentOutcome {
  readonly account: string;
  readonly homeAccountId: string;
  /** The resource permissions Microsoft reported granted. */
  readonly scopes: readonly string[];
  readonly expiryMs: number | undefined;
  readonly msalCache: string;
}

/** The effects one consent performs, injected so the flow is tested with plain fakes. */
export interface OutlookConsentDeps {
  /** Mint this round trip's PKCE pair and state. */
  readonly makeSecrets: () => Promise<ConsentSecrets>;
  /** Bind the loopback listener; `signal` closes it early. */
  readonly awaitCallback: (args: {
    onListening: (args: { redirectUri: string }) => void;
    signal: AbortSignal;
  }) => Promise<Result<{ requestUrl: string }, LoopbackError>>;
  /** Build the consent URL for the announced redirect. */
  readonly consentUrl: (args: {
    redirectUri: string;
    scopes: readonly string[];
    secrets: ConsentSecrets;
  }) => PromiseLike<Result<string, OutlookError>>;
  /** Hand the URL to the owner. */
  readonly present: (args: { url: string }) => void;
  /** Redeem the code. */
  readonly redeem: (args: {
    code: string;
    clientInfo: string | undefined;
    redirectUri: string;
    scopes: readonly string[];
    verifier: string;
  }) => Promise<Result<OutlookToken, OutlookError>>;
  /** Ask Graph who the token belongs to. */
  readonly identify: (args: { accessToken: string }) => Promise<Result<OutlookIdentity, OutlookError>>;
}

/** What the browser brought back, once checked. */
export interface OutlookCallback {
  readonly code: string;
  /** MSAL keys the account on this; Microsoft sends it because MSAL's consent URL asks for it. */
  readonly clientInfo: string | undefined;
}

/**
 * Read the loopback request the browser made: a refusal Microsoft reported, a foreign state, or the code.
 *
 * @param requestUrl the raw request path and query the listener saw
 * @param expectedState the state this round trip put in the consent URL
 * @returns the code and client info, or why consent did not complete
 */
export function parseOutlookCallback({
  requestUrl,
  expectedState,
}: {
  requestUrl: string;
  expectedState: string;
}): Result<OutlookCallback, OutlookError> {
  const query = new URL(requestUrl, "http://localhost").searchParams;
  const refusal = query.get("error");
  if (refusal !== null) {
    const description = query.get("error_description");
    const detail = description === null ? "" : `: ${description}`;
    return err(OutlookErrors.consentFailed({ message: `Microsoft refused the consent (${refusal})${detail}` }));
  }
  if (query.get("state") !== expectedState) {
    return err(
      OutlookErrors.consentFailed({
        message: "the browser came back with a state this consent did not issue, so its code was not used",
      }),
    );
  }
  const code = query.get("code");
  if (code === null || code === "") {
    return err(OutlookErrors.consentFailed({ message: "the browser came back with no authorization code" }));
  }
  const clientInfo = query.get("client_info");
  if (clientInfo === null) {
    return ok({ clientInfo: undefined, code });
  }
  return ok({ clientInfo, code });
}

/**
 * The mailbox address a `GET /me` names: `mail` when the account has one, else the user principal name, which
 * for a personal Microsoft account IS the sign-in address.
 *
 * @param identity what Graph answered
 * @returns the address, or the refusal when neither is usable
 */
export function accountAddress({ identity }: { identity: OutlookIdentity }): Result<string, OutlookError> {
  if (typeof identity.mail === "string" && identity.mail !== "") {
    return ok(identity.mail);
  }
  if (typeof identity.userPrincipalName === "string" && identity.userPrincipalName !== "") {
    return ok(identity.userPrincipalName);
  }
  return err(OutlookErrors.responseFieldMissing({ field: "mail or userPrincipalName", operation: "outlook.me.get" }));
}

/** The listener announcing itself, or the wait ending first. */
type FirstEvent =
  | { readonly kind: "listening"; readonly redirectUri: string }
  | { readonly kind: "ended"; readonly result: Result<{ requestUrl: string }, LoopbackError> };

/**
 * Run one consent round trip end to end.
 *
 * @param scopes every permission to ask for, `offline_access` included
 * @param deps the effects, production or fake
 * @returns what the grant records, or the typed reason consent did not complete
 */
export async function runOutlookConsent({
  scopes,
  deps,
}: {
  scopes: readonly string[];
  deps: OutlookConsentDeps;
}): Promise<Result<OutlookConsentOutcome, OutlookError>> {
  const secrets = await deps.makeSecrets();
  const controller = new AbortController();
  let announce: (redirectUri: string) => void = () => undefined;
  const announced = new Promise<string>((resolve) => {
    announce = resolve;
  });
  const waiting = deps.awaitCallback({
    onListening: ({ redirectUri }) => {
      announce(redirectUri);
    },
    signal: controller.signal,
  });
  const first = await Promise.race<FirstEvent>([
    announced.then((redirectUri) => ({ kind: "listening", redirectUri })),
    waiting.then((result) => ({ kind: "ended", result })),
  ]);
  if (first.kind === "ended") {
    const message = first.result.isErr() ? first.result.error.message : "the listener ended before it was announced";
    return err(OutlookErrors.consentFailed({ message }));
  }
  const url = await deps.consentUrl({ redirectUri: first.redirectUri, scopes, secrets });
  if (url.isErr()) {
    controller.abort();
    await waiting;
    return err(url.error);
  }
  deps.present({ url: url.value });
  const callback = await waiting;
  if (callback.isErr()) {
    return err(OutlookErrors.consentFailed({ message: callback.error.message }));
  }
  return finishOutlookConsent({
    deps,
    redirectUri: first.redirectUri,
    requestUrl: callback.value.requestUrl,
    scopes,
    secrets,
  });
}

/** Everything after the redirect arrived: check it, redeem its code, and name the mailbox the grant bound to. */
async function finishOutlookConsent({
  deps,
  redirectUri,
  requestUrl,
  scopes,
  secrets,
}: {
  deps: OutlookConsentDeps;
  redirectUri: string;
  requestUrl: string;
  scopes: readonly string[];
  secrets: ConsentSecrets;
}): Promise<Result<OutlookConsentOutcome, OutlookError>> {
  const parsed = parseOutlookCallback({ expectedState: secrets.state, requestUrl });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const token = await deps.redeem({
    clientInfo: parsed.value.clientInfo,
    code: parsed.value.code,
    redirectUri,
    scopes,
    verifier: secrets.verifier,
  });
  if (token.isErr()) {
    return err(token.error);
  }
  const identity = await deps.identify({ accessToken: token.value.accessToken });
  if (identity.isErr()) {
    return err(identity.error);
  }
  const account = accountAddress({ identity: identity.value });
  if (account.isErr()) {
    return err(account.error);
  }
  return ok({
    account: account.value,
    expiryMs: token.value.expiryMs,
    homeAccountId: token.value.homeAccountId,
    msalCache: token.value.msalCache,
    scopes: grantedOutlookScopes({ reported: token.value.scopes }),
  });
}

/**
 * The real consent effects: the shared loopback on `localhost`, MSAL, and Graph's `/me`.
 *
 * @param clientId the app registration's client id
 * @param writeLine where the consent URL is printed
 * @returns the effects {@link runOutlookConsent} composes
 */
export function productionOutlookConsentDeps({
  clientId,
  writeLine,
}: {
  clientId: string;
  writeLine: (line: string) => void;
}): OutlookConsentDeps {
  return {
    awaitCallback: ({ onListening, signal }) =>
      awaitLoopbackCallback({ onListening, productName: "Outlook", redirectHost: "localhost", signal }),
    consentUrl: ({ redirectUri, scopes, secrets }) => outlookConsentUrl({ clientId, redirectUri, scopes, secrets }),
    identify: ({ accessToken }) =>
      makeOutlookApi({ graph: makeGraphClient({ accessToken }), rateScopeKey: clientId }).me(),
    makeSecrets: () => makeConsentSecrets(),
    present: ({ url }) => {
      presentConsentUrl({ productName: "Outlook", url, writeLine });
    },
    redeem: ({ code, clientInfo, redirectUri, scopes, verifier }) =>
      redeemOutlookCode({ clientId, clientInfo, code, redirectUri, scopes, verifier }),
  };
}
