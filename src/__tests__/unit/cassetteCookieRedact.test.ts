/**
 * Cookie-side cassette safety — the second copy of `Set-Cookie`.
 *
 * A HAR carries `Set-Cookie` twice: as the response header, which `isAllowedCassetteHeader` drops, and again
 * as Polly's own parse of that header into `cookies[]`, which the header allowlist never sees. These assert
 * the two halves that close it — the blanking itself, and the record-time text that judges what blanking
 * deliberately KEEPS, so a cookie carrying a real host in `domain` fails a record run rather than landing.
 */
import { describe, expect, it } from "vitest";

import {
  cassetteCookieTripwireText,
  isRedactedCassetteCookie,
  REDACTED_COOKIE_VALUE,
  redactCassetteCookies,
} from "../cassetteCookies.js";
import { assertRecordTimeTripwire } from "../cassetteTripwire.js";

// The shape Polly's persister writes, with the real `__cf_bm` length (199) the sweep measured.
const CF_BM = {
  domain: "api.cloudflare.com",
  expires: "2026-09-01T21:18:31.000Z",
  httpOnly: true,
  name: "__cf_bm",
  path: "/",
  sameSite: "None",
  secure: true,
  value: `${"m".repeat(60)}-1788295711.1886523-1.0.1.1-${"K".repeat(110)}`,
};

describe("redactCassetteCookies", () => {
  it("blanks the value", () => {
    expect(redactCassetteCookies({ cookies: [CF_BM] })[0]!.value).toBe("[REDACTED]");
  });

  it("keeps every other field, so a reader still sees which provider set a cookie", () => {
    expect(redactCassetteCookies({ cookies: [CF_BM] })[0]).toEqual({ ...CF_BM, value: REDACTED_COOKIE_VALUE });
  });

  it("does not mutate its input — the caller's array is untouched", () => {
    const cookies = [{ ...CF_BM }];
    redactCassetteCookies({ cookies });
    expect(cookies[0]!.value).toBe(CF_BM.value);
  });

  it("answers [] for the undefined array Polly writes when a response set no cookie", () => {
    expect(redactCassetteCookies({ cookies: undefined })).toEqual([]);
  });

  it("answers [] for an empty array", () => {
    expect(redactCassetteCookies({ cookies: [] })).toEqual([]);
  });
});

describe("isRedactedCassetteCookie", () => {
  it("accepts exactly what redactCassetteCookies produces", () => {
    expect(isRedactedCassetteCookie({ cookie: redactCassetteCookies({ cookies: [CF_BM] })[0]! })).toBe(true);
  });

  it("rejects the raw recorded cookie", () => {
    expect(isRedactedCassetteCookie({ cookie: CF_BM })).toBe(false);
  });

  it("rejects an empty value — a blank is not the placeholder, and silence is not redaction", () => {
    expect(isRedactedCassetteCookie({ cookie: { name: "__cf_bm", value: "" } })).toBe(false);
  });
});

describe("cassetteCookieTripwireText", () => {
  it("renders every field blanking keeps, so domain and path are judged", () => {
    expect(cassetteCookieTripwireText({ cookies: redactCassetteCookies({ cookies: [CF_BM] }) })).toBe(
      "name=__cf_bm; value=[REDACTED]; domain=api.cloudflare.com; path=/",
    );
  });

  it("omits a field Polly did not write rather than printing an empty one", () => {
    expect(cassetteCookieTripwireText({ cookies: [{ name: "session", value: REDACTED_COOKIE_VALUE }] })).toBe(
      "name=session; value=[REDACTED]",
    );
  });

  it("answers the empty string for no cookies", () => {
    expect(cassetteCookieTripwireText({ cookies: [] })).toBe("");
  });

  it("puts one cookie per line", () => {
    const text = cassetteCookieTripwireText({
      cookies: [
        { name: "a", value: REDACTED_COOKIE_VALUE },
        { name: "b", value: REDACTED_COOKIE_VALUE },
      ],
    });
    expect(text).toBe("name=a; value=[REDACTED]\nname=b; value=[REDACTED]");
  });
});

describe("the record-time tripwire over that text", () => {
  const KNOWN = ["acme-secret-workspace.example.com"];

  // The falsifiable witness: the text below CARRIES the known value, in the `domain` position blanking keeps.
  it("fires on a known-sensitive value sitting in a cookie's domain", () => {
    const text = cassetteCookieTripwireText({
      cookies: redactCassetteCookies({
        cookies: [{ domain: "acme-secret-workspace.example.com", name: "session", value: "whatever" }],
      }),
    });

    expect(text).toContain("acme-secret-workspace.example.com");
    expect(() => {
      assertRecordTimeTripwire({ denylist: [], knownValues: KNOWN, text });
    }).toThrow("a known-sensitive value survived redaction");
  });

  it("passes a fully blanked cookie whose domain is a public API host", () => {
    expect(() => {
      assertRecordTimeTripwire({
        denylist: [],
        knownValues: KNOWN,
        text: cassetteCookieTripwireText({ cookies: redactCassetteCookies({ cookies: [CF_BM] }) }),
      });
    }).not.toThrow();
  });
});
