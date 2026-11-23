/**
 * Unit: each list's page reader keeps only its allowlisted fields, refuses a shape it was not built for,
 * and never carries a feed's settings value — only the NAME of the settings key present.
 */
import { describe, expect, it } from "vitest";

import {
  FEED_SETTINGS_JSON_FIELDS,
  FEED_SETTINGS_PROTO_FIELDS,
  protoJsonName,
} from "../../../../atlas/googleSecops/fill/feedSettingsFields.js";
import {
  projectDataTablesPage,
  projectFeaturedDashboardsPage,
  projectFeedsPage,
  projectFindingsRefinementDeploymentsPage,
  projectFindingsRefinementsPage,
  projectNativeDashboardsPage,
} from "../../../../atlas/googleSecops/fill/project.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const INSTANCE = "projects/p/locations/australia-southeast1/instances/i";
const FAKE_SECRET = "fixture-secret-access-key-not-real";

describe("protoJsonName", () => {
  it("camel-cases a snake_case field, a digit run included", () => {
    expect(protoJsonName({ field: "amazon_s3_v2_settings" })).toBe("amazonS3V2Settings");
    expect(protoJsonName({ field: "office365_settings" })).toBe("office365Settings");
  });

  it("derives one JSON name per pinned settings field", () => {
    expect(FEED_SETTINGS_PROTO_FIELDS.length).toBe(76);
    expect(new Set(FEED_SETTINGS_JSON_FIELDS).size).toBe(76);
  });
});

describe("projectFeedsPage", () => {
  const body = {
    feeds: [
      {
        details: {
          amazonS3V2Settings: { authentication: { secretAccessKey: FAKE_SECRET }, s3Uri: "s3://bucket/x" },
          feedSourceType: "AMAZON_S3_V2",
          logType: "projects/p/locations/l/instances/i/logTypes/AWS_CLOUDTRAIL",
        },
        displayName: "CloudTrail",
        failureDetails: { errorCode: "AUTH_FAILED" },
        name: `${INSTANCE}/feeds/f1`,
        state: "FAILED",
      },
      { name: `${INSTANCE}/feeds/f2` },
    ],
    nextPageToken: "",
  };

  it("keeps the settings key's NAME and never its value", () => {
    const page = unwrap(projectFeedsPage({ body }));
    expect(page.items[0]).toStrictEqual({
      detail: {
        displayName: "CloudTrail",
        errorCode: "AUTH_FAILED",
        family: "feed",
        feedSourceType: "AMAZON_S3_V2",
        logType: "projects/p/locations/l/instances/i/logTypes/AWS_CLOUDTRAIL",
        settingsField: "amazonS3V2Settings",
        state: "FAILED",
      },
      providerId: `${INSTANCE}/feeds/f1`,
    });
    expect(JSON.stringify(body)).toContain(FAKE_SECRET);
    expect(JSON.stringify(page)).not.toContain(FAKE_SECRET);
    expect(JSON.stringify(page)).not.toContain("s3://bucket");
  });

  it("reads a feed with every optional field omitted as nulls, and an empty token as the last page", () => {
    const page = unwrap(projectFeedsPage({ body }));
    expect(page.items[1]!.detail).toStrictEqual({
      displayName: null,
      errorCode: null,
      family: "feed",
      feedSourceType: null,
      logType: null,
      settingsField: null,
      state: null,
    });
    expect(page.nextPageToken).toBe(null);
  });

  it("refuses a feed field it was not built for, naming it", () => {
    const error = unwrapErr(projectFeedsPage({ body: { feeds: [{ name: "x", surprise: true }] } }));
    expect(error.code).toBe("BOUNDARY_SHAPE_CHANGED");
    expect(error.message).toContain("surprise");
  });

  it("refuses a settings key Google added after the pin", () => {
    const error = unwrapErr(projectFeedsPage({ body: { feeds: [{ details: { brandNewSettings: {} }, name: "x" }] } }));
    expect(error.message).toContain("brandNewSettings");
  });
});

