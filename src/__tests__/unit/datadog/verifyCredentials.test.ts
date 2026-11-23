import { describe, expect, it } from "vitest";

import { classifyApiKeyFailure, classifyAppKeyFailure, httpStatusOf } from "../../../datadog/verifyCredentials.js";

const SITE = "us3.datadoghq.com";

describe("httpStatusOf", () => {
  it("reads a numeric code off an SDK exception", () => {
    expect(httpStatusOf({ error: Object.assign(new Error("Forbidden"), { code: 403 }) })).toBe(403);
  });

  it("ignores Node's string codes, so a network failure is not read as an HTTP status", () => {
    expect(httpStatusOf({ error: Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" }) })).toBe(null);
  });

  it("returns null for a plain error", () => {
    expect(httpStatusOf({ error: new Error("boom") })).toBe(null);
  });

  it.each([null, undefined, "a string", 42])("returns null for the non-object %s", (error) => {
    expect(httpStatusOf({ error })).toBe(null);
  });
});

describe("classifyApiKeyFailure", () => {
  it("names DD_API_KEY on a 403 and points at the right settings page", () => {
    const reasons = classifyApiKeyFailure({ status: 403, site: SITE });
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toContain("Datadog rejected DD_API_KEY (403 from us3.datadoghq.com)");
    expect(reasons[0]).toContain("https://us3.datadoghq.com/organization-settings/api-keys");
  });

  it("raises the wrong-site possibility, which fails identically", () => {
    expect(classifyApiKeyFailure({ status: 403, site: SITE })[1]).toContain("valid for a DIFFERENT site");
  });

  it("reports an unexpected status without pretending to diagnose it", () => {
    const reasons = classifyApiKeyFailure({ status: 500, site: SITE });
    expect(reasons).toEqual(["Datadog refused to validate DD_API_KEY with HTTP 500 from us3.datadoghq.com"]);
  });
});

describe("classifyAppKeyFailure", () => {
  it("calls a 401 a missing or non-key value", () => {
    const reasons = classifyAppKeyFailure({ status: 401, site: SITE });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("DD_APP_KEY is missing or is not an application key (401");
    expect(reasons[0]).toContain("https://us3.datadoghq.com/organization-settings/application-keys");
  });

  it("calls a 403 a rejected key, and says the API key was already proven good", () => {
    const reasons = classifyAppKeyFailure({ status: 403, site: SITE });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("Datadog rejected DD_APP_KEY (403");
    expect(reasons[0]).toContain("while DD_API_KEY verified fine");
  });

  it("never blames the API key, since this stage runs only after the API key verified", () => {
    const blamed = [401, 403, 500].flatMap((status) => classifyAppKeyFailure({ status, site: SITE }));
    expect(blamed.filter((reason) => reason.includes("Re-issue the API key"))).toEqual([]);
  });

  it("reports an unexpected status without pretending to diagnose it", () => {
    const reasons = classifyAppKeyFailure({ status: 502, site: SITE });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("HTTP 502");
  });
});
