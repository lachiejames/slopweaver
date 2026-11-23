/**
 * The Twilio door's one way to the network: a GET, to `api.twilio.com`, on one of two message paths under the
 * configured account, with only the query keys the list is read with. Nothing else is expressible here.
 *
 * The door is read-only, for investigations, delivery records first. The key the owner
 * mints is RESTRICTED to message reads, and this module is the second wall: the method is a TYPE with one member,
 * and a URL is refused before any call — and again at the send — when it names a host, path or query key this
 * door never chose. Twilio's official SDK is deliberately not used: it puts `messages.create`, an SMS to a
 * person, one method call from the read (`docs/provider-sdks.md` § "An SDK that widens what a caller can do").
 *
 * A returned `next_page_uri` is Twilio's text, so it is parsed and checked exactly as a built URL is before it
 * carries the key.
 */
import { unsetFieldAsNull } from "#lib/absent.js";

import { safeProviderCall } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { TwilioCredentials } from "./credential.js";
import { type TwilioReadError, TwilioReadErrors } from "./errors.js";

/** The only HTTP method this door sends. A second member here is the read-only ask broken. */
type TwilioHttpMethod = "GET";

/** The REST API origin the Messages resource answers on. The key goes nowhere else. */
const TWILIO_API_ORIGIN = "https://api.twilio.com";

/** How long one GET may take before it fails, so a stalled response cannot hang an investigation. */
const TWILIO_REQUEST_TIMEOUT_MS = 30_000;

/**
 * The query keys the message list is read with — the pinned operation's own, and every one Twilio puts back
 * into a `next_page_uri`. `DateSent>`/`DateSent<` are literal parameter names, `>` included.
 *
 * @internal
 */
export const TWILIO_LIST_QUERY_KEYS = [
  "To",
  "From",
  "DateSent",
  "DateSent<",
  "DateSent>",
  "PageSize",
  "Page",
  "PageToken",
] as const;

/** One admitted list query key. */
export type TwilioListQueryKey = (typeof TWILIO_LIST_QUERY_KEYS)[number];

/** `SM` (an SMS) or `MM` (an MMS) then 32 hex — the two message SID shapes the pinned schema admits. */
const MESSAGE_SID = /^(SM|MM)[0-9a-f]{32}$/;

/**
 * Whether a string is a Twilio message SID.
 *
 * @param value any string
 * @returns `true` for an `SM…` or `MM…` SID
 */
export function isTwilioMessageSid({ value }: { value: string }): boolean {
  return MESSAGE_SID.test(value);
}

/**
 * The list path for one account.
 *
 * @param accountSid the configured account
 * @returns `/2010-04-01/Accounts/<sid>/Messages.json`
 */
function listPath({ accountSid }: { accountSid: string }): string {
  return `/2010-04-01/Accounts/${accountSid}/Messages.json`;
}

/**
 * Whether a URL is one this door could have built: Twilio's origin with no credentials or fragment, the
 * account's list path with only admitted query keys, or one message's path with no query at all.
 *
 * @param url the URL about to carry the key
 * @param accountSid the configured account, the only one a path may name
 * @returns `true` only for a URL on the closed call list
 * @internal
 */
export function isClosedTwilioUrl({ url, accountSid }: { url: URL; accountSid: string }): boolean {
  if (url.origin !== TWILIO_API_ORIGIN || url.username !== "" || url.password !== "" || url.hash !== "") {
    return false;
  }
  if (url.pathname === listPath({ accountSid })) {
    const admitted: readonly string[] = TWILIO_LIST_QUERY_KEYS;
    return [...url.searchParams.keys()].every((name) => admitted.includes(name));
  }
  const prefix = `/2010-04-01/Accounts/${accountSid}/Messages/`;
  if (!url.pathname.startsWith(prefix) || !url.pathname.endsWith(".json") || url.search !== "") {
    return false;
  }
  return isTwilioMessageSid({ value: url.pathname.slice(prefix.length, -".json".length) });
}

/**
 * Build the list URL, refusing a key outside the admitted set.
 *
 * @param accountSid the configured account
 * @param query the filters and paging to send
 * @returns the URL, or `URL_REFUSED`
 */
export function buildTwilioListUrl({
  accountSid,
  query,
}: {
  accountSid: string;
  query: Readonly<Partial<Record<TwilioListQueryKey, string>>>;
}): Result<URL, TwilioReadError> {
  const url = new URL(listPath({ accountSid }), TWILIO_API_ORIGIN);
  // `exactOptionalPropertyTypes` keeps an absent key absent, so every entry here carries a string.
  for (const [name, value] of Object.entries(query)) {
    url.searchParams.set(name, value);
  }
  if (!isClosedTwilioUrl({ accountSid, url })) {
    return err(TwilioReadErrors.urlRefused({ path: url.pathname, why: "the list URL leaves the closed call list" }));
  }
  return ok(url);
}

/**
 * Build one message's URL, refusing anything that is not a message SID.
 *
 * @param accountSid the configured account
 * @param sid the message SID
 * @returns the URL, or `URL_REFUSED`
 */
export function buildTwilioMessageUrl({
  accountSid,
  sid,
}: {
  accountSid: string;
  sid: string;
}): Result<URL, TwilioReadError> {
  if (!isTwilioMessageSid({ value: sid })) {
    return err(
      TwilioReadErrors.urlRefused({ path: "Messages/{Sid}.json", why: "the SID is not an SM… or MM… message SID" }),
    );
  }
  const url = new URL(`/2010-04-01/Accounts/${accountSid}/Messages/${sid}.json`, TWILIO_API_ORIGIN);
  if (!isClosedTwilioUrl({ accountSid, url })) {
    return err(TwilioReadErrors.urlRefused({ path: url.pathname, why: "the message URL leaves the closed call list" }));
  }
  return ok(url);
}

