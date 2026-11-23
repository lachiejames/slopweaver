import { describe, expect, it } from "vitest";

import { slackScopesFromMetadata } from "../../../../corpus/slack/responseMetadata.js";

describe("slackScopesFromMetadata", () => {
  it("lifts the granted list the SDK put on response_metadata", () => {
    // MEASURED shape: `@slack/web-api` copies Slack's `x-oauth-scopes` response header onto
    // `response_metadata.scopes`, so `auth.test` alone yields the granted set.
    const scopes = slackScopesFromMetadata({
      metadata: { scopes: ["channels:history", "files:read", "users:read"] },
    });

    expect(scopes).toEqual(["channels:history", "files:read", "users:read"]);
  });

  it("returns undefined — never [] — when the response carried no metadata", () => {
    // The distinction is load-bearing: `[]` would tell the preflight Slack reported a token holding nothing,
    // which would refuse the attachments of a perfectly good thread over a failed diagnostic.
    expect(slackScopesFromMetadata({ metadata: undefined })).toBe(undefined);
  });

  it("returns undefined when metadata is not an object at all", () => {
    expect(slackScopesFromMetadata({ metadata: "channels:history,files:read" })).toBe(undefined);
    expect(slackScopesFromMetadata({ metadata: null })).toBe(undefined);
  });

  it("returns undefined when `scopes` is present but not an array", () => {
    expect(slackScopesFromMetadata({ metadata: { scopes: "files:read" } })).toBe(undefined);
  });

  it("returns undefined for an EMPTY array, which tells us nothing either", () => {
    expect(slackScopesFromMetadata({ metadata: { scopes: [] } })).toBe(undefined);
  });

  it("drops non-string and empty entries rather than trusting the shape", () => {
    const scopes = slackScopesFromMetadata({ metadata: { scopes: ["files:read", "", 7, null, "users:read"] } });

    expect(scopes).toEqual(["files:read", "users:read"]);
  });

  it("keeps a list whose only usable entry survives the filter", () => {
    expect(slackScopesFromMetadata({ metadata: { scopes: [null, "files:read"] } })).toEqual(["files:read"]);
  });
});
