/**
 * Unit: which published methods a grant may call, derived from the committed registry.
 *
 * Every assertion here is re-derived from `generated/surfaces.ts` rather than restating a number, because
 * the plan's whole job is to stay true across a regeneration. The one exception is the count itself, which
 * is pinned deliberately — a regeneration that moved it is a change to what this atlas can reach, and that
 * is a thing to READ rather than a thing to let pass.
 */
import { describe, expect, it } from "vitest";

import {
  GOOGLE_ADMIN_PATH_SUBSTITUTIONS,
  googleAdminCollectionField,
  googleAdminFillPlan,
  googleAdminPathPlaceholders,
  googleAdminResolvePath,
} from "../../../../../atlas/googleAdmin/adminApi/plan.js";
import { GOOGLE_ADMIN_SURFACES } from "../../../../../atlas/googleAdmin/generated/surfaces.js";
import { GOOGLE_ADMIN_CAPABILITIES, GOOGLE_ADMIN_SCOPES } from "../../../../../live/googleAdmin/scopes.js";

/** The whole readonly grant, which is what `connect --grant all` produces. */
const WHOLE_GRANT = GOOGLE_ADMIN_CAPABILITIES.map((capability) => GOOGLE_ADMIN_SCOPES[capability]);

describe("googleAdminPathPlaceholders", () => {
  it("names every placeholder in order", () => {
    expect(googleAdminPathPlaceholders({ path: "admin/directory/v1/customer/{customerId}/orgunits" })).toStrictEqual([
      "customerId",
    ]);
  });

  it("is empty for a path that templates nothing", () => {
    expect(googleAdminPathPlaceholders({ path: "admin/directory/v1/users" })).toStrictEqual([]);
  });
});

describe("googleAdminResolvePath", () => {
  it("substitutes the customer alias Google publishes for it", () => {
    expect(googleAdminResolvePath({ path: "admin/directory/v1/customer/{customerId}/orgunits" })).toStrictEqual({
      path: "admin/directory/v1/customer/my_customer/orgunits",
    });
  });

  it("substitutes the Chrome APIs' own spelling of the same idea", () => {
    expect(googleAdminResolvePath({ path: "v1/customers/{customersId}/profiles" })).toStrictEqual({
      path: "v1/customers/my_customer/profiles",
    });
  });

  it("names the placeholder it cannot fill rather than guessing one", () => {
    expect(googleAdminResolvePath({ path: "admin/directory/v1/users/{userKey}/tokens" })).toStrictEqual({
      blockedBy: "userKey",
    });
  });

  it("blocks on the FIRST unfillable placeholder when a path names two", () => {
    expect(googleAdminResolvePath({ path: "v1/matters/{matterId}/holds/{holdId}" })).toStrictEqual({
      blockedBy: "matterId",
    });
  });

  it("covers exactly three placeholder names, which are one idea spelled three ways", () => {
    expect(Object.keys(GOOGLE_ADMIN_PATH_SUBSTITUTIONS).toSorted()).toStrictEqual([
      "customer",
      "customerId",
      "customersId",
    ]);
  });
});

describe("googleAdminCollectionField", () => {
  it("subtracts the envelope and leaves the payload", () => {
    const row = GOOGLE_ADMIN_SURFACES.find((candidate) => candidate.id === "directory.users.list")!;
    expect(googleAdminCollectionField({ row })).toBe("users");
  });

  it("drops trigger_event, which is the one row that would otherwise leave two candidates", () => {
    const row = GOOGLE_ADMIN_SURFACES.find((candidate) => candidate.id === "directory.users.list")!;
    expect(row.responseFields).toContain("trigger_event");
    expect(googleAdminCollectionField({ row })).toBe("users");
  });

  it("finds the payload under a name that is not the resource's", () => {
    const row = GOOGLE_ADMIN_SURFACES.find((candidate) => candidate.id === "directory.roles.list")!;
    expect(googleAdminCollectionField({ row })).toBe("items");
  });
});

