/** Unit: the pure half of the consent flow — URL construction, CSRF checking, and the two body parsers. */
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { GoogleOauthErrors } from "../../../../live/google/errors.js";
import {
  buildConsentUrl,
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_REVOKE_ENDPOINT,
  makeConsentSecrets,
  parseConsentCallback,
  parseRevokeResponse,
  parseTokenResponse,
  parseUserinfoEmail,
  tokenExchangeBody,
  tokenRevokeBody,
} from "../../../../live/google/oauth.js";

const SECRETS = { codeChallenge: "chal", codeVerifier: "ver", state: "st8" };

describe("makeConsentSecrets", () => {
  it("derives the challenge as the S256 digest of the verifier it returns", () => {
    const secrets = makeConsentSecrets({ randomBase64Url: ({ bytes }) => `r${String(bytes)}` });
    expect(secrets.codeVerifier).toBe("r64");
    expect(secrets.state).toBe("r32");
    // sha256("r64"), base64url — the value Google will recompute from the verifier at exchange time.
    expect(secrets.codeChallenge).toBe("wrj7DuIg5a639TVTYi10I29FYRKOWkfTnzh2hvnqkl8");
  });
});

describe("buildConsentUrl", () => {
  it("requests an OFFLINE grant with a forced consent prompt, which is what yields a refresh token", () => {
    const url = new URL(
      buildConsentUrl({
        clientId: "cid",
        redirectUri: "http://127.0.0.1:5555",
        scopes: ["a", "b"],
        secrets: SECRETS,
      }),
    );
    expect(url.origin + url.pathname).toBe(GOOGLE_AUTH_ENDPOINT);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("chal");
    expect(url.searchParams.get("state")).toBe("st8");
    expect(url.searchParams.get("scope")).toBe("a b");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:5555");
  });

  it("does NOT ask Google to merge previously granted scopes, so a grant equals its own consent screen", () => {
    // With `include_granted_scopes=true` a readonly consent lands a grant carrying every write scope the
    // client already holds on the account. The parameter's ABSENCE is the fix, so the absence is the assertion.
    const url = new URL(
      buildConsentUrl({ clientId: "cid", redirectUri: "http://127.0.0.1:1", scopes: ["a"], secrets: SECRETS }),
    );
    expect(url.searchParams.has("include_granted_scopes")).toBe(false);
  });

  it("omits login_hint when the caller has no mailbox to preselect", () => {
    const url = new URL(
      buildConsentUrl({ clientId: "cid", redirectUri: "http://127.0.0.1:1", scopes: [], secrets: SECRETS }),
    );
    expect(url.searchParams.has("login_hint")).toBe(false);
  });
});

describe("parseConsentCallback", () => {
  it("returns the code when the state matches", () => {
    const parsed = parseConsentCallback({ expectedState: "st8", requestUrl: "/?code=abc&state=st8" });
    expect(unwrap(parsed).code).toBe("abc");
  });

  it("refuses a mismatched state rather than accepting the code", () => {
    const parsed = parseConsentCallback({ expectedState: "st8", requestUrl: "/?code=abc&state=other" });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("wrong state");
    expect(unwrapErr(parsed).code).toBe("CALLBACK_UNUSABLE");
  });

  it("reports Google's own refusal reason", () => {
    const parsed = parseConsentCallback({ expectedState: "st8", requestUrl: "/?error=access_denied&state=st8" });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("access_denied");
    expect(unwrapErr(parsed).code).toBe("CONSENT_REFUSED");
  });

  it("refuses a callback with a matching state but no code", () => {
    const parsed = parseConsentCallback({ expectedState: "st8", requestUrl: "/?state=st8" });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("no authorisation code");
  });
});

