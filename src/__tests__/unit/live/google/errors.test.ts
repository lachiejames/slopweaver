/**
 * The Google consent handshake's typed failures in `live/google/errors.ts`: each factory's code, message and
 * carried fields, including the `error_description` suffix a refusal adds only when Google sent a string.
 */
import { describe, expect, it } from "vitest";

import { GoogleOauthErrors } from "../../../../live/google/errors.js";

describe("GoogleOauthErrors callback failures", () => {
  it("names a callback with no code", () => {
    expect(GoogleOauthErrors.callbackCodeMissing()).toEqual({
      code: "CALLBACK_UNUSABLE",
      message: "the consent callback carried no authorisation code",
    });
  });

  it("names a callback whose state is not this flow's", () => {
    expect(GoogleOauthErrors.callbackStateMismatch()).toEqual({
      code: "CALLBACK_UNUSABLE",
      message: "the consent callback carried the wrong state — the flow was not the one this process started",
    });
  });

  it("carries Google's own refusal reason verbatim", () => {
    expect(GoogleOauthErrors.consentRefused({ reason: "access_denied" })).toEqual({
      code: "CONSENT_REFUSED",
      message: "Google refused the consent request: access_denied",
      reason: "access_denied",
    });
  });
});

describe("GoogleOauthErrors response failures", () => {
  it("names a userinfo answer with no email and the scope to check", () => {
    expect(GoogleOauthErrors.emailMissing()).toEqual({
      code: "RESPONSE_FIELD_MISSING",
      endpoint: "userinfo",
      field: "email",
      message: "the Google userinfo endpoint returned no email — was the userinfo.email scope approved?",
    });
  });

  it("names the endpoint whose body was not an object", () => {
    expect(GoogleOauthErrors.notAnObject({ endpoint: "token" })).toEqual({
      code: "RESPONSE_UNREADABLE",
      endpoint: "token",
      message: "the Google token endpoint returned a body that is not an object",
    });
  });

  it("names the endpoint whose body was not JSON", () => {
    expect(GoogleOauthErrors.notJson({ endpoint: "userinfo" })).toEqual({
      code: "RESPONSE_UNREADABLE",
      endpoint: "userinfo",
      message: "the Google userinfo endpoint returned a body that is not valid JSON",
    });
  });

  it("names the token field that was missing", () => {
    expect(GoogleOauthErrors.tokenFieldMissing({ field: "expires_in" })).toEqual({
      code: "RESPONSE_FIELD_MISSING",
      endpoint: "token",
      field: "expires_in",
      message: "the Google token endpoint returned no expires_in",
    });
  });

  it("names a token lifetime no expiry can be recorded from, apart from a missing one", () => {
    expect(GoogleOauthErrors.tokenLifetimeMalformed({ field: "expires_in", value: 0 })).toEqual({
      code: "RESPONSE_FIELD_MALFORMED",
      endpoint: "token",
      field: "expires_in",
      message:
        "the Google token endpoint returned expires_in 0, which is no positive whole number of seconds an expiry can be recorded from",
    });
  });

  it("names which lifetime was malformed when it is the refresh token's", () => {
    expect(GoogleOauthErrors.tokenLifetimeMalformed({ field: "refresh_token_expires_in", value: "604799" })).toEqual({
      code: "RESPONSE_FIELD_MALFORMED",
      endpoint: "token",
      field: "refresh_token_expires_in",
      message:
        "the Google token endpoint returned refresh_token_expires_in 604799, which is no positive whole number of seconds an expiry can be recorded from",
    });
  });
});

describe("GoogleOauthErrors endpoint refusals", () => {
  it("appends Google's description to a refused token exchange", () => {
    expect(GoogleOauthErrors.tokenExchangeRefused({ description: "Bad Request", errorCode: "invalid_grant" })).toEqual({
      code: "ENDPOINT_REFUSED",
      endpoint: "token",
      errorCode: "invalid_grant",
      message: "the Google token endpoint refused the exchange: invalid_grant — Bad Request",
    });
  });

  it("omits the description suffix when Google sent none", () => {
    expect(GoogleOauthErrors.tokenExchangeRefused({ description: undefined, errorCode: "invalid_grant" }).message).toBe(
      "the Google token endpoint refused the exchange: invalid_grant",
    );
  });

  it("omits the description suffix when it is not a string", () => {
    expect(GoogleOauthErrors.revocationRefused({ description: 400, errorCode: "invalid_token" })).toEqual({
      code: "ENDPOINT_REFUSED",
      endpoint: "revocation",
      errorCode: "invalid_token",
      message: "the Google revocation endpoint refused: invalid_token",
    });
  });

  it("appends the description to a refused revocation", () => {
    expect(
      GoogleOauthErrors.revocationRefused({ description: "Token expired or revoked", errorCode: "invalid_token" })
        .message,
    ).toBe("the Google revocation endpoint refused: invalid_token — Token expired or revoked");
  });
});