describe("googleAdminFillPlan on the whole readonly grant", () => {
  const plan = googleAdminFillPlan({ granted: WHOLE_GRANT });

  it("plans 35 calls, which is what this grant reaches on the pinned registry", () => {
    expect(plan.calls).toHaveLength(35);
  });

  it("leaves EVERY planned call with exactly one payload field — the assertion the derivation rests on", () => {
    const ambiguous = plan.calls.filter((call) => call.collectionField.length === 0);
    expect(ambiguous).toStrictEqual([]);
    expect(new Set(plan.calls.map((call) => call.collectionField)).size).toBeGreaterThan(0);
  });

  it("plans nothing that is not a read the atlas already judged safe", () => {
    const byId = new Map(GOOGLE_ADMIN_SURFACES.map((row) => [`${row.document}:${row.id}`, row]));
    const wrong = plan.calls.filter((call) => {
      const row = byId.get(`${call.document}:${call.id}`)!;
      return row.disposition !== "entity" || row.method !== "GET";
    });
    expect(wrong).toStrictEqual([]);
  });

  it("resolves every planned path, so no caller has to template one", () => {
    expect(plan.calls.filter((call) => call.path.includes("{"))).toStrictEqual([]);
  });

  it("authorises every planned call with a scope the grant actually carries", () => {
    expect(plan.calls.filter((call) => !WHOLE_GRANT.includes(call.scope))).toStrictEqual([]);
  });

  it("reports 90 readable operations it did not call, each with its own reason", () => {
    expect(plan.excluded).toHaveLength(90);
  });

  it("reaches 34 of the atlas's kinds", () => {
    expect(new Set(plan.calls.map((call) => call.kind)).size).toBe(34);
  });

  it("carries the measured query parameters on the operations whose 400s put them there", () => {
    const byId = new Map(plan.calls.map((call) => [call.id, call.query]));
    expect(byId.get("directory.users.list")).toStrictEqual({ customer: "my_customer" });
    expect(byId.get("directory.groups.list")).toStrictEqual({ customer: "my_customer" });
    expect(byId.get("chromemanagement.customers.telemetry.devices.list")).toStrictEqual({
      readMask: "name,deviceId,orgUnitId,serialNumber",
    });
    expect(byId.get("chromemanagement.customers.telemetry.notificationConfigs.list")).toStrictEqual({
      pageSize: "100",
    });
  });

  it("sends no query parameter on an operation that never needed one", () => {
    expect(plan.calls.find((call) => call.id === "directory.orgunits.list")!.query).toStrictEqual({});
  });

  it("excludes an operation needing an identifier only a record carries, naming that parameter", () => {
    const bound = plan.excluded.filter((entry) => entry.exclusion === "parameter-needs-a-record");
    expect(bound.map((entry) => entry.id).toSorted()).toStrictEqual([
      "chromemanagement.customers.apps.fetchDevicesRequestingExtension",
      "chromemanagement.customers.apps.fetchUsersRequestingExtension",
      "cloudidentity.groups.list",
      "cloudidentity.groups.lookup",
      "cloudidentity.groups.search",
    ]);
    expect(bound.find((entry) => entry.id === "cloudidentity.groups.lookup")!.detail).toContain("groupKey.id");
  });

  it("excludes the per-record reads by naming the placeholder that blocked each", () => {
    const blocked = plan.excluded.filter((entry) => entry.exclusion === "path-needs-a-record");
    expect(blocked).toHaveLength(81);
    expect(blocked.filter((entry) => !entry.detail.includes("names a record this atlas has not read"))).toStrictEqual(
      [],
    );
  });

  it("excludes what Google publishes with no scope at all, separately from what the grant misses", () => {
    const undeclared = plan.excluded.filter((entry) => entry.exclusion === "no-declared-scope");
    expect(undeclared.map((entry) => entry.id).toSorted()).toStrictEqual([
      "chromemanagement.customers.connectorConfigs.list",
      "chromemanagement.operations.list",
      "cloudidentity.customers.userinvitations.list",
    ]);
  });

  it("sorts both halves by method id, so two runs report identically", () => {
    const byId = (left: string, right: string): number => left.localeCompare(right);
    expect(plan.calls.map((call) => call.id)).toStrictEqual(plan.calls.map((call) => call.id).toSorted(byId));
    expect(plan.excluded.map((entry) => entry.id)).toStrictEqual(plan.excluded.map((entry) => entry.id).toSorted(byId));
  });
});

describe("googleAdminFillPlan on a narrower grant", () => {
  it("fills what one capability reaches and reports the rest as not granted", () => {
    const plan = googleAdminFillPlan({
      granted: [GOOGLE_ADMIN_SCOPES["directory-users"]],
    });
    expect(plan.calls.map((call) => call.id)).toStrictEqual(["directory.users.list"]);
    expect(plan.excluded.filter((entry) => entry.exclusion === "scope-not-granted").length).toBeGreaterThan(0);
  });

  it("plans nothing at all on an empty grant, and calls that a scope problem rather than a path one", () => {
    const plan = googleAdminFillPlan({ granted: [] });
    expect(plan.calls).toStrictEqual([]);
    const ungranted = plan.excluded.filter((entry) => entry.exclusion === "scope-not-granted");
    // 36 rather than the 44 whose paths resolve: three are what Google publishes with an empty
    // scopes array, and five need an identifier only a record carries. Both are reported as themselves.
    expect(ungranted).toHaveLength(36);
  });

  it("names the scopes an ungranted call wanted, so a reader can widen the grant", () => {
    const plan = googleAdminFillPlan({ granted: [] });
    const users = plan.excluded.find((entry) => entry.id === "directory.users.list")!;
    expect(users.detail).toContain("https://www.googleapis.com/auth/admin.directory.user.readonly");
  });
});