describe("parseTokenResponse", () => {
  it("reads a first-exchange body, refresh token included", () => {
    const parsed = unwrap(
      parseTokenResponse({
        body: JSON.stringify({ access_token: "at", expires_in: 3599, refresh_token: "rt", scope: "a b" }),
      }),
    );
    expect(parsed.accessToken).toBe("at");
    expect(parsed.refreshToken).toBe("rt");
    expect(parsed.expiresInSeconds).toBe(3599);
    expect(parsed.scope).toBe("a b");
  });

  it("accepts a REFRESH body, which carries no refresh token by design", () => {
    const parsed = unwrap(parseTokenResponse({ body: JSON.stringify({ access_token: "at2", expires_in: 3599 }) }));
    expect(parsed.refreshToken).toBe(undefined);
    expect(parsed.accessToken).toBe("at2");
  });

  it("surfaces Google's error and description rather than reporting a missing field", () => {
    const parsed = parseTokenResponse({
      body: JSON.stringify({ error: "invalid_grant", error_description: "Bad Request" }),
    });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("invalid_grant");
    expect(unwrapErr(parsed).message).toContain("Bad Request");
  });

  it("refuses a body that is not JSON", () => {
    const parsed = parseTokenResponse({ body: "<html>502</html>" });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("not valid JSON");
  });

  it("refuses a body with no access_token", () => {
    const parsed = parseTokenResponse({ body: JSON.stringify({ expires_in: 10 }) });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("no access_token");
  });

  it("refuses a body with no expires_in", () => {
    const parsed = parseTokenResponse({ body: JSON.stringify({ access_token: "at" }) });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("no expires_in");
    expect(unwrapErr(parsed).code).toBe("RESPONSE_FIELD_MISSING");
  });

  it.each([
    // 1e308 seconds is a finite number whose milliseconds are Infinity — written to the grant as JSON `null`.
    [1e308],
    [0],
    [-1],
    [3599.5],
  ])("refuses expires_in %s as MALFORMED, a different failure from a missing one", (expiresIn) => {
    const parsed = parseTokenResponse({ body: JSON.stringify({ access_token: "at", expires_in: expiresIn }) });
    expect(unwrapErr(parsed)).toStrictEqual(
      GoogleOauthErrors.tokenLifetimeMalformed({ field: "expires_in", value: expiresIn }),
    );
    expect(unwrapErr(parsed).code).toBe("RESPONSE_FIELD_MALFORMED");
  });

  it("reads refresh_token_expires_in, which a Testing-status client is sent", () => {
    const body = JSON.stringify({
      access_token: "at",
      expires_in: 3599,
      refresh_token: "rt",
      refresh_token_expires_in: 604799,
    });
    expect(unwrap(parseTokenResponse({ body })).refreshTokenExpiresInSeconds).toBe(604799);
  });

  it("leaves the refresh lifetime absent when Google names none, as for a Production client", () => {
    const parsed = unwrap(parseTokenResponse({ body: JSON.stringify({ access_token: "at", expires_in: 3599 }) }));
    expect(Object.keys(parsed)).not.toContain("refreshTokenExpiresInSeconds");
  });

  it.each([
    ["a string", "604799"],
    ["null", null],
    ["zero", 0],
    ["a negative", -1],
    ["a fraction", 604799.5],
    ["one whose milliseconds overflow", 1e308],
  ])("refuses refresh_token_expires_in as %s as MALFORMED, naming that field", (_label, value) => {
    const body = JSON.stringify({ access_token: "at", expires_in: 3599, refresh_token_expires_in: value });
    const refused = unwrapErr(parseTokenResponse({ body }));
    expect(refused).toStrictEqual(
      GoogleOauthErrors.tokenLifetimeMalformed({ field: "refresh_token_expires_in", value }),
    );
    expect(refused.code).toBe("RESPONSE_FIELD_MALFORMED");
  });
});

describe("parseUserinfoEmail", () => {
  it("reads the bound mailbox", () => {
    expect(unwrap(parseUserinfoEmail({ body: JSON.stringify({ email: "me@example.test" }) }))).toBe("me@example.test");
  });

  it("names the scope that would have supplied it when it is absent", () => {
    const parsed = parseUserinfoEmail({ body: JSON.stringify({ sub: "1" }) });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("userinfo.email");
  });
});

describe("tokenExchangeBody", () => {
  it("form-encodes the exchange, carrying the PKCE verifier Google recomputes the challenge from", () => {
    const params = new URLSearchParams(
      tokenExchangeBody({
        clientId: "cid",
        clientSecret: "csec",
        code: "the code",
        codeVerifier: "ver",
        redirectUri: "http://127.0.0.1:5555",
      }),
    );
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("the code");
    expect(params.get("code_verifier")).toBe("ver");
    expect(params.get("client_id")).toBe("cid");
    expect(params.get("redirect_uri")).toBe("http://127.0.0.1:5555");
  });
});

describe("tokenRevokeBody", () => {
  it("sends the REFRESH token, which is what withdraws the whole (client, account) grant", () => {
    expect(tokenRevokeBody({ refreshToken: "1//rt" })).toBe("token=1%2F%2Frt");
  });
});

describe("parseRevokeResponse", () => {
  it("reads Google's EMPTY success body as success rather than as a missing field", () => {
    expect(unwrap(parseRevokeResponse({ body: "" }))).toBeUndefined();
  });

  it("reads a whitespace-only body as success too", () => {
    expect(unwrap(parseRevokeResponse({ body: "\n  " }))).toBeUndefined();
  });

  it("reports Google's own refusal code and description", () => {
    const parsed = parseRevokeResponse({
      body: JSON.stringify({ error: "invalid_token", error_description: "Token expired or revoked" }),
    });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toBe(
      "the Google revocation endpoint refused: invalid_token — Token expired or revoked",
    );
    expect(unwrapErr(parsed).code).toBe("ENDPOINT_REFUSED");
  });

  it("refuses a body that is not JSON, naming the endpoint that answered", () => {
    const parsed = parseRevokeResponse({ body: "<html>502</html>" });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toBe("the Google revocation endpoint returned a body that is not valid JSON");
  });

  it("refuses a JSON body that is not an object", () => {
    const parsed = parseRevokeResponse({ body: "null" });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toBe("the Google revocation endpoint returned a body that is not an object");
  });

  it("accepts an object body carrying no error field", () => {
    expect(unwrap(parseRevokeResponse({ body: "{}" }))).toBeUndefined();
  });
});

describe("GOOGLE_REVOKE_ENDPOINT", () => {
  it("is Google's documented revocation endpoint", () => {
    expect(GOOGLE_REVOKE_ENDPOINT).toBe("https://oauth2.googleapis.com/revoke");
  });
});
