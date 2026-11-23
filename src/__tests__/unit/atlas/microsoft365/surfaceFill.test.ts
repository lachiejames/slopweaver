/**
 * Whether the Microsoft 365 compiled surface is FILLED is read off the manifest, never off a literal.
 *
 * The invariant asserted is exact: EVERY applicable kind carries a recorded success — not "most", not "at
 * least one" — and `page`, which no compile ever writes, is outside the denominator.
 */
import { describe, expect, it } from "vitest";

import type { AtlasDescriptor } from "../../../../atlas/kit/contract.js";
import { MICROSOFT365_ATLAS_DESCRIPTOR } from "../../../../atlas/microsoft365/descriptor.js";
import {
  initialMicrosoft365Manifest,
  MICROSOFT365_KINDS,
  type Microsoft365AtlasManifest,
  type Microsoft365Kind,
} from "../../../../atlas/microsoft365/model.js";
import {
  applicableCompiledKinds,
  microsoft365CompiledFill,
  microsoft365DescriptorFor,
} from "../../../../atlas/microsoft365/surfaceFill.js";

const AT = "2026-10-01T00:00:00.000Z";

const SOURCE = MICROSOFT365_ATLAS_DESCRIPTOR;

/** The 70 applicable kinds, sorted, written out from `MICROSOFT365_KINDS` minus `page`. */
const APPLICABLE_SORTED = [
  "admin",
  "agreementAcceptances",
  "agreements",
  "appCatalogs",
  "applicationTemplates",
  "applications",
  "auditLogs",
  "authenticationMethodConfigurations",
  "authenticationMethodsPolicy",
  "certificateBasedAuthConfiguration",
  "chats",
  "communications",
  "compliance",
  "connections",
  "contacts",
  "contracts",
  "copilot",
  "dataPolicyOperations",
  "deviceAppManagement",
  "deviceManagement",
  "devices",
  "directory",
  "directoryObjects",
  "directoryRoleTemplates",
  "directoryRoles",
  "domainDnsRecords",
  "domains",
  "drives",
  "education",
  "employeeExperience",
  "external",
  "filterOperators",
  "functions",
  "groupLifecyclePolicies",
  "groupSettingTemplates",
  "groupSettings",
  "groups",
  "identity",
  "identityGovernance",
  "identityProtection",
  "identityProviders",
  "informationProtection",
  "invitations",
  "me",
  "oauth2PermissionGrants",
  "organization",
  "permissionGrants",
  "places",
  "planner",
  "policies",
  "print",
  "privacy",
  "reports",
  "roleManagement",
  "schemaExtensions",
  "scopedRoleMemberships",
  "search",
  "security",
  "servicePrincipals",
  "shares",
  "sites",
  "solutions",
  "storage",
  "subscribedSkus",
  "subscriptions",
  "teams",
  "teamsTemplates",
  "teamwork",
  "tenantRelationships",
  "users",
] as const;

/**
 * A manifest where every kind has a recorded success, each with its own distinct timestamp, digest and
 * entity count, except the named outstanding kinds and `page` (unless `pageSucceeded`).
 */
function manifestWith({
  outstanding,
  pageSucceeded,
}: {
  outstanding: readonly Microsoft365Kind[];
  pageSucceeded: boolean;
}): Microsoft365AtlasManifest {
  const base = initialMicrosoft365Manifest({ updatedAt: AT });
  const kinds = { ...base.kinds };
  for (const [index, kind] of MICROSOFT365_KINDS.entries()) {
    const skipped = kind === "page" ? !pageSucceeded : outstanding.includes(kind);
    if (!skipped) {
      const minutes = String(index % 60).padStart(2, "0");
      kinds[kind] = {
        digest: `digest-${String(index)}`,
        entityCount: 100 + index,
        lastAttempt: null,
        lastSuccessAt: `2026-09-01T0${String(Math.floor(index / 60))}:${minutes}:00.000Z`,
      };
    }
  }
  return { ...base, kinds };
}

/** The source descriptor with only its compiled surface's status and reason replaced. */
function expectedDescriptor({
  status,
  unfilledBecause,
}: {
  status: "filled" | "declared-unfilled";
  unfilledBecause: string | null;
}): AtlasDescriptor {
  return {
    ...SOURCE,
    surfaces: [{ ...SOURCE.surfaces[0]!, status, unfilledBecause }, SOURCE.surfaces[1]!, SOURCE.surfaces[2]!],
  };
}

describe("applicableCompiledKinds", () => {
  it("is the 70 declared kinds but the browser-only page kind", () => {
    expect(MICROSOFT365_KINDS.length).toBe(71);
    expect(applicableCompiledKinds()).toEqual(APPLICABLE_SORTED);
  });
});

