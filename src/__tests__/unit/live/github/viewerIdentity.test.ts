/**
 * The token owner's commit identity: the login and numeric id read out of one GraphQL answer, and GitHub's
 * no-reply address built from them, computed here from synthetic values rather than written as a literal.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../live/github/errors.js";
import type { GithubReadGraphql } from "../../../../live/github/read.js";
import { githubNoReplyAddress, parseViewerIdentity, viewerIdentity } from "../../../../live/github/viewerIdentity.js";

const LOGIN = "acme-dev";
const DATABASE_ID = 4242;

describe("parseViewerIdentity", () => {
  it("reads the login and numeric id", () => {
    expect(unwrap(parseViewerIdentity({ response: { viewer: { databaseId: DATABASE_ID, login: LOGIN } } }))).toEqual({
      databaseId: DATABASE_ID,
      login: LOGIN,
    });
  });

  it("refuses a missing or malformed login", () => {
    expect([
      unwrapErr(parseViewerIdentity({ response: { viewer: { databaseId: DATABASE_ID } } })).message,
      unwrapErr(parseViewerIdentity({ response: { viewer: { databaseId: DATABASE_ID, login: "acme/team" } } })).message,
    ]).toEqual([
      "GitHub returned no user login for the token's owner",
      "GitHub returned no user login for the token's owner",
    ]);
  });

  it("refuses a zero, fractional or string id", () => {
    const refusal = "GitHub returned no positive numeric id for the token's owner";
    expect(
      [0, 1.5, "4242"].map(
        (databaseId) => unwrapErr(parseViewerIdentity({ response: { viewer: { databaseId, login: LOGIN } } })).message,
      ),
    ).toEqual([refusal, refusal, refusal]);
  });
});

describe("viewerIdentity", () => {
  it("asks for the login and id only, and parses the answer", async () => {
    const queries: string[] = [];
    const graphql: GithubReadGraphql = async ({ query }) => {
      queries.push(query);
      return ok({ viewer: { databaseId: DATABASE_ID, login: LOGIN } });
    };
    expect(unwrap(await viewerIdentity({ graphql }))).toEqual({ databaseId: DATABASE_ID, login: LOGIN });
    expect(queries).toEqual(["query SlopweaverViewerIdentity { viewer { login databaseId } }"]);
  });

  it("carries a read failure through unchanged", async () => {
    const failure = GithubLiveErrors.readFailed({ message: "network down" });
    const graphql: GithubReadGraphql = async () => err(failure);
    expect(unwrapErr(await viewerIdentity({ graphql }))).toEqual(failure);
  });
});

describe("githubNoReplyAddress", () => {
  it("is GitHub's id-plus-login no-reply form", () => {
    expect(githubNoReplyAddress({ identity: { databaseId: DATABASE_ID, login: LOGIN } })).toBe(
      `${String(DATABASE_ID)}+${LOGIN}@users.noreply.github.com`,
    );
  });
});