/**
 * Turn a page's `next_page_uri` into the next URL, checked exactly as a built one is.
 *
 * @param accountSid the configured account
 * @param nextPageUri Twilio's own relative URI for the next page
 * @returns the URL, or `URL_REFUSED` naming the field and never the provider's path or query
 */
export function resolveTwilioNextPage({
  accountSid,
  nextPageUri,
}: {
  accountSid: string;
  nextPageUri: string;
}): Result<URL, TwilioReadError> {
  let url: URL;
  try {
    url = new URL(nextPageUri, TWILIO_API_ORIGIN);
  } catch {
    return err(
      TwilioReadErrors.urlRefused({ path: "next_page_uri", why: "Twilio answered a next page that is not a URL" }),
    );
  }
  // Named by its field, never its path: a refused next page is provider text, and could carry anything.
  if (!isClosedTwilioUrl({ accountSid, url })) {
    return err(
      TwilioReadErrors.urlRefused({ path: "next_page_uri", why: "Twilio's next page leaves the closed call list" }),
    );
  }
  return ok(url);
}

/**
 * The shortest query value treated as quotable: a phone number, a date or a page token is longer, while a
 * `PageSize` of `50` would match every status code in an ordinary failure sentence.
 */
const MIN_QUOTED_VALUE = 6;

/** What a failure says instead when its own words quote the key or the query. */
const WORDS_WITHHELD = "the request failed and its error quoted the API key or the query, so its words are withheld";

/**
 * A failure's words reach a transcript, so words quoting the key SID or secret, or the query string (which carries
 * the phone number filter), are withheld whole rather than edited. The fixed sentence holds no run of 20
 * non-space characters, and the reader refuses a secret shorter than that, so the sentence can never contain one.
 *
 * @param message the failure's own words
 * @param credentials the key the request carried
 * @param url the request, whose query must not be quoted back
 * @returns the words unchanged, or the fixed sentence when they quote the key or the query
 */
export function wordsWithheld({
  message,
  credentials,
  url,
}: {
  message: string;
  credentials: TwilioCredentials;
  url: URL;
}): string {
  const quotesKey = message.includes(credentials.keySecret) || message.includes(credentials.keySid);
  const quotesQuery =
    url.search.length > 1 &&
    (message.includes(url.search.slice(1)) ||
      [...url.searchParams.values()].some((value) => value.length >= MIN_QUOTED_VALUE && message.includes(value)));
  return quotesKey || quotesQuery ? WORDS_WITHHELD : message;
}

/**
 * The read seam every read is written against: production is {@link twilioGet} bound to the key, a test passes
 * a plain function answering canned bodies. It answers the body's TEXT; the read parses it next to the
 * endpoint's strict boundary.
 */
export type TwilioGet = (request: { url: URL }) => Promise<Result<string, TwilioReadError>>;

/** A non-2xx, carried in the shape `toIngestError` reads a status and a `retry-after` off. */
class TwilioHttpStatusError extends Error {
  readonly status: number;
  readonly response: { readonly status: number; readonly headers: Readonly<Record<string, string>> };

  /**
   * @param status the HTTP status Twilio answered
   * @param headers its response headers, lower-cased by `fetch`
   * @param path the request path, for the message — never the query, which holds the phone number filter
   */
  constructor({ status, headers, path }: { status: number; headers: Readonly<Record<string, string>>; path: string }) {
    super(`Twilio answered ${String(status)} on ${path}`);
    this.status = status;
    this.response = { headers, status };
  }
}

/**
 * Send ONE GET through the paced provider door, with the key as HTTP Basic.
 *
 * @param credentials the resolved key
 * @param url a URL this module built or resolved — refused here otherwise
 * @param scopeId the shared rate scope, already hashed from the key SID
 * @returns the body's text, for a strict boundary to read, or why it failed
 */
export async function twilioGet({
  credentials,
  url,
  scopeId,
}: {
  credentials: TwilioCredentials;
  url: URL;
  scopeId: string;
}): Promise<Result<string, TwilioReadError>> {
  // Checked again HERE, at the send, so a URL from anywhere but this module never carries the key. The check and
  // the fetch read one immutable string: the caller's `URL` is mutable, and the paced door awaits in between.
  const target = new URL(url.href);
  if (!isClosedTwilioUrl({ accountSid: credentials.accountSid, url: target })) {
    return err(
      TwilioReadErrors.urlRefused({ path: target.pathname, why: "the URL is not one the closed call list builds" }),
    );
  }
  const href = target.href;
  const method: TwilioHttpMethod = "GET";
  const basic = Buffer.from(`${credentials.keySid}:${credentials.keySecret}`, "utf8").toString("base64");
  const answered = await safeProviderCall({
    execute: async () => {
      // `redirect: "error"`: a 3xx would be Twilio sending the key somewhere this door never chose.
      const response = await fetch(href, {
        headers: { accept: "application/json", authorization: `Basic ${basic}` },
        method,
        redirect: "error",
        signal: AbortSignal.timeout(TWILIO_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new TwilioHttpStatusError({
          headers: Object.fromEntries(response.headers.entries()),
          path: target.pathname,
          status: response.status,
        });
      }
      return response.text();
    },
    maxAttempts: 1,
    operation: "twilio.api.read",
    provider: "twilio",
    retryMode: "transient",
    scopeId,
  });
  if (answered.isErr()) {
    return err(
      TwilioReadErrors.transportFailed({
        message: wordsWithheld({ credentials, message: answered.error.message, url: target }),
        status: unsetFieldAsNull({ key: "status", record: answered.error }),
      }),
    );
  }
  return ok(answered.value);
}