describe("microsoft365CompiledFill", () => {
  it("reports nothing filled when nothing has ever been published", () => {
    expect(microsoft365CompiledFill({ manifest: null })).toEqual({
      applicable: 70,
      filled: false,
      outstanding: APPLICABLE_SORTED,
      succeeded: 0,
    });
  });

  it("refuses to call the surface filled when ONE applicable kind is outstanding", () => {
    const manifest = manifestWith({ outstanding: ["users"], pageSucceeded: false });
    expect(microsoft365CompiledFill({ manifest })).toEqual({
      applicable: 70,
      filled: false,
      outstanding: ["users"],
      succeeded: 69,
    });
  });

  it.each(APPLICABLE_SORTED)("reports %s as the only outstanding kind when it alone has no success", (kind) => {
    const manifest = manifestWith({ outstanding: [kind], pageSucceeded: false });
    expect(microsoft365CompiledFill({ manifest })).toEqual({
      applicable: 70,
      filled: false,
      outstanding: [kind],
      succeeded: 69,
    });
  });

  it("sorts the outstanding kinds however they were left outstanding", () => {
    const manifest = manifestWith({ outstanding: ["users", "admin", "me"], pageSucceeded: false });
    expect(microsoft365CompiledFill({ manifest })).toEqual({
      applicable: 70,
      filled: false,
      outstanding: ["admin", "me", "users"],
      succeeded: 67,
    });
  });

  it("calls the surface filled once every applicable kind has a success, with page still unsuccessful", () => {
    const manifest = manifestWith({ outstanding: [], pageSucceeded: false });
    expect(manifest.kinds.page.lastSuccessAt).toBeNull();
    expect(microsoft365CompiledFill({ manifest })).toEqual({
      applicable: 70,
      filled: true,
      outstanding: [],
      succeeded: 70,
    });
  });

  it("does not count a success on the page kind towards the compiled surface", () => {
    const manifest = manifestWith({ outstanding: APPLICABLE_SORTED, pageSucceeded: true });
    expect(microsoft365CompiledFill({ manifest })).toEqual({
      applicable: 70,
      filled: false,
      outstanding: APPLICABLE_SORTED,
      succeeded: 0,
    });
  });
});

describe("microsoft365DescriptorFor", () => {
  it("declares the three surfaces in the order these tests index them", () => {
    expect(SOURCE.surfaces.map((surface) => surface.acquisition)).toEqual(["compiled", "api", "driven-browser"]);
  });

  it("derives declared-unfilled with the first eight outstanding names and an ellipsis when nothing is published", () => {
    expect(microsoft365DescriptorFor({ manifest: null })).toEqual(
      expectedDescriptor({
        status: "declared-unfilled",
        unfilledBecause:
          "0 of 70 applicable kinds carry a recorded success; still outstanding: admin, agreementAcceptances, " +
          "agreements, appCatalogs, applicationTemplates, applications, auditLogs, " +
          "authenticationMethodConfigurations, …. Run: slopweaver atlas microsoft365 sync",
      }),
    );
  });

  it("names the one outstanding kind with no ellipsis", () => {
    const manifest = manifestWith({ outstanding: ["users"], pageSucceeded: false });
    expect(microsoft365DescriptorFor({ manifest })).toEqual(
      expectedDescriptor({
        status: "declared-unfilled",
        unfilledBecause:
          "69 of 70 applicable kinds carry a recorded success; still outstanding: users. " +
          "Run: slopweaver atlas microsoft365 sync",
      }),
    );
  });

  it("shows exactly eight outstanding names without an ellipsis", () => {
    const manifest = manifestWith({
      outstanding: [
        "admin",
        "agreementAcceptances",
        "agreements",
        "appCatalogs",
        "applicationTemplates",
        "applications",
        "auditLogs",
        "authenticationMethodConfigurations",
      ],
      pageSucceeded: false,
    });
    expect(microsoft365DescriptorFor({ manifest })).toEqual(
      expectedDescriptor({
        status: "declared-unfilled",
        unfilledBecause:
          "62 of 70 applicable kinds carry a recorded success; still outstanding: admin, agreementAcceptances, " +
          "agreements, appCatalogs, applicationTemplates, applications, auditLogs, " +
          "authenticationMethodConfigurations. Run: slopweaver atlas microsoft365 sync",
      }),
    );
  });

  it("elides the ninth outstanding name behind an ellipsis", () => {
    const manifest = manifestWith({
      outstanding: [
        "admin",
        "agreementAcceptances",
        "agreements",
        "appCatalogs",
        "applicationTemplates",
        "applications",
        "auditLogs",
        "authenticationMethodConfigurations",
        "authenticationMethodsPolicy",
      ],
      pageSucceeded: false,
    });
    expect(microsoft365DescriptorFor({ manifest })).toEqual(
      expectedDescriptor({
        status: "declared-unfilled",
        unfilledBecause:
          "61 of 70 applicable kinds carry a recorded success; still outstanding: admin, agreementAcceptances, " +
          "agreements, appCatalogs, applicationTemplates, applications, auditLogs, " +
          "authenticationMethodConfigurations, …. Run: slopweaver atlas microsoft365 sync",
      }),
    );
  });

  it("flips the compiled surface to filled with no reason once every applicable kind succeeded", () => {
    const manifest = manifestWith({ outstanding: [], pageSucceeded: false });
    expect(microsoft365DescriptorFor({ manifest })).toEqual(
      expectedDescriptor({ status: "filled", unfilledBecause: null }),
    );
  });
});
