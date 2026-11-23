/**
 * `gmail unsubscribe` — RFC 8058's one-click unsubscribe, performed on one message's own published target, and
 * refused for a sender that does not publish one.
 *
 * The owner reads inbox-triage cards and wants to say "unsubscribe from them" and have it done without a hand.
 * One-click is the only unsubscribe that needs no hand: the sender publishes an https URL in `List-Unsubscribe` and promises, with
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, that a bare POST of that one form field unsubscribes the
 * recipient — no sign-in, no page, no cookie. Every other way out is the owner's: a `link` opens the sender's own page,
 * `mailto` is a send under the owner's name, and `none` leaves the sender's settings page, which a sign-in guards.
 *
 * **Measured on the owner's inbox** (`slopweaver gmail read <id>` prints the pair): Linear's notification mail
 * publishes one-click with its target BARE — `List-Unsubscribe: https://linear.app/api/unsubscribe?...` and no angle
 * brackets, which RFC 2369 asks for — so a reader matching only `<https://` read it as `none`. incident.io's paging
 * mail publishes no `List-Unsubscribe` at all. {@link listUnsubscribeTargets} accepts both spellings for that reason.
 *
 * **What leaves the machine**: exactly the POST RFC 8058 defines, to the URL the sender itself wrote into the
 * message — no credential, no cookie, no header of ours beyond the content type. The URL carries the sender's own
 * token for the recipient, so a rendering prints its origin and nothing after it ({@link describeOneClickTarget}).
 *
 * **What is judged before it leaves**: the whole URL, path and query tokens included, the form body and the content
 * type, by the dead-Datadog-host refusal and then the outbound privacy check, STRICT, under the verb's own home
 * ({@link oneClickPoster}), immediately before the `fetch`. A refusal sends nothing and reports `POST_REFUSED`. The
 * Gmail transport's guard cannot see this POST: it goes to the sender, not to Google.
 */
