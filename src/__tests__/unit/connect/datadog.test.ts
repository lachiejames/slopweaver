/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import { classifyDatadog } from "../../../connect/datadog.js";

describe("classifyDatadog", () => {
  it("passes once both keys verified, and says why a colleague may see different data", () => {
    const report = classifyDatadog({
      probe: { configReasons: [], site: "ap1.datadoghq.com", verification: "verified", verifyReasons: [] },
    });
    expect(report.ok).toBe(true);
    expect(report.source).toBe("datadog");
    expect(report.capabilities.map((c) => [c.id, c.status])).toEqual([
      ["auth", "ok"],
      ["app-key-scope", "ok"],
    ]);
    expect(report.capabilities[0]!.detail).toBe("both keys verified at ap1.datadoghq.com");
    expect(report.capabilities[1]!.detail).toContain("its creator's own Datadog permissions");
  });

  it("names a missing key and points at THIS site's own key pages", () => {
    const report = classifyDatadog({
      probe: {
        configReasons: ["DD_APP_KEY is not set"],
        site: "ap1.datadoghq.com",
        verification: "not-run",
        verifyReasons: [],
      },
    });
    expect(report.ok).toBe(false);
    expect(report.tokenPresent).toBe(false);
    expect(report.capabilities).toEqual([
      { detail: "DD_APP_KEY is not set", id: "config", status: "missing" },
      {
        detail:
          "mint your own keys at https://ap1.datadoghq.com/organization-settings/api-keys and " +
          "https://ap1.datadoghq.com/organization-settings/application-keys",
        id: "mint",
        status: "missing",
      },
    ]);
  });

  it("derives the key pages from the console host, which is not always the site", () => {
    const report = classifyDatadog({
      probe: {
        configReasons: ["DD_API_KEY is not set"],
        site: "datadoghq.eu",
        verification: "not-run",
        verifyReasons: [],
      },
    });
    expect(report.capabilities[1]!.detail).toContain("https://app.datadoghq.eu/organization-settings/api-keys");
  });

  it("asks for the site first when there is no site to point at", () => {
    const report = classifyDatadog({
      probe: { configReasons: ["DD_SITE is not set"], site: undefined, verification: "not-run", verifyReasons: [] },
    });
    expect(report.capabilities[1]!.detail).toBe("set the site first — the key pages live on your org's own site");
  });

  it("fails with Datadog's own reasons when it refuses the keys", () => {
    const report = classifyDatadog({
      probe: {
        configReasons: [],
        site: "us3.datadoghq.com",
        verification: "rejected",
        verifyReasons: ["Datadog rejected DD_API_KEY (403 from us3.datadoghq.com)"],
      },
    });
    expect(report.ok).toBe(false);
    expect(report.tokenPresent).toBe(true);
    expect(report.capabilities[0]).toEqual({
      detail: "Datadog rejected DD_API_KEY (403 from us3.datadoghq.com)",
      id: "auth",
      status: "missing",
    });
  });
});
