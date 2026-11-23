/**
 * The committed surface registry, checked against the properties the generator asserts at write time.
 *
 * These duplicate `tools/generateGoogleAdminSurfaces.ts --verify` on purpose. The tool runs when somebody
 * remembers to run it; the unit lane runs on every push, and the failure this guards against is a
 * hand-edited row, which is exactly the edit nobody re-runs a generator after.
 */
import { describe, expect, it } from "vitest";

import { googleAdminDispositionFor } from "../../../../atlas/googleAdmin/dispositions.js";
import {
  GOOGLE_ADMIN_DISCOVERY_PINS,
  GOOGLE_ADMIN_DISPOSITION_CENSUS,
  GOOGLE_ADMIN_DISTINCT_METHOD_IDS,
  GOOGLE_ADMIN_EXCLUSION_CENSUS,
  GOOGLE_ADMIN_METHOD_CENSUS,
  GOOGLE_ADMIN_SCOPELESS_CENSUS,
} from "../../../../atlas/googleAdmin/generated/discoveryLock.js";
import { GOOGLE_ADMIN_RECORD_SHAPES, GOOGLE_ADMIN_SURFACES } from "../../../../atlas/googleAdmin/generated/surfaces.js";
import { googleAdminOperationName, googleAdminProviderId } from "../../../../atlas/googleAdmin/surfaceNaming.js";

