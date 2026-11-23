/**
 * The KnowBe4 door's URL rail: only a closed-list path, a digits-only parent id and the query keys that path is
 * read with ever become a URL the token is sent to.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  buildKnowbe4Url,
  isClosedListUrl,
  KNOWBE4_API_ORIGIN,
  KNOWBE4_PATH_TEMPLATES,
  tokenWithheld,
} from "../../../../live/knowbe4/transport.js";

describe("isClosedListUrl", () => {
  it("admits what buildKnowbe4Url builds, and refuses another origin, path, query key, credential or fragment", () => {
    const built = unwrap(buildKnowbe4Url({ id: "12", query: { page: "1" }, template: "/v1/groups/{id}/members" }));
    expect(
      [
        built.href,
        "https://attacker.example/v1/users",
        "https://us.api.knowbe4.com/v1/users/12",
        "https://us.api.knowbe4.com/v1/users?email=a",
        "https://user:pass@us.api.knowbe4.com/v1/users",
        "https://us.api.knowbe4.com/v1/users#x",
        "https://us.api.knowbe4.com/v1/groups/abc/members",
      ].map((href) => isClosedListUrl({ url: new URL(href) })),
    ).toEqual([true, false, false, false, false, false, false]);
  });
});

describe("tokenWithheld", () => {
  it("withholds words that quote the token whole, and passes any other words through unchanged", () => {
    const token = "kb4-fake-token-of-a-real-length";
    expect([
      tokenWithheld({ message: `request failed for Bearer ${token}`, token }),
      tokenWithheld({ message: "KnowBe4 answered 500 on /v1/users", token }),
    ]).toEqual([
      "the request failed and its error quoted the token, so its words are withheld",
      "KnowBe4 answered 500 on /v1/users",
    ]);
  });
});

describe("buildKnowbe4Url", () => {
  it("builds a paged list read on the US Reporting API origin", () => {
    const url = unwrap(buildKnowbe4Url({ query: { page: "2", per_page: "500" }, template: "/v1/users" }));
    expect(url.href).toBe("https://us.api.knowbe4.com/v1/users?page=2&per_page=500");
  });

  it("fills a per-parent path with its numeric parent id", () => {
    const url = unwrap(buildKnowbe4Url({ id: "4242", query: { page: "1" }, template: "/v1/groups/{id}/members" }));
    expect(url.href).toBe("https://us.api.knowbe4.com/v1/groups/4242/members?page=1");
  });

  it("sends the training campaigns list with exclude_percentages, the one key that lifts its ten-row cap", () => {
    const url = unwrap(buildKnowbe4Url({ query: { exclude_percentages: "true" }, template: "/v1/training/campaigns" }));
    expect(url.searchParams.get("exclude_percentages")).toBe("true");
  });

  it("refuses a parent id that is not digits, so no segment can walk out of the path", () => {
    const refused = unwrapErr(
      buildKnowbe4Url({ id: "../../v1/account", query: {}, template: "/v1/phishing/security_tests/{id}/recipients" }),
    );
    expect(refused).toEqual({
      code: "PATH_REFUSED",
      message: "refused /v1/phishing/security_tests/{id}/recipients: the parent id is not a KnowBe4 numeric id",
      path: "/v1/phishing/security_tests/{id}/recipients",
    });
  });

  it("refuses a per-parent path read with no parent id", () => {
    expect(unwrapErr(buildKnowbe4Url({ query: {}, template: "/v1/groups/{id}/members" })).code).toBe("PATH_REFUSED");
  });

  it("refuses a parent id on a path that takes none", () => {
    expect(unwrapErr(buildKnowbe4Url({ id: "1", query: {}, template: "/v1/users" })).message).toBe(
      "refused /v1/users: this path takes no parent id",
    );
  });

  it("refuses a query key the path is not read with", () => {
    expect(unwrapErr(buildKnowbe4Url({ query: { status: "active" }, template: "/v1/users" })).message).toBe(
      "refused /v1/users: query parameter status is not one this path is read with",
    );
  });

  it("refuses paging on the account read, which answers one object", () => {
    expect(unwrapErr(buildKnowbe4Url({ query: { page: "1" }, template: "/v1/account" })).message).toBe(
      "refused /v1/account: query parameter page is not one this path is read with",
    );
  });
});

describe("the closed call list", () => {
  it("is the eleven list reads, sorted, and nothing else", () => {
    expect(KNOWBE4_PATH_TEMPLATES).toEqual([
      "/v1/account",
      "/v1/groups",
      "/v1/groups/{id}/members",
      "/v1/phishing/campaigns",
      "/v1/phishing/security_tests",
      "/v1/phishing/security_tests/{id}/recipients",
      "/v1/training/campaigns",
      "/v1/training/enrollments",
      "/v1/training/policies",
      "/v1/training/store_purchases",
      "/v1/users",
    ]);
  });

  it("pins the origin to KnowBe4's US region", () => {
    expect(KNOWBE4_API_ORIGIN).toBe("https://us.api.knowbe4.com");
  });
});
