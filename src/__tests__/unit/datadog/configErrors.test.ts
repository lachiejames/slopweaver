import { describe, expect, it } from "vitest";

import { DatadogConfigErrors, datadogConfigErrorLines } from "../../../datadog/configErrors.js";

const SITES = ["us3.datadoghq.com", "datadoghq.eu"] as const;

describe("DatadogConfigErrors", () => {
  it("names a missing credential, the store command that sets it, and the shape", () => {
    const error = DatadogConfigErrors.credentialMissing({
      name: "DD_API_KEY",
      secretName: "datadog-api-key",
      shapeLabel: "32 hex chars",
    });
    const message =
      "DD_API_KEY is not set — store it with `slopweaver secrets set datadog-api-key`, or export DD_API_KEY (32 hex chars)";
    expect(error).toEqual({ code: "CREDENTIAL_MISSING", message, name: "DD_API_KEY", shapeLabel: "32 hex chars" });
    expect(datadogConfigErrorLines({ error })).toEqual([message]);
  });

  it("names a malformed credential by its length, never its value", () => {
    const error = DatadogConfigErrors.credentialMalformed({
      length: 7,
      name: "DD_APP_KEY",
      shapeLabel: "40 hex chars",
    });
    expect(error.code).toBe("CREDENTIAL_MALFORMED");
    expect(error.message).toBe(
      "DD_APP_KEY is set (7 chars) but is not 40 hex chars — re-issue it rather than editing it",
    );
  });

  it("joins an invalid config's reasons for its message and prints them one line each", () => {
    const error = DatadogConfigErrors.configInvalid({ reasons: ["first", "second"] });
    expect(error.code).toBe("CONFIG_INVALID");
    expect(error.message).toBe("first; second");
    expect(datadogConfigErrorLines({ error })).toEqual(["first", "second"]);
  });

  it("lists the accepted sites when DD_SITE is missing or wrong", () => {
    const missing = DatadogConfigErrors.siteMissing({ acceptedSites: SITES });
    expect(missing.code).toBe("SITE_MISSING");
    expect(missing.message).toBe(
      "DD_SITE is not set, and it has no safe default — the SDK would fall back to datadoghq.com (US1), a different org that answers queries with silence rather than an error. Set profile.json's datadog.site (or export DD_SITE) to your org's site, one of: us3.datadoghq.com, datadoghq.eu",
    );
    const invalid = DatadogConfigErrors.siteInvalid({ acceptedSites: SITES, value: "example.com" });
    expect(invalid.code).toBe("SITE_INVALID");
    expect(invalid.message).toBe(
      "DD_SITE is 'example.com', which is not a Datadog site. Expected one of: us3.datadoghq.com, datadoghq.eu",
    );
  });

  it("says an API key reported invalid without a refusal", () => {
    const error = DatadogConfigErrors.apiKeyReportedInvalid({ site: "us3.datadoghq.com" });
    expect(error.code).toBe("API_KEY_REPORTED_INVALID");
    expect(error.message).toBe(
      "Datadog reported DD_API_KEY as invalid at us3.datadoghq.com, without refusing the request",
    );
  });

  it("carries a rejected key's classified reasons as its printed lines", () => {
    const api = DatadogConfigErrors.apiKeyRejected({ reasons: ["a", "b"], site: "us3.datadoghq.com", status: 403 });
    expect(api.code).toBe("API_KEY_REJECTED");
    expect(api.message).toBe("a; b");
    expect(datadogConfigErrorLines({ error: api })).toEqual(["a", "b"]);
    const app = DatadogConfigErrors.appKeyRejected({ reasons: ["c"], site: "us3.datadoghq.com", status: 401 });
    expect(app.code).toBe("APP_KEY_REJECTED");
    expect(datadogConfigErrorLines({ error: app })).toEqual(["c"]);
  });

  it("says an unreachable Datadog is a connectivity failure, in two lines", () => {
    const error = DatadogConfigErrors.credentialsUnreachable({ apiHost: "api.us3.datadoghq.com", detail: "ENOTFOUND" });
    expect(error.code).toBe("CREDENTIALS_UNREACHABLE");
    expect(datadogConfigErrorLines({ error })).toEqual([
      "could not reach Datadog at api.us3.datadoghq.com: ENOTFOUND",
      "This is a connectivity failure, not a credential one — the keys were never checked",
    ]);
  });
});
