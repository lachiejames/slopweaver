import { describe, expect, it } from "vitest";

import type { DependabotAlert } from "../../../../corpus/github/dependabot.js";
import { dependabotAlertOf, nextAfterCursor } from "../../../../corpus/github/dependabot.js";

/** GitHub's own `dependabot-alert` payload, trimmed to the fields the projection reads. */
function raw(over: Record<string, unknown> = {}): Parameters<typeof dependabotAlertOf>[0]["data"] {
  return {
    created_at: "2026-09-01T00:00:00Z",
    dependency: {
      manifest_path: "apps/server/package.json",
      package: { ecosystem: "npm", name: "lodash" },
      relationship: "transitive",
      scope: "runtime",
    },
    dismissed_at: null,
    dismissed_comment: null,
    dismissed_reason: null,
    fixed_at: null,
    html_url: "https://github.com/acme/widget/security/dependabot/583",
    number: 583,
    security_advisory: {
      cve_id: "CVE-2026-1234",
      cvss: { score: 8.1, vector_string: "CVSS:3.1/AV:N" },
      cwes: [{ cwe_id: "CWE-1321", name: "Prototype Pollution" }],
      ghsa_id: "GHSA-1111-2222-3333",
      published_at: "2026-08-01T00:00:00Z",
      references: [{ url: "https://example.com/advisory" }],
      severity: "high",
      summary: "Prototype pollution in lodash",
      updated_at: "2026-08-02T00:00:00Z",
      withdrawn_at: null,
    },
    security_vulnerability: {
      first_patched_version: { identifier: "4.17.21" },
      vulnerable_version_range: "< 4.17.21",
    },
    state: "open",
    updated_at: "2026-09-02T00:00:00Z",
    ...over,
  } as unknown as Parameters<typeof dependabotAlertOf>[0]["data"];
}

describe("dependabotAlertOf", () => {
  it("projects the whole alert", () => {
    const alert: DependabotAlert = dependabotAlertOf({ data: raw() });
    expect(alert).toEqual({
      advisory: {
        cveId: "CVE-2026-1234",
        cvssScore: 8.1,
        cvssVector: "CVSS:3.1/AV:N",
        cweIds: ["CWE-1321"],
        ghsaId: "GHSA-1111-2222-3333",
        publishedAt: "2026-08-01T00:00:00Z",
        referenceUrls: ["https://example.com/advisory"],
        severity: "high",
        summary: "Prototype pollution in lodash",
        updatedAt: "2026-08-02T00:00:00Z",
        withdrawnAt: undefined,
      },
      createdAt: "2026-09-01T00:00:00Z",
      dependency: {
        ecosystem: "npm",
        manifestPath: "apps/server/package.json",
        packageName: "lodash",
        relationship: "transitive",
        scope: "runtime",
      },
      dismissedAt: undefined,
      dismissedComment: undefined,
      dismissedReason: undefined,
      fixedAt: undefined,
      htmlUrl: "https://github.com/acme/widget/security/dependabot/583",
      number: 583,
      state: "open",
      updatedAt: "2026-09-02T00:00:00Z",
      vulnerableRange: { firstPatchedVersion: "4.17.21", vulnerableVersionRange: "< 4.17.21" },
    });
  });

  it("reads every null or omitted optional field as an absent one, each key still present", () => {
    const alert = dependabotAlertOf({
      data: raw({
        dependency: { manifest_path: "package.json", relationship: null },
        security_advisory: {
          cve_id: null,
          cvss: { score: 0, vector_string: null },
          cwes: [],
          ghsa_id: "GHSA-4444-5555-6666",
          published_at: "2026-08-01T00:00:00Z",
          references: [],
          severity: "low",
          summary: "No CVE yet",
          updated_at: "2026-08-02T00:00:00Z",
          withdrawn_at: "2026-08-03T00:00:00Z",
        },
      }),
    });
    expect(alert.dependency).toStrictEqual({
      ecosystem: undefined,
      manifestPath: "package.json",
      packageName: undefined,
      relationship: undefined,
      scope: undefined,
    });
    expect(Object.keys(alert.dependency)).toEqual([
      "ecosystem",
      "manifestPath",
      "packageName",
      "relationship",
      "scope",
    ]);
    expect(alert.advisory).toStrictEqual({
      cveId: undefined,
      cvssScore: 0,
      cvssVector: undefined,
      cweIds: [],
      ghsaId: "GHSA-4444-5555-6666",
      publishedAt: "2026-08-01T00:00:00Z",
      referenceUrls: [],
      severity: "low",
      summary: "No CVE yet",
      updatedAt: "2026-08-02T00:00:00Z",
      withdrawnAt: "2026-08-03T00:00:00Z",
    });
  });

  it("keeps a fixed alert's fix time", () => {
    const alert = dependabotAlertOf({ data: raw({ fixed_at: "2026-09-04T00:00:00Z", state: "fixed" }) });
    expect(alert.fixedAt).toBe("2026-09-04T00:00:00Z");
  });

  it("carries the citation GitHub gave rather than one built from the number", () => {
    const alert = dependabotAlertOf({ data: raw({ html_url: "https://github.example/x/security/dependabot/9" }) });
    expect(alert.htmlUrl).toBe("https://github.example/x/security/dependabot/9");
  });

  it("reads an advisory with no patched version yet as absent, not as zero", () => {
    const alert = dependabotAlertOf({
      data: raw({
        security_vulnerability: { first_patched_version: null, vulnerable_version_range: ">= 0" },
      }),
    });
    expect(alert.vulnerableRange.firstPatchedVersion).toBeUndefined();
    expect(alert.vulnerableRange.vulnerableVersionRange).toBe(">= 0");
  });

  it("reads a state outside GitHub's own enum as unknown rather than passing it through", () => {
    const alert = dependabotAlertOf({ data: raw({ state: "something_new" }) });
    expect(alert.state).toBeUndefined();
  });

  it("keeps a dismissal's own reason and comment", () => {
    const alert = dependabotAlertOf({
      data: raw({
        dismissed_at: "2026-09-03T00:00:00Z",
        dismissed_comment: "vendored fork is not affected",
        dismissed_reason: "tolerable_risk",
        state: "dismissed",
      }),
    });
    expect(alert.state).toBe("dismissed");
    expect(alert.dismissedReason).toBe("tolerable_risk");
    expect(alert.dismissedComment).toBe("vendored fork is not affected");
  });
});

describe("nextAfterCursor", () => {
  it("reads the after cursor out of the next link", () => {
    const link =
      '<https://api.github.com/repositories/1/dependabot/alerts?first=100&after=Y3Vyc29yOjI>; rel="next", ' +
      '<https://api.github.com/repositories/1/dependabot/alerts?first=100>; rel="first"';
    expect(nextAfterCursor({ link })).toBe("Y3Vyc29yOjI");
  });

  it("reports exhaustion when the header names no next page", () => {
    const link = '<https://api.github.com/repositories/1/dependabot/alerts?first=100>; rel="first"';
    expect(nextAfterCursor({ link })).toBeUndefined();
  });

  it("reports exhaustion on an absent header", () => {
    expect(nextAfterCursor({ link: "" })).toBeUndefined();
  });

  it("reports exhaustion when a next link carries no after parameter at all", () => {
    const link = '<https://api.github.com/repositories/1/dependabot/alerts?first=100>; rel="next"';
    expect(nextAfterCursor({ link })).toBeUndefined();
  });

  it("ignores an after parameter that belongs to a link other than next", () => {
    const link = '<https://api.github.com/x?after=WRONG>; rel="prev"';
    expect(nextAfterCursor({ link })).toBeUndefined();
  });
});
