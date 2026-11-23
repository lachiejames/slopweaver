import { describe, expect, it } from "vitest";

import type { GcpPermissionUse } from "../../../gcpAudit/aggregate.js";
import { assessPlan, parsePlan } from "../../../gcpAudit/assess.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const use = (over: Partial<GcpPermissionUse> = {}): GcpPermissionUse => ({
  count: 3,
  firstSeen: "2026-01-01T00:00:00Z",
  granted: true,
  lastSeen: "2026-02-01T00:00:00Z",
  methods: ["M"],
  origin: "projects/platform-secrets",
  permission: "secretmanager.versions.access",
  principal: "a@x.com",
  ...over,
});

const ROLES = [{ name: "roles/viewer", permissions: ["resourcemanager.projects.get", "storage.buckets.list"] }];

const plan = ({
  denied = [],
  basis = "effective",
}: { denied?: string[]; basis?: "effective" | "direct-bindings" } = {}) =>
  unwrap(
    parsePlan({
      value: {
        principals: [
          {
            principal: "a@x.com",
            scopes: [
              {
                basis,
                deniedPermissions: denied,
                keptRoles: ["roles/viewer"],
                remainingPermissions: ["clientauthconfig.clients.create"],
                resource: "organizations/1",
              },
            ],
          },
        ],
        schemaVersion: 1,
      },
    }),
  );

describe("parsePlan", () => {
  it("refuses a folder scope, whose grants belong in each project beneath it", () => {
    const refused = unwrapErr(
      parsePlan({
        value: {
          principals: [
            {
              principal: "a@x.com",
              scopes: [
                {
                  basis: "effective",
                  deniedPermissions: [],
                  keptRoles: [],
                  remainingPermissions: [],
                  resource: "folders/1",
                },
              ],
            },
          ],
          schemaVersion: 1,
        },
      }),
    );
    expect(refused.code).toBe("PLAN_INVALID");
    expect(refused.message).toContain("a scope is an organisation or a project");
  });
});

describe("assessPlan", () => {
  it("keeps a use a kept role or a loose permission still allows", () => {
    const assessed = assessPlan({
      org: "1",
      plan: plan(),
      roles: ROLES,
      uses: [use({ permission: "storage.buckets.list" }), use({ permission: "clientauthconfig.clients.create" })],
    });
    expect(assessed).toEqual({ kept: 2, unassessable: [], wouldBreak: [] });
  });

  it("names a use absent from an effective remaining set as a definite break", () => {
    const assessed = assessPlan({ org: "1", plan: plan(), roles: ROLES, uses: [use()] });
    expect(assessed.wouldBreak).toEqual([{ certainty: "definite", reason: "absent-from-remaining-set", use: use() }]);
  });

  it("qualifies a break read against direct bindings only, which a group grant may still cover", () => {
    const assessed = assessPlan({ org: "1", plan: plan({ basis: "direct-bindings" }), roles: ROLES, uses: [use()] });
    expect(assessed.wouldBreak).toEqual([
      { certainty: "unless-another-grant-covers-it", reason: "absent-from-remaining-set", use: use() },
    ]);
  });

  it("names a deny as definite even over direct bindings and a kept role granting it", () => {
    const denied = use({ permission: "storage.buckets.list" });
    const assessed = assessPlan({
      org: "1",
      plan: plan({ basis: "direct-bindings", denied: ["storage.buckets.list"] }),
      roles: ROLES,
      uses: [denied],
    });
    expect(assessed.wouldBreak).toEqual([{ certainty: "definite", reason: "explicitly-denied", use: denied }]);
  });

  it("never assesses a refused use, which does not prove the permission was there", () => {
    expect(assessPlan({ org: "1", plan: plan(), roles: ROLES, uses: [use({ granted: false })] })).toEqual({
      kept: 0,
      unassessable: [],
      wouldBreak: [],
    });
  });

  it("calls a use unassessable when a kept role is missing from the cache", () => {
    const assessed = assessPlan({ org: "1", plan: plan(), roles: [], uses: [use()] });
    expect(assessed.unassessable.map((item) => item.why)).toEqual([
      "role roles/viewer is not in this generation's cache — pull again with --role roles/viewer",
    ]);
  });

  it("names a deny as definite even when a kept role is missing from the cache", () => {
    const assessed = assessPlan({
      org: "1",
      plan: plan({ denied: ["secretmanager.versions.access"] }),
      roles: [],
      uses: [use()],
    });
    expect(assessed).toEqual({
      kept: 0,
      unassessable: [],
      wouldBreak: [{ certainty: "definite", reason: "explicitly-denied", use: use() }],
    });
  });

  it("keeps a loose permission even when a kept role is missing from the cache", () => {
    const loose = use({ permission: "clientauthconfig.clients.create" });
    expect(assessPlan({ org: "1", plan: plan(), roles: [], uses: [loose] })).toEqual({
      kept: 1,
      unassessable: [],
      wouldBreak: [],
    });
  });

  it("calls a principal with no plan row unassessable, never a finding", () => {
    const assessed = assessPlan({ org: "1", plan: plan(), roles: ROLES, uses: [use({ principal: "b@x.com" })] });
    expect(assessed.unassessable.map((item) => item.why)).toEqual(["the plan has no row for this principal"]);
  });
});
