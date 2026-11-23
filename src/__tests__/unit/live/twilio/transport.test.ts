/**
 * The Twilio transport's closed call list: two message paths under the configured account, the list's admitted
 * query keys only, Twilio's origin with no credentials or fragment — and a failure's words withheld whole when
 * they quote the key or the query. The send itself re-checks the list before the key leaves the process.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { TwilioCredentials } from "../../../../live/twilio/credential.js";
import { TwilioReadErrors } from "../../../../live/twilio/errors.js";
import {
  buildTwilioListUrl,
  buildTwilioMessageUrl,
  isClosedTwilioUrl,
  isTwilioMessageSid,
  resolveTwilioNextPage,
  twilioGet,
  wordsWithheld,
} from "../../../../live/twilio/transport.js";

const ACCOUNT = `AC${"a".repeat(32)}`;
const OTHER_ACCOUNT = `AC${"f".repeat(32)}`;
const SID = `SM${"1".repeat(32)}`;
const CREDENTIALS: TwilioCredentials = {
  accountSid: ACCOUNT,
  keySecret: "fake-twilio-secret-of-real-length",
  keySid: `SK${"b".repeat(32)}`,
};
const LIST = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Messages.json`;

describe("isTwilioMessageSid", () => {
  it("admits an SM and an MM SID", () => {
    expect(isTwilioMessageSid({ value: SID })).toBe(true);
    expect(isTwilioMessageSid({ value: `MM${"2".repeat(32)}` })).toBe(true);
  });

  it("refuses another SID family, upper-case hex and a short SID", () => {
    expect(isTwilioMessageSid({ value: `CA${"1".repeat(32)}` })).toBe(false);
    expect(isTwilioMessageSid({ value: `SM${"A".repeat(32)}` })).toBe(false);
    expect(isTwilioMessageSid({ value: `SM${"1".repeat(31)}` })).toBe(false);
  });
});

describe("isClosedTwilioUrl", () => {
  it("admits the account's list path with admitted keys and one message path with no query", () => {
    expect(
      isClosedTwilioUrl({ accountSid: ACCOUNT, url: new URL(`${LIST}?To=%2B61400000000&DateSent%3E=2026-10-11`) }),
    ).toBe(true);
    expect(
      isClosedTwilioUrl({
        accountSid: ACCOUNT,
        url: new URL(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Messages/${SID}.json`),
      }),
    ).toBe(true);
  });

  it("refuses another host, another account, credentials in the URL and a fragment", () => {
    expect(
      isClosedTwilioUrl({ accountSid: ACCOUNT, url: new URL(LIST.replace("api.twilio.com", "evil.example")) }),
    ).toBe(false);
    expect(isClosedTwilioUrl({ accountSid: ACCOUNT, url: new URL(LIST.replace(ACCOUNT, OTHER_ACCOUNT)) })).toBe(false);
    expect(isClosedTwilioUrl({ accountSid: ACCOUNT, url: new URL(LIST.replace("https://", "https://u:p@")) })).toBe(
      false,
    );
    expect(isClosedTwilioUrl({ accountSid: ACCOUNT, url: new URL(`${LIST}#x`) })).toBe(false);
  });

  it("refuses a query key the list never sends, and any query on a message path", () => {
    expect(isClosedTwilioUrl({ accountSid: ACCOUNT, url: new URL(`${LIST}?Body=hello`) })).toBe(false);
    expect(
      isClosedTwilioUrl({
        accountSid: ACCOUNT,
        url: new URL(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Messages/${SID}.json?PageSize=1`),
      }),
    ).toBe(false);
  });

  it("refuses a sub-resource of a message, such as its media", () => {
    expect(
      isClosedTwilioUrl({
        accountSid: ACCOUNT,
        url: new URL(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Messages/${SID}/Media.json`),
      }),
    ).toBe(false);
  });
});

describe("the URL builders", () => {
  it("build the list URL with literal DateSent> and DateSent< keys", () => {
    const url = unwrap(
      buildTwilioListUrl({
        accountSid: ACCOUNT,
        query: { "DateSent<": "2026-10-12", "DateSent>": "2026-10-11", PageSize: "50" },
      }),
    );
    expect(url.pathname).toBe(`/2010-04-01/Accounts/${ACCOUNT}/Messages.json`);
    expect([...url.searchParams.entries()]).toEqual([
      ["DateSent<", "2026-10-12"],
      ["DateSent>", "2026-10-11"],
      ["PageSize", "50"],
    ]);
  });

  it("builds one message's URL and refuses a value that is not a message SID", () => {
    expect(unwrap(buildTwilioMessageUrl({ accountSid: ACCOUNT, sid: SID })).pathname).toBe(
      `/2010-04-01/Accounts/${ACCOUNT}/Messages/${SID}.json`,
    );
    expect(unwrapErr(buildTwilioMessageUrl({ accountSid: ACCOUNT, sid: "../Calls" })).code).toBe("URL_REFUSED");
  });

  it("resolves Twilio's relative next page, and refuses one that leaves the list", () => {
    const next = `/2010-04-01/Accounts/${ACCOUNT}/Messages.json?PageSize=50&Page=1&PageToken=PAabc`;
    expect(unwrap(resolveTwilioNextPage({ accountSid: ACCOUNT, nextPageUri: next })).href).toBe(
      `https://api.twilio.com${next}`,
    );
    expect(unwrapErr(resolveTwilioNextPage({ accountSid: ACCOUNT, nextPageUri: "https://evil.example/x" })).code).toBe(
      "URL_REFUSED",
    );
    expect(
      unwrapErr(resolveTwilioNextPage({ accountSid: ACCOUNT, nextPageUri: next.replace(ACCOUNT, OTHER_ACCOUNT) })).code,
    ).toBe("URL_REFUSED");
  });
});

describe("wordsWithheld", () => {
  const url = new URL(`${LIST}?To=%2B61400000123&PageSize=50`);

  it("passes ordinary words through", () => {
    expect(wordsWithheld({ credentials: CREDENTIALS, message: "Twilio answered 503 on /x", url })).toBe(
      "Twilio answered 503 on /x",
    );
  });

  it("withholds words quoting the secret, the key SID or a phone number from the query", () => {
    const withheld = "the request failed and its error quoted the API key or the query, so its words are withheld";
    expect(wordsWithheld({ credentials: CREDENTIALS, message: `bad ${CREDENTIALS.keySecret}`, url })).toBe(withheld);
    expect(wordsWithheld({ credentials: CREDENTIALS, message: `bad ${CREDENTIALS.keySid}`, url })).toBe(withheld);
    expect(wordsWithheld({ credentials: CREDENTIALS, message: "no route to +61400000123", url })).toBe(withheld);
  });

  it("does not withhold over a short query value such as the page size", () => {
    expect(wordsWithheld({ credentials: CREDENTIALS, message: "answered 500 after 50 ms", url })).toBe(
      "answered 500 after 50 ms",
    );
  });
});

describe("twilioGet", () => {
  it("refuses a URL off the closed list before any request is made", async () => {
    const refused = unwrapErr(
      await twilioGet({
        credentials: CREDENTIALS,
        scopeId: "scope",
        url: new URL("https://evil.example/2010-04-01/x"),
      }),
    );
    expect(refused).toEqual(
      TwilioReadErrors.urlRefused({ path: "/2010-04-01/x", why: "the URL is not one the closed call list builds" }),
    );
  });
});
