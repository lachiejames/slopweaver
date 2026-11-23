/**
 * Every Events API failure, raised through its factory: the code a caller branches on and the exact lines
 * it prints. The 403 line must keep its `HTTP 403` text — the events channel picks its gap on it.
 */
import { describe, expect, it } from "vitest";

import { OnepasswordEventsErrors, onepasswordEventsErrorLines } from "../../../../atlas/onepassword/eventsErrors.js";

describe("OnepasswordEventsErrors — the credential", () => {
  it("names an unset token and how to mint one", () => {
    const error = OnepasswordEventsErrors.tokenUnset({ name: "ONEPASSWORD_EVENTS_TOKEN" });

    expect(error.code).toBe("TOKEN_UNSET");
    expect(error.message).toBe(
      "ONEPASSWORD_EVENTS_TOKEN is not set — mint a token at 1Password.com → Integrations → Events Reporting, then: slopweaver secrets set onepassword-events-token",
    );
  });

  it("names an implausible length by its count only", () => {
    const error = OnepasswordEventsErrors.tokenLengthImplausible({ length: 9, name: "ONEPASSWORD_EVENTS_TOKEN" });

    expect(error.code).toBe("TOKEN_LENGTH_IMPLAUSIBLE");
    expect(error.message).toBe(
      "ONEPASSWORD_EVENTS_TOKEN is set (9 chars) but is not a plausible token length — re-issue it rather than editing it",
    );
  });

  it("names whitespace in the token", () => {
    const error = OnepasswordEventsErrors.tokenHasWhitespace({ name: "ONEPASSWORD_EVENTS_TOKEN" });

    expect(error.code).toBe("TOKEN_HAS_WHITESPACE");
    expect(error.message).toBe(
      "ONEPASSWORD_EVENTS_TOKEN is set but contains whitespace, which is not part of any token 1Password issues — re-copy it",
    );
  });

  it("names a host that is not bare, with an example rather than the configured value", () => {
    const error = OnepasswordEventsErrors.hostNotBare({
      example: "events.1password.com",
      name: "ONEPASSWORD_EVENTS_HOST",
    });

    expect(error.code).toBe("HOST_NOT_BARE");
    expect(error.message).toBe(
      "ONEPASSWORD_EVENTS_HOST is not a bare hostname — set it to something like events.1password.com, with no scheme and no path",
    );
  });
});

describe("OnepasswordEventsErrors — the client", () => {
  it("names a failed request by method and path", () => {
    const error = OnepasswordEventsErrors.requestFailed({
      cause: new Error("ECONNRESET"),
      method: "POST",
      path: "/api/v2/auditevents",
    });

    expect(error.code).toBe("REQUEST_FAILED");
    expect(onepasswordEventsErrorLines({ error })).toEqual(["POST /api/v2/auditevents failed: ECONNRESET"]);
  });

  it("names a 401 as a refused token, on two lines", () => {
    const error = OnepasswordEventsErrors.httpRefused({ path: "/api/v2/auditevents", status: 401 });

    expect(error.code).toBe("HTTP_REFUSED");
    expect(onepasswordEventsErrorLines({ error })).toEqual([
      "/api/v2/auditevents returned HTTP 401 — the Events API token was refused",
      "either the token is wrong, it has expired, or the account is served from a different region than ONEPASSWORD_EVENTS_HOST names",
    ]);
  });

  it("names a 403 as a missing event family, on two lines", () => {
    const error = OnepasswordEventsErrors.httpRefused({ path: "/api/v2/auditevents", status: 403 });

    expect(onepasswordEventsErrorLines({ error })).toEqual([
      "/api/v2/auditevents returned HTTP 403 — this token was not issued with the event family this surface needs",
      "re-issue it at 1Password.com → Integrations → Events Reporting with that family ticked",
    ]);
    expect(error.message).toBe(
      "/api/v2/auditevents returned HTTP 403 — this token was not issued with the event family this surface needs; re-issue it at 1Password.com → Integrations → Events Reporting with that family ticked",
    );
  });

  it("names any other status bare", () => {
    const error = OnepasswordEventsErrors.httpRefused({ path: "/api/v2/auditevents", status: 500 });

    expect(onepasswordEventsErrorLines({ error })).toEqual(["/api/v2/auditevents returned HTTP 500"]);
  });

  it("carries a changed response's boundary message forward unchanged, and names an unlisted surface", () => {
    const boundary =
      'POST /api/v2/auditevents answered a shape this version does not read — refused, not guessed: new field "x"';
    const errors = [
      OnepasswordEventsErrors.responseChanged({ message: boundary }),
      OnepasswordEventsErrors.endpointUnlisted({ surface: "events-audit" }),
    ];

    expect(errors.map((error) => error.code)).toEqual(["RESPONSE_CHANGED", "ENDPOINT_UNLISTED"]);
    expect(errors.flatMap((error) => onepasswordEventsErrorLines({ error }))).toEqual([
      boundary,
      "the events-audit surface is not in the closed endpoint allowlist",
    ]);
  });
});