describe("the committed Google Admin surface registry", () => {
  it("holds exactly the census discoveryLock pins", () => {
    expect(GOOGLE_ADMIN_SURFACES.length).toBe(GOOGLE_ADMIN_METHOD_CENSUS);
    expect(GOOGLE_ADMIN_SURFACES.length).toBe(336);
  });

  it("holds the pinned method count for every document", () => {
    const counted = GOOGLE_ADMIN_DISCOVERY_PINS.map((pin) => ({
      document: pin.document,
      methods: GOOGLE_ADMIN_SURFACES.filter((row) => row.document === pin.document).length,
    }));
    expect(counted).toStrictEqual([
      { document: "admin.datatransfer_v1", methods: 5 },
      { document: "admin.directory_v1", methods: 128 },
      { document: "admin.reports_v1", methods: 6 },
      { document: "alertcenter.v1beta1", methods: 11 },
      { document: "chromemanagement.v1", methods: 58 },
      { document: "chromepolicy.v1", methods: 14 },
      { document: "cloudidentity.v1", methods: 70 },
      { document: "groupsmigration.v1", methods: 1 },
      { document: "groupssettings.v1", methods: 3 },
      { document: "licensing.v1", methods: 7 },
      { document: "vault.v1", methods: 33 },
    ]);
  });

  it("takes exactly the pinned disposition census", () => {
    const counted = {
      entity: GOOGLE_ADMIN_SURFACES.filter((row) => row.disposition === "entity").length,
      excluded: GOOGLE_ADMIN_SURFACES.filter((row) => row.disposition === "excluded").length,
      "probe-only": GOOGLE_ADMIN_SURFACES.filter((row) => row.disposition === "probe-only").length,
      "shape-index": GOOGLE_ADMIN_SURFACES.filter((row) => row.disposition === "shape-index").length,
    };
    expect(counted).toStrictEqual({ ...GOOGLE_ADMIN_DISPOSITION_CENSUS });
    expect(counted).toStrictEqual({ entity: 128, excluded: 180, "probe-only": 0, "shape-index": 28 });
  });

  it("takes exactly the pinned exclusion census, with the two uploads and the three watches named", () => {
    const counted = {
      egressing: GOOGLE_ADMIN_SURFACES.filter((row) => row.exclusionReason === "egressing").length,
      mutating: GOOGLE_ADMIN_SURFACES.filter((row) => row.exclusionReason === "mutating").length,
      "side-effecting": GOOGLE_ADMIN_SURFACES.filter((row) => row.exclusionReason === "side-effecting").length,
    };
    expect(counted).toStrictEqual({ ...GOOGLE_ADMIN_EXCLUSION_CENSUS });
    expect(
      GOOGLE_ADMIN_SURFACES.filter((row) => row.exclusionReason === "egressing").map((row) => row.id),
    ).toStrictEqual(["chromepolicy.media.upload", "groupsmigration.archive.insert"]);
    expect(
      GOOGLE_ADMIN_SURFACES.filter((row) => row.exclusionReason === "side-effecting")
        .map((row) => row.id)
        .toSorted(),
    ).toStrictEqual(["directory.users.aliases.watch", "directory.users.watch", "reports.activities.watch"]);
  });

  it("gives every row a name no other row has", () => {
    expect(new Set(GOOGLE_ADMIN_SURFACES.map((row) => row.name)).size).toBe(GOOGLE_ADMIN_SURFACES.length);
  });

  it("needs the DOCUMENT to keep Google's own colliding method id apart", () => {
    // The measurement `surfaceNaming.ts` records: one method id, two documents, two different scope sets.
    const shared = GOOGLE_ADMIN_SURFACES.filter((row) => row.id === "admin.channels.stop");
    expect(shared.length).toBe(2);
    expect(new Set(GOOGLE_ADMIN_SURFACES.map((row) => row.id)).size).toBe(GOOGLE_ADMIN_DISTINCT_METHOD_IDS);
    expect(new Set(shared.map((row) => googleAdminProviderId(row))).size).toBe(2);
    expect(shared.map((row) => row.kind).toSorted()).toStrictEqual(["directory-channels", "reports-channels"]);
  });

  it("derives every stored name and disposition from the rules, not from the file", () => {
    for (const row of GOOGLE_ADMIN_SURFACES) {
      expect(googleAdminOperationName({ document: row.document, id: row.id })).toBe(row.name);
      expect(
        googleAdminDispositionFor({
          id: row.id,
          kind: row.kind,
          method: row.method,
          supportsMediaUpload: row.supportsMediaUpload,
        }).disposition,
      ).toBe(row.disposition);
    }
  });

  it("names an exclusion reason on every excluded row and on no other", () => {
    for (const row of GOOGLE_ADMIN_SURFACES) {
      expect(row.exclusionReason === null).toBe(row.disposition !== "excluded");
    }
  });

  it("holds exactly nineteen methods Google publishes with no scope at all", () => {
    const scopeless = GOOGLE_ADMIN_SURFACES.filter((row) => row.scopes.length === 0);
    expect(scopeless.length).toBe(GOOGLE_ADMIN_SCOPELESS_CENSUS);
    expect(scopeless.length).toBe(19);
    expect([...new Set(scopeless.map((row) => row.kind))].toSorted()).toStrictEqual([
      "chrome-management-certificate-provisioning-processes",
      "chrome-management-certificate-provisioning-processes-operations",
      "chrome-management-connector-configs",
      "chrome-management-operations",
      "cloud-identity-userinvitations",
    ]);
  });

  it("classifies the three non-GET reads as reads, and every other non-GET as a write", () => {
    const nonGetReads = GOOGLE_ADMIN_SURFACES.filter((row) => row.method !== "GET" && row.disposition !== "excluded");
    expect(nonGetReads.map((row) => row.id).toSorted()).toStrictEqual([
      "chromepolicy.customers.policies.groups.listGroupPriorityOrdering",
      "chromepolicy.customers.policies.resolve",
      "vault.matters.count",
    ]);
  });

  it("holds one record shape for all but four of the kinds the registry names", () => {
    const registryKinds = [...new Set(GOOGLE_ADMIN_SURFACES.map((row) => row.kind))];
    const withShape = new Set(GOOGLE_ADMIN_RECORD_SHAPES.map((shape) => shape.kind));
    expect(GOOGLE_ADMIN_RECORD_SHAPES.length).toBe(78);
    expect(registryKinds.filter((kind) => !withShape.has(kind)).toSorted()).toStrictEqual([
      "chrome-policy-policies-orgunits",
      "directory-channels",
      "directory-two-step-verification",
      "reports-channels",
    ]);
  });

  it("unwraps a list envelope to the record inside it, so a user's shape is a User", () => {
    const user = GOOGLE_ADMIN_RECORD_SHAPES.find((shape) => shape.kind === "directory-users")!;
    expect(user.schemaName).toBe("User");
    expect(user.sourceOperation).toBe("admin-directory-v1-directory-users-list");
    expect(user.fields).toContain("isAdmin");
    expect(user.fields).toContain("orgUnitPath");
    expect(user.fields).toContain("suspended");
  });

  it("takes the audit activity's shape from the list read, so a shape-indexed kind still says what a record is", () => {
    const activity = GOOGLE_ADMIN_RECORD_SHAPES.find((shape) => shape.kind === "reports-activities")!;
    expect(activity.schemaName).toBe("Activity");
    expect(activity.fields).toContain("actor");
    expect(activity.fields).toContain("ipAddress");
  });
});
