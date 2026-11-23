/**
 * Canned Twilio bodies and a plain fake read seam for the Twilio door's tests — a function answering by URL, never
 * a mock. Every message carries a sentinel body and full phone numbers, so a test can assert neither ever
 * reaches a view or a printed line.
 */
import { err, ok, type Result } from "../../../../lib/result.js";
import { type TwilioReadError, TwilioReadErrors } from "../../../../live/twilio/errors.js";
import type { TwilioGet } from "../../../../live/twilio/transport.js";

/** The account every fixture path is built on. */
export const FIXTURE_ACCOUNT = `AC${"a".repeat(32)}`;

/** A body no view or line may ever contain. */
export const SENTINEL_BODY = "SENTINEL-CUSTOMER-BODY your booking is at 9am";

/** The recipient every fixture message was sent to. */
export const FIXTURE_TO = "+61400000123";

/**
 * One message as Twilio answers it.
 *
 * @param sid the message SID
 * @param status Twilio's status word
 * @param errorCode Twilio's error code, or null
 * @returns the wire object
 */
export function wireMessage({
  sid,
  status,
  errorCode,
}: {
  sid: string;
  status: string;
  errorCode: number | null;
}): Record<string, unknown> {
  return {
    account_sid: FIXTURE_ACCOUNT,
    api_version: "2010-04-01",
    body: SENTINEL_BODY,
    date_created: "Sat, 11 Oct 2026 03:12:00 +0000",
    date_sent: "Sat, 11 Oct 2026 03:12:01 +0000",
    date_updated: "Sat, 11 Oct 2026 03:12:09 +0000",
    direction: "outbound-api",
    error_code: errorCode,
    error_message: errorCode === null ? null : "Unreachable destination handset",
    from: "+61480000999",
    messaging_service_sid: `MG${"c".repeat(32)}`,
    num_media: "0",
    num_segments: "1",
    price: "-0.05",
    price_unit: "USD",
    sid,
    status,
    subresource_uris: { media: `/2010-04-01/Accounts/${FIXTURE_ACCOUNT}/Messages/${sid}/Media.json` },
    to: FIXTURE_TO,
    uri: `/2010-04-01/Accounts/${FIXTURE_ACCOUNT}/Messages/${sid}.json`,
  };
}

/**
 * One list page as Twilio answers it.
 *
 * @param messages the page's messages
 * @param nextPageUri Twilio's next page, or null on the last
 * @returns the body text
 */
export function listPage({
  messages,
  nextPageUri,
}: {
  messages: readonly unknown[];
  nextPageUri: string | null;
}): string {
  return JSON.stringify({
    end: messages.length - 1,
    first_page_uri: "/first",
    messages,
    next_page_uri: nextPageUri,
    page: 0,
    page_size: 50,
    previous_page_uri: null,
    start: 0,
    uri: "/this",
  });
}

/**
 * A SID with a repeated hex digit, for readable fixtures.
 *
 * @param digit one hex character
 * @returns an `SM…` SID
 */
export function sidOf({ digit }: { digit: string }): string {
  return `SM${digit.repeat(32)}`;
}

/**
 * One queued answer as the seam's result.
 *
 * @param body the queued body, a failure, or `undefined` when the queue ran dry
 * @returns the result a GET answers
 */
function answer({ body }: { body: string | TwilioReadError | undefined }): Result<string, TwilioReadError> {
  if (body === undefined) {
    return err(TwilioReadErrors.transportFailed({ message: "the fake had no answer queued", status: null }));
  }
  if (typeof body === "string") {
    return ok(body);
  }
  return err(body);
}

/**
 * A fake read seam answering each requested URL from a queue of bodies, recording every URL it was asked for.
 *
 * @param bodies the answers, in request order; a `TwilioReadError` answers as a failed GET
 * @returns the seam and the URLs it saw
 */
export function queuedGet({ bodies }: { bodies: readonly (string | TwilioReadError)[] }): {
  get: TwilioGet;
  seen: URL[];
} {
  const seen: URL[] = [];
  const get: TwilioGet = ({ url }) => Promise.resolve(answer({ body: bodies[seen.push(url) - 1] }));
  return { get, seen };
}