import type { IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import { refusedBeforeGmailWire } from "../../outbound/gmail/sendFailure.js";
import { gmailWritePrivacy, refuseGmailWrite } from "../../outbound/gmail/writePrivacy.js";
import { gmailOneClickRequest } from "../../outbound/gmail/writePrivacyPayload.js";
import { type GmailMessage, getHeader } from "./parse.js";

/** The form body RFC 8058 § 3.1 specifies, verbatim. */
export const ONE_CLICK_BODY = "List-Unsubscribe=One-Click";

/** What a `List-Unsubscribe` value offers, each target in the order the sender wrote them. */
export interface ListUnsubscribeTargets {
  readonly https: readonly string[];
  readonly mailto: readonly string[];
}

/** The sender publishes no one-click target, so an unsubscribe here needs the owner's hand. */
export interface NoOneClickError {
  readonly code: "NO_ONE_CLICK";
  readonly message: string;
  /** What the sender does offer instead, as `gmail triage` names it. */
  readonly offered: "link" | "mailto" | "none";
}

/** The POST reached the sender and was answered with a status that is not success. */
export interface UnsubscribeRejectedError {
  readonly code: "POST_REJECTED";
  readonly message: string;
  readonly status: number;
}

/** The POST never got an answer — network, DNS, TLS or the timeout. */
export interface UnsubscribeTransportError {
  readonly code: "POST_FAILED";
  readonly message: string;
  readonly cause: IngestError;
}

/** The POST was stopped before it was sent, by the dead-Datadog-host refusal or the outbound privacy check. */
export interface UnsubscribeRefusedError {
  readonly code: "POST_REFUSED";
  readonly message: string;
  readonly cause: IngestError;
}

/**
 * The factories for every way `gmail unsubscribe` fails on the sender's side. Reading the message fails as a
 * `GmailError` and is reported as one, so it has no variant here; each function names the variants it can return.
 */
export const GmailUnsubscribeErrors = {
  noOneClick: ({ offered }: { offered: NoOneClickError["offered"] }): NoOneClickError => {
    const way: Record<NoOneClickError["offered"], string> = {
      link: "only a link, which opens the sender's own page",
      mailto: "only a mailto address, which would be a send under your name",
      none: "no List-Unsubscribe at all, so its own settings page is the way out",
    };
    return {
      code: "NO_ONE_CLICK",
      message: `this sender publishes no RFC 8058 one-click unsubscribe — it offers ${way[offered]}; nothing was sent`,
      offered,
    };
  },
  postFailed: ({ cause }: { cause: IngestError }): UnsubscribeTransportError => ({
    cause,
    code: "POST_FAILED",
    message: `the one-click POST got no answer: ${cause.message}`,
  }),
  postRefused: ({ cause }: { cause: IngestError }): UnsubscribeRefusedError => ({
    cause,
    code: "POST_REFUSED",
    message: cause.message,
  }),
  postRejected: ({ status }: { status: number }): UnsubscribeRejectedError => ({
    code: "POST_REJECTED",
    message: `the sender answered the one-click POST with HTTP ${String(status)}, not success — it may not have unsubscribed`,
    status,
  }),
} as const;

/**
 * Split a `List-Unsubscribe` value into its https and mailto targets. Pure, by index rather than by pattern — the
 * value is sender-written text. Bracketed entries (RFC 2369) are read out of their brackets, so a comma inside a URL
 * cannot split it; a value with no bracket at all is read as comma-separated bare targets, the shape Linear sends.
 *
 * @param value the header value as the sender wrote it
 * @returns every https and mailto target, in order; anything else is dropped
 */
export function listUnsubscribeTargets({ value }: { value: string }): ListUnsubscribeTargets {
  const entries: string[] = [];
  if (value.includes("<")) {
    let from = value.indexOf("<");
    while (from !== -1) {
      const close = value.indexOf(">", from + 1);
      if (close === -1) {
        break;
      }
      entries.push(value.slice(from + 1, close).trim());
      from = value.indexOf("<", close + 1);
    }
  } else {
    entries.push(...value.split(",").map((entry) => entry.trim()));
  }
  return {
    https: entries.filter((entry) => entry.toLowerCase().startsWith("https://")),
    mailto: entries.filter((entry) => entry.toLowerCase().startsWith("mailto:")),
  };
}

/**
 * Whether `List-Unsubscribe-Post` makes RFC 8058's one-click promise. Pure.
 *
 * @param value the `List-Unsubscribe-Post` value, when present
 * @returns true only for the exact form field RFC 8058 names, compared case-insensitively
 */
export function promisesOneClick({ value }: { value: string | undefined }): boolean {
  return value !== undefined && value.trim().toLowerCase() === ONE_CLICK_BODY.toLowerCase();
}

/**
 * The one-click target of one message: its first https target, when the sender also promised one-click. Pure.
 *
 * @param message the message as a `metadata` or `full` fetch returned it
 * @returns the URL to POST to, or which way out the sender offers instead
 */
export function oneClickTarget({ message }: { message: GmailMessage }): Result<URL, NoOneClickError> {
  const headers = message.payload?.headers;
  const listUnsubscribe = getHeader({ headers, name: "List-Unsubscribe" });
  if (listUnsubscribe === undefined) {
    return err(GmailUnsubscribeErrors.noOneClick({ offered: "none" }));
  }
  const targets = listUnsubscribeTargets({ value: listUnsubscribe });
  const [first] = targets.https;
  if (first === undefined) {
    return err(GmailUnsubscribeErrors.noOneClick({ offered: targets.mailto.length > 0 ? "mailto" : "none" }));
  }
  if (!promisesOneClick({ value: getHeader({ headers, name: "List-Unsubscribe-Post" }) }) || !URL.canParse(first)) {
    return err(GmailUnsubscribeErrors.noOneClick({ offered: "link" }));
  }
  return ok(new URL(first));
}

/**
 * A one-click target as it may be printed: its origin, and how much it withholds. The recipient's token is the whole
 * of the unsubscribe authority, and a sender may put it anywhere after the origin — Linear's is a query value, a
 * `/unsubscribe/<token>` sender's is a path segment, a bare `?<token>` sender's is a query KEY — so nothing after the
 * origin is printed, only counted. The origin is what the ledger records too (`url.host`); it never carries userinfo.
 *
 * @param url the one-click target
 * @returns e.g. `https://linear.app (2 path segment(s) and 3 query parameter(s) withheld)`
 */
export function describeOneClickTarget({ url }: { url: URL }): string {
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0).length;
  const parameters = [...url.searchParams.keys()].length;
  return `${url.origin} (${String(segments)} path segment(s) and ${String(parameters)} query parameter(s) withheld)`;
}

