import { describe, expect, it } from "vitest";

import { HiveApiErrors, isHiveCredentialGap } from "../../../../atlas/graphqlHive/errors.js";

const ENDPOINT = "https://app.graphql-hive.com/graphql";

describe("HiveApiErrors.credentialMissing", () => {
  it("lists what was checked in order and names the remedy", () => {
    const checked = ["$SLOPWEAVER_HOME/secrets/graphql-hive-token", "GRAPHQL_HIVE_TOKEN"];
    const error = HiveApiErrors.credentialMissing({ checked });
    expect(error).toEqual({
      checked: ["$SLOPWEAVER_HOME/secrets/graphql-hive-token", "GRAPHQL_HIVE_TOKEN"],
      code: "CREDENTIAL_MISSING",
      message:
        "no GraphQL Hive access token is configured — checked $SLOPWEAVER_HOME/secrets/graphql-hive-token, GRAPHQL_HIVE_TOKEN. Create one in the console under an organisation's Settings → Access Tokens, then run: slopweaver secrets set graphql-hive-token",
    });
    expect(error.checked).not.toBe(checked);
  });

  it("ends the checked list at the word when nothing was checked", () => {
    const error = HiveApiErrors.credentialMissing({ checked: [] });
    expect(error).toEqual({
      checked: [],
      code: "CREDENTIAL_MISSING",
      message:
        "no GraphQL Hive access token is configured — checked . Create one in the console under an organisation's Settings → Access Tokens, then run: slopweaver secrets set graphql-hive-token",
    });
  });
});

describe("HiveApiErrors.credentialUnreadable", () => {
  it("names the path and the reason", () => {
    const error = HiveApiErrors.credentialUnreadable({ path: "/home/x/secrets/graphql-hive-token", reason: "EACCES" });
    expect(error).toEqual({
      code: "CREDENTIAL_UNREADABLE",
      message: "could not read the GraphQL Hive access token at /home/x/secrets/graphql-hive-token: EACCES",
      path: "/home/x/secrets/graphql-hive-token",
    });
  });
});

describe("HiveApiErrors.transportFailed", () => {
  it("uses the message of an Error cause and carries the cause itself", () => {
    const cause = new Error("getaddrinfo ENOTFOUND");
    const error = HiveApiErrors.transportFailed({ endpoint: ENDPOINT, cause });
    expect(error).toEqual({
      cause,
      code: "TRANSPORT_FAILED",
      endpoint: ENDPOINT,
      message: "could not reach https://app.graphql-hive.com/graphql: getaddrinfo ENOTFOUND",
    });
    expect(error.cause).toBe(cause);
  });

  it("stringifies a non-Error cause and carries it unchanged", () => {
    const error = HiveApiErrors.transportFailed({ endpoint: ENDPOINT, cause: "timed out" });
    expect(error).toEqual({
      cause: "timed out",
      code: "TRANSPORT_FAILED",
      endpoint: ENDPOINT,
      message: "could not reach https://app.graphql-hive.com/graphql: timed out",
    });
  });

  it("stringifies an undefined cause", () => {
    const error = HiveApiErrors.transportFailed({ endpoint: ENDPOINT, cause: undefined });
    expect(error).toStrictEqual({
      cause: undefined,
      code: "TRANSPORT_FAILED",
      endpoint: ENDPOINT,
      message: "could not reach https://app.graphql-hive.com/graphql: undefined",
    });
  });
});

describe("HiveApiErrors.httpStatus", () => {
  it("carries the endpoint and the status", () => {
    const error = HiveApiErrors.httpStatus({ endpoint: ENDPOINT, statusCode: 502 });
    expect(error).toEqual({
      code: "HTTP_STATUS",
      endpoint: ENDPOINT,
      message: "https://app.graphql-hive.com/graphql answered HTTP 502",
      statusCode: 502,
    });
  });
});

describe("HiveApiErrors.malformedResponse", () => {
  it("carries the endpoint and the reason", () => {
    const error = HiveApiErrors.malformedResponse({ endpoint: ENDPOINT, reason: "body is not JSON" });
    expect(error).toEqual({
      code: "MALFORMED_RESPONSE",
      endpoint: ENDPOINT,
      message: "https://app.graphql-hive.com/graphql answered 200 with a body this atlas cannot read: body is not JSON",
    });
  });
});

describe("HiveApiErrors.graphqlErrors", () => {
  it("counts and joins several errors with a semicolon and copies them", () => {
    const errors = ["not authorised", "unknown field"];
    const error = HiveApiErrors.graphqlErrors({ endpoint: ENDPOINT, errors });
    expect(error).toEqual({
      code: "GRAPHQL_ERRORS",
      endpoint: ENDPOINT,
      errors: ["not authorised", "unknown field"],
      message:
        "https://app.graphql-hive.com/graphql answered 200 with 2 GraphQL error(s): not authorised; unknown field",
    });
    expect(error.errors).not.toBe(errors);
  });

  it("renders one error without a separator", () => {
    const error = HiveApiErrors.graphqlErrors({ endpoint: ENDPOINT, errors: ["not authorised"] });
    expect(error).toEqual({
      code: "GRAPHQL_ERRORS",
      endpoint: ENDPOINT,
      errors: ["not authorised"],
      message: "https://app.graphql-hive.com/graphql answered 200 with 1 GraphQL error(s): not authorised",
    });
  });

  it("ends the message at the colon and space when there are no errors", () => {
    const error = HiveApiErrors.graphqlErrors({ endpoint: ENDPOINT, errors: [] });
    expect(error).toEqual({
      code: "GRAPHQL_ERRORS",
      endpoint: ENDPOINT,
      errors: [],
      message: "https://app.graphql-hive.com/graphql answered 200 with 0 GraphQL error(s): ",
    });
  });
});

describe("isHiveCredentialGap", () => {
  it("is true for a missing credential", () => {
    expect(isHiveCredentialGap({ error: HiveApiErrors.credentialMissing({ checked: ["GRAPHQL_HIVE_TOKEN"] }) })).toBe(
      true,
    );
  });

  it("is false for an unreadable credential", () => {
    expect(isHiveCredentialGap({ error: HiveApiErrors.credentialUnreadable({ path: "/x", reason: "EACCES" }) })).toBe(
      false,
    );
  });

  it("is false for a transport failure", () => {
    expect(isHiveCredentialGap({ error: HiveApiErrors.transportFailed({ endpoint: ENDPOINT, cause: "x" }) })).toBe(
      false,
    );
  });

  it("is false for an HTTP status failure", () => {
    expect(isHiveCredentialGap({ error: HiveApiErrors.httpStatus({ endpoint: ENDPOINT, statusCode: 401 }) })).toBe(
      false,
    );
  });

  it("is false for a malformed response", () => {
    expect(isHiveCredentialGap({ error: HiveApiErrors.malformedResponse({ endpoint: ENDPOINT, reason: "x" }) })).toBe(
      false,
    );
  });

  it("is false for GraphQL errors", () => {
    expect(isHiveCredentialGap({ error: HiveApiErrors.graphqlErrors({ endpoint: ENDPOINT, errors: ["x"] }) })).toBe(
      false,
    );
  });
});
