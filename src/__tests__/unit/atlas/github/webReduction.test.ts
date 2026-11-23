/**
 * The browser reduction: GitHub's own value shapes, and what a recorded request keeps.
 *
 * The ids below are synthetic but shaped like GitHub's real ones, because the whole point of a
 * platform-specific classifier is that a sibling's pattern does not match. Slack's is `^[A-Z][A-Z0-9]{8,}$`
 * and Falcon's is 32 lowercase hex; neither matches a GitHub node id or a bare database id, and reducing a
 * GitHub capture with either would keep every real id it saw.
 */
import { describe, expect, it } from "vitest";

import {
  GITHUB_SEGMENTS,
  githubParamNames,
  githubPathShape,
  reduceWebCalls,
} from "../../../../atlas/github/webReduction.js";

const ORIGIN = "https://github.example.test";

describe("GITHUB_SEGMENTS", () => {
  it("redacts a bare database id", () => {
    expect(GITHUB_SEGMENTS({ segment: "123456" })?.placeholder).toBe("<n>");
  });

  it("redacts a commit sha as a sha rather than as an opaque id", () => {
    expect(GITHUB_SEGMENTS({ segment: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678" })?.placeholder).toBe("<sha>");
  });

  it("redacts a base64url node id", () => {
    expect(GITHUB_SEGMENTS({ segment: "MDEyOk9yZ2FuaXphdGlvbjE=" })?.placeholder).toBe("<id>");
  });

  it("redacts a uuid", () => {
    expect(GITHUB_SEGMENTS({ segment: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" })?.placeholder).toBe("<uuid>");
  });

  it("leaves a route word alone", () => {
    expect(GITHUB_SEGMENTS({ segment: "settings" })).toBe(null);
  });

  it("leaves a short word alone that a longer-id pattern would swallow", () => {
    expect(GITHUB_SEGMENTS({ segment: "repos" })).toBe(null);
  });

  it("never collapses two adjacent values, because no GitHub value is split across segments", () => {
    expect(GITHUB_SEGMENTS({ segment: "123" })?.collapsesWithPrevious).toBe(false);
  });
});

describe("githubPathShape", () => {
  it("replaces a numeric id so one endpoint is one entity", () => {
    expect(githubPathShape({ url: `${ORIGIN}/repositories/42/settings` })).toBe("/repositories/<n>/settings");
  });

  it("drops the query entirely, because its values are what must not be kept", () => {
    expect(githubPathShape({ url: `${ORIGIN}/_filter/repositories?q=secret-name` })).toBe("/_filter/repositories");
  });

  it("returns null for a value that is not a URL", () => {
    expect(githubPathShape({ url: "not a url" })).toBe(null);
  });
});

describe("githubParamNames", () => {
  it("keeps parameter names and drops their values", () => {
    expect(githubParamNames({ url: `${ORIGIN}/_filter/repositories?q=anything&limit=5` })).toEqual(["limit", "q"]);
  });

  it("drops session telemetry", () => {
    expect(githubParamNames({ url: `${ORIGIN}/x?_=1&authenticity_token=abc&real=1` })).toEqual(["real"]);
  });

  it("returns an empty list for a URL with no query", () => {
    expect(githubParamNames({ url: `${ORIGIN}/settings/profile` })).toEqual([]);
  });
});

describe("reduceWebCalls", () => {
  it("folds the same endpoint called from two pages into one row naming both", () => {
    const reduced = reduceWebCalls({
      calls: [
        { body: { mode: "all" }, method: "GET", onPage: "/settings/profile", statusCode: 200, url: `${ORIGIN}/x.json` },
        { body: { mode: "all" }, method: "GET", onPage: "/settings/emails", statusCode: 200, url: `${ORIGIN}/x.json` },
      ],
    });
    expect(reduced).toHaveLength(1);
    expect(reduced[0]!.observedOnPages).toEqual(["/settings/emails", "/settings/profile"]);
    expect(reduced[0]!.statusCodes).toEqual([200]);
  });

  it("records response field NAMES and never a value", () => {
    const reduced = reduceWebCalls({
      calls: [
        {
          body: { user: { login: "member-a", plan: "team" } },
          method: "GET",
          onPage: "/settings/profile",
          statusCode: 200,
          url: `${ORIGIN}/panel.json`,
        },
      ],
    });
    expect(reduced[0]!.responseFieldPaths).toEqual(["user", "user.login", "user.plan"]);
  });

  it("keeps two different methods on one path as two rows", () => {
    const reduced = reduceWebCalls({
      calls: [
        { body: {}, method: "GET", onPage: "/settings/profile", statusCode: 200, url: `${ORIGIN}/x.json` },
        { body: {}, method: "POST", onPage: "/settings/profile", statusCode: 204, url: `${ORIGIN}/x.json` },
      ],
    });
    expect(reduced.map((entry) => entry.method)).toEqual(["GET", "POST"]);
  });

  it("drops a call whose URL cannot be parsed", () => {
    expect(
      reduceWebCalls({ calls: [{ body: {}, method: "GET", onPage: "/x", statusCode: 200, url: "nope" }] }),
    ).toEqual([]);
  });

  it("returns nothing for a walk that observed nothing", () => {
    expect(reduceWebCalls({ calls: [] })).toEqual([]);
  });
});