describe("projectDataTablesPage", () => {
  it("keeps column names, size and rule count, and passes a next page on", () => {
    const page = unwrap(
      projectDataTablesPage({
        body: {
          dataTables: [
            {
              approximateRowCount: "42",
              columnInfo: [{ originalColumn: "ip" }, { originalColumn: "owner" }],
              displayName: "allowlist",
              name: `${INSTANCE}/dataTables/allowlist`,
              ruleAssociationsCount: 3,
            },
          ],
          nextPageToken: "next",
        },
      }),
    );
    expect(page.items[0]!.detail).toStrictEqual({
      approximateRowCount: "42",
      columns: ["ip", "owner"],
      description: null,
      displayName: "allowlist",
      family: "data-table",
      ruleAssociations: 3,
      updateTime: null,
    });
    expect(page.nextPageToken).toBe("next");
  });

  it("reads an empty instance — every field omitted — as no items and the last page", () => {
    expect(unwrap(projectDataTablesPage({ body: {} }))).toStrictEqual({ items: [], nextPageToken: null });
  });

  it("refuses a body that is not an object", () => {
    expect(unwrapErr(projectDataTablesPage({ body: [] })).code).toBe("BOUNDARY_SHAPE_CHANGED");
  });
});

describe("projectNativeDashboardsPage", () => {
  it("keeps name, type and access, never the definition", () => {
    const page = unwrap(
      projectNativeDashboardsPage({
        body: {
          nativeDashboards: [
            {
              access: "DASHBOARD_PRIVATE",
              definition: { charts: [{ query: 'metadata.event_type = "USER_LOGIN"' }] },
              displayName: "Logins",
              name: `${INSTANCE}/nativeDashboards/d1`,
              type: "CUSTOM",
            },
          ],
        },
      }),
    );
    expect(page.items[0]!.detail).toStrictEqual({
      access: "DASHBOARD_PRIVATE",
      description: null,
      displayName: "Logins",
      family: "native-dashboard",
      type: "CUSTOM",
      updateTime: null,
    });
    expect(JSON.stringify(page)).not.toContain("USER_LOGIN");
  });
});

describe("projectFeaturedDashboardsPage", () => {
  it("keeps the content hub's metadata, never the dashboard content", () => {
    const page = unwrap(
      projectFeaturedDashboardsPage({
        body: {
          featuredContentNativeDashboards: [
            {
              contentMetadata: { categories: ["Cloud"], certified: true, displayName: "AWS", version: "2" },
              dashboardContent: { nativeDashboard: { displayName: "inner" } },
              name: `${INSTANCE}/contentHub/featuredContentNativeDashboards/aws`,
            },
            { name: `${INSTANCE}/contentHub/featuredContentNativeDashboards/bare` },
          ],
        },
      }),
    );
    expect(page.items.map((item) => item.detail)).toStrictEqual([
      {
        author: null,
        categories: ["Cloud"],
        certified: true,
        displayName: "AWS",
        family: "featured-dashboard",
        sourceType: null,
        version: "2",
      },
      {
        author: null,
        categories: [],
        certified: false,
        displayName: null,
        family: "featured-dashboard",
        sourceType: null,
        version: null,
      },
    ]);
    expect(JSON.stringify(page)).not.toContain("inner");
  });
});

describe("projectFindingsRefinementsPage", () => {
  it("keeps name and type, never the query", () => {
    const page = unwrap(
      projectFindingsRefinementsPage({
        body: {
          findingsRefinements: [
            {
              displayName: "Exclude scanner",
              name: `${INSTANCE}/findingsRefinements/r1`,
              query: 'principal.ip = "10.0.0.9"',
              type: "DETECTION_EXCLUSION",
            },
          ],
        },
      }),
    );
    expect(page.items[0]!.detail).toStrictEqual({
      displayName: "Exclude scanner",
      family: "findings-refinement",
      type: "DETECTION_EXCLUSION",
      updateTime: null,
    });
    expect(JSON.stringify(page)).not.toContain("10.0.0.9");
  });
});

describe("projectFindingsRefinementDeploymentsPage", () => {
  it("counts what a deployment applies to rather than naming it", () => {
    const page = unwrap(
      projectFindingsRefinementDeploymentsPage({
        body: {
          allFindingsRefinementDeployments: [
            {
              detectionExclusionApplication: { curatedRules: ["a", "b"], rules: ["c"] },
              enabled: true,
              name: `${INSTANCE}/findingsRefinements/r1/deployment`,
            },
          ],
        },
      }),
    );
    expect(page.items[0]!.detail).toStrictEqual({
      appliesTo: { curatedRuleSets: 0, curatedRules: 2, deletedCuratedRuleSets: 0, rules: 1 },
      archived: false,
      enabled: true,
      family: "findings-refinement-deployment",
      updateTime: null,
    });
  });
});
