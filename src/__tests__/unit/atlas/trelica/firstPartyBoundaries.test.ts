import { describe, expect, it } from "vitest";

import { TRELICA_FIRST_PARTY_READS } from "../../../../atlas/trelica/firstPartyBoundaries.js";
import { TRELICA_CALLS, trelicaCalls } from "../../../../atlas/trelica/inventory.js";
import { unwrap } from "../../../../lib/result.js";

/** The boundary one call is admitted by. */
function boundaryFor({ callId }: { callId: string }): (typeof TRELICA_FIRST_PARTY_READS)[number]["boundary"] {
  return TRELICA_FIRST_PARTY_READS.find((read) => read.call.id === callId)!.boundary;
}

/** One owner, as the inventory and the catalogue both answer it. */
const CONTACT = {
  accessLevel: "Full",
  contact: { email: "owner@example.test", id: "p-1", name: "An Owner", personType: "User" },
  contractAccessLevel: "None",
  isOwner: true,
  roleId: "Owner",
  spendAccessLevel: "None",
  terminated: false,
};

/** One inventory record carrying every key a projection reads and three it never holds. */
const INVENTORY_RECORD = {
  app: { description: "a whole provider document" },
  appDiscoveredBy: "IdentityProvider",
  auditLogSas: "sv=2026&sig=a-signature",
  customerLicensePlans: [{ id: "plan-1", name: { "en-US": "Business" }, pricingModel: "PerUser" }],
  displayName: "Example App",
  id: "row-1",
  internalContacts: [CONTACT],
  lastYearSpend: 1200,
  name: "Example App",
  riskScore: 3,
  status: "Managed",
  userCount: 12,
  vendorName: "Example Vendor",
};

/** One page of the inventory. */
function inventoryPage({ record }: { record: Record<string, unknown> }): unknown {
  return { items: [record], resultsTruncated: false, total: 1 };
}

describe("TRELICA_FIRST_PARTY_READS", () => {
  it("pairs every call the inventory admits with a boundary, once each", () => {
    expect(trelicaCalls().length).toBeGreaterThan(0);
    expect(TRELICA_FIRST_PARTY_READS.map((read) => read.call.id).toSorted()).toEqual(
      trelicaCalls()
        .map((call) => call.id)
        .toSorted(),
    );
  });

  it("admits a measured inventory record and keeps nothing under a key it never reads", () => {
    const boundary = boundaryFor({ callId: TRELICA_CALLS.appInventory.id });
    const admitted = unwrap(boundary.parse({ value: inventoryPage({ record: INVENTORY_RECORD }) }));
    const view = boundary.censusView({ value: admitted });
    expect(view).toEqual({
      items: [
        {
          ...INVENTORY_RECORD,
          app: null,
          auditLogSas: null,
          customerLicensePlans: [{ id: null, name: { "en-US": "Business" }, pricingModel: null }],
          internalContacts: [
            {
              ...CONTACT,
              accessLevel: null,
              contact: { email: "owner@example.test", id: null, name: "An Owner", personType: null },
              contractAccessLevel: null,
              spendAccessLevel: null,
            },
          ],
        },
      ],
      resultsTruncated: false,
      total: 1,
    });
  });

  it("refuses an inventory record whose plan name stopped being localised", () => {
    const boundary = boundaryFor({ callId: TRELICA_CALLS.appInventory.id });
    const record = { ...INVENTORY_RECORD, customerLicensePlans: [{ name: "Business" }] };
    const refused = boundary.parse({ value: inventoryPage({ record }) })._unsafeUnwrapErr();
    expect(refused.code).toBe("BOUNDARY_SHAPE_CHANGED");
    expect(refused.message).toBe(
      'POST /AppsApi/CustomerApp/FilterItems answered a shape this version does not read — refused, not guessed: field "items[0].customerLicensePlans[0].name" changed: Invalid input: expected record, received string',
    );
  });

  it("refuses the first AI budget anyone creates, naming its keys rather than reading a shape nobody measured", () => {
    const boundary = boundaryFor({ callId: TRELICA_CALLS.aiBudgets.id });
    const page = { items: [{ amount: 100, id: "budget-1" }], resultsTruncated: false, total: 1 };
    const refused = boundary.parse({ value: page })._unsafeUnwrapErr();
    expect(refused.message).toBe(
      'POST /AppsApi/CustomerAppBudget/FilterItems answered a shape this version does not read — refused, not guessed: new field "items[0].amount"; new field "items[0].id"',
    );
  });

  it("admits a measured spike alert, its logo the one key it never holds", () => {
    const boundary = boundaryFor({ callId: TRELICA_CALLS.aiAlertsSpike.id });
    const alert = {
      baselineMedian: 2.5,
      customerAppId: "ca-1",
      customerAppLogoUrl: "https://example.test/logo.png",
      customerAppName: "Example AI",
      date: "2026-10-01",
      evalDaySpend: 40,
      id: "alert-1",
      status: "New",
      subType: "Daily",
      trend: [{ date: "2026-09-30", spend: 2 }],
      type: "Spike",
    };
    const admitted = unwrap(boundary.parse({ value: { items: [alert], resultsTruncated: false, total: 1 } }));
    expect(boundary.censusView({ value: admitted })).toEqual({
      items: [{ ...alert, customerAppLogoUrl: null }],
      resultsTruncated: false,
      total: 1,
    });
  });

  it("reads roles as the unpaged list they are, with no truncation flag", () => {
    const boundary = boundaryFor({ callId: TRELICA_CALLS.roles.id });
    const role = { id: "role-1", isSystemRole: false, name: "App catalog" };
    expect(unwrap(boundary.parse({ value: { items: [role], total: 1 } })).items).toEqual([role]);
    expect(boundary.parse({ value: { items: [role], resultsTruncated: false, total: 1 } }).isErr()).toBe(true);
  });
});