/**
 * The POST seam: one RFC 8058 request, judged under `home` — the state home the verb resolved — and answered with
 * the status the sender returned.
 */
export type OneClickPost = (args: {
  url: URL;
  body: string;
  home: string;
}) => Promise<Result<{ status: number }, IngestError>>;

/**
 * Perform the one-click POST and judge the answer: any 2xx is the sender saying it unsubscribed.
 *
 * @param url the one-click target {@link oneClickTarget} returned
 * @param post the injected POST seam
 * @param home the state home the verb resolved, whose private terms judge the POST
 * @returns the status the sender answered, or why it did not count as success
 */
export async function performOneClick({
  url,
  post,
  home,
}: {
  url: URL;
  post: OneClickPost;
  home: string;
}): Promise<
  Result<{ status: number }, UnsubscribeRejectedError | UnsubscribeTransportError | UnsubscribeRefusedError>
> {
  const answered = await post({ body: ONE_CLICK_BODY, home, url });
  if (answered.isErr()) {
    if (refusedBeforeGmailWire({ error: answered.error })) {
      return err(GmailUnsubscribeErrors.postRefused({ cause: answered.error }));
    }
    return err(GmailUnsubscribeErrors.postFailed({ cause: answered.error }));
  }
  const { status } = answered.value;
  if (status < 200 || status > 299) {
    return err(GmailUnsubscribeErrors.postRejected({ status }));
  }
  return ok({ status });
}

/** How long one one-click POST may take before it counts as unanswered. */
const ONE_CLICK_TIMEOUT_MS = 15_000;

/** The one content type the POST declares, RFC 8058's form encoding. */
const ONE_CLICK_CONTENT_TYPE = "application/x-www-form-urlencoded";

/**
 * The production POST over a given `fetch`: exactly RFC 8058's request — the one form field, no credential, no cookie
 * — judged under the verb's home, then sent once and never retried, and a redirect is NOT followed, because a
 * redirect is the sender asking for a page, which is not the promise it made. The refusal is thrown inside the
 * provider call, before the `fetch`, so it reaches the caller as the `cause` of the `IngestError` it returns.
 *
 * @param fetch the transport the POST is sent over — the platform's in production, a counting one in a test
 * @returns the POST seam
 */
export function oneClickPoster({ fetch }: { fetch: typeof globalThis.fetch }): OneClickPost {
  return async ({ url, body, home }) => {
    const answered = await safeProviderCall({
      execute: async () => {
        const request = gmailOneClickRequest({ body, contentType: ONE_CLICK_CONTENT_TYPE, url });
        // The POST goes to a third party, not the mailbox a review is told about, so a meant match refuses outright.
        await refuseGmailWrite({ privacy: { resolve: gmailWritePrivacy({ home }).resolve }, request });
        return fetch(url, {
          body,
          credentials: "omit",
          headers: { "content-type": ONE_CLICK_CONTENT_TYPE },
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(ONE_CLICK_TIMEOUT_MS),
        });
      },
      operation: "mail-sender.unsubscribe.one-click",
      provider: "mail-sender",
      retryMode: "never",
      scopeId: url.host,
    });
    return answered.map((response) => ({ status: response.status }));
  };
}

/** The production POST, over the platform `fetch` looked up at each call. */
export const postOneClick: OneClickPost = oneClickPoster({ fetch: (input, init) => globalThis.fetch(input, init) });
