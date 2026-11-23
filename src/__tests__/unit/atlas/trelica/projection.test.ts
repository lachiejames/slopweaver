import { describe, expect, it } from "vitest";

import type { TrelicaCallResult } from "../../../../atlas/trelica/client.js";
import type { TrelicaAppDetail, TrelicaMethodPublishedDetail } from "../../../../atlas/trelica/model.js";
import {
  projectTrelicaAppDetail,
  projectTrelicaApps,
  projectTrelicaFirstPartyMethods,
  projectTrelicaPublishedMethods,
  projectTrelicaRoles,
  trelicaAppProviderId,
  trelicaMethodProviderId,
} from "../../../../atlas/trelica/projection.js";

const AT = "2026-09-05T00:00:00.000Z";

/** One provider inventory record, carrying the fields the allowlist keeps and several it drops. */
const INVENTORY_RECORD = {
  appDiscoveredBy: "IdentityProvider",
  appDiscoveredByProviderId: "GSuite",
  applicationId: "app-1",
  // A plan name is localised, keyed by locale, as the inventory answers it (measured).
  customerLicensePlans: [
    { name: { "en-GB": "Business", "en-US": "Business" } },
    { name: { "en-US": "Enterprise" } },
    { name: { "en-US": " " } },
  ],
  displayName: "Example Cloud Identity",
  id: "row-1",
  // The shape the inventory endpoint answers, as measured: the person nests under `contact`.
  internalContacts: [
    {
      accessLevel: "None",
      contact: { email: "second@example.test", id: "p-2", name: "Second Owner", personType: "User" },
      isOwner: false,
      roleId: "itAdmin",
      terminated: true,
    },
    {
      accessLevel: "None",
      contact: { email: "first@example.test", id: "p-1", name: "First Owner", personType: "User" },
      isOwner: true,
      roleId: "businessOwner",
      terminated: false,
    },
  ],
  lastYearSpend: 12_500,
  name: "Example Cloud Identity",
  riskScore: 42,
  status: "Managed",
  userCount: 31,
  vendorContacts: [{ email: "sales@vendor.test", name: "A Vendor Rep" }],
  vendorName: "Example LLC",
};

describe("trelicaMethodProviderId", () => {
  it("upper-cases the verb so a channel spelling it in lower case still matches", () => {
    expect(trelicaMethodProviderId({ httpMethod: "post", pathShape: "/AppsApi/X" })).toBe("POST /AppsApi/X");
  });
});

describe("projectTrelicaAppDetail", () => {
  it("keeps the fields an atlas is asked for", () => {
    const detail = projectTrelicaAppDetail({ inCatalog: true, record: INVENTORY_RECORD })!;
    expect(detail.name).toBe("Example Cloud Identity");
    expect(detail.vendorName).toBe("Example LLC");
    expect(detail.status).toBe("Managed");
    expect(detail.discoveredBy).toBe("IdentityProvider");
    expect(detail.userCount).toBe(31);
    expect(detail.lastYearSpend).toBe(12_500);
    expect(detail.riskScore).toBe(42);
    expect(detail.inCatalog).toBe(true);
  });

  it("holds the organisation's own owners, sorted, because 'who owns this' is the question", () => {
    const detail = projectTrelicaAppDetail({ inCatalog: false, record: INVENTORY_RECORD })!;
    expect(detail.internalContacts.map((contact) => contact.name)).toEqual(["First Owner", "Second Owner"]);
  });

  it("keeps each contact's role, owner flag and termination, so an orphaned app is visible", () => {
    const detail = projectTrelicaAppDetail({ inCatalog: false, record: INVENTORY_RECORD })!;
    expect(detail.internalContacts).toEqual([
      { email: "first@example.test", isOwner: true, name: "First Owner", role: "businessOwner", terminated: false },
      { email: "second@example.test", isOwner: false, name: "Second Owner", role: "itAdmin", terminated: true },
    ]);
  });

  it("drops a contact entry with no nested person, which names nobody", () => {
    const detail = projectTrelicaAppDetail({
      inCatalog: false,
      record: { ...INVENTORY_RECORD, internalContacts: [{ isOwner: true, name: "Flat Name", roleId: "x" }] },
    })!;
    expect(detail.internalContacts).toEqual([]);
  });

  it("drops the vendor's own staff, which the allowlist never reads", () => {
    const detail = projectTrelicaAppDetail({ inCatalog: false, record: INVENTORY_RECORD })!;
    expect(Object.keys(detail).includes("vendorContacts")).toBe(false);
  });

  it("keeps licence PLAN names and never a seat", () => {
    const detail = projectTrelicaAppDetail({ inCatalog: false, record: INVENTORY_RECORD })!;
    expect([...detail.licensePlans]).toEqual(["Business", "Enterprise"]);
  });

  it("drops a field the vendor added that the allowlist does not name", () => {
    const detail = projectTrelicaAppDetail({
      inCatalog: false,
      record: { ...INVENTORY_RECORD, somethingNewNextMonth: "a real value" },
    })!;
    expect(JSON.stringify(detail).includes("a real value")).toBe(false);
  });

  it("records an absent optional as null rather than inventing a zero", () => {
    const detail = projectTrelicaAppDetail({ inCatalog: false, record: { name: "Bare App" } })!;
    expect(detail.lastYearSpend).toBe(null);
    expect(detail.userCount).toBe(null);
    expect(detail.vendorName).toBe(null);
    expect(detail.status).toBe("Unknown");
  });

  it("refuses a record with no name, which identifies nothing", () => {
    expect(projectTrelicaAppDetail({ inCatalog: false, record: { id: "x" } })).toBe(null);
  });
});

describe("trelicaAppProviderId", () => {
  // MEASURED: the catalogue answers the TENANT's row id, never the vendor's global
  // `applicationId`, so keying on the latter made every catalogue row a second entity for an application
  // the inventory already held, publishing more applications than the tenant holds.
  it("keys on the tenant's own row id, which is what the catalogue answers", () => {
    expect(trelicaAppProviderId({ record: INVENTORY_RECORD })).toBe("row-1");
  });

  it("never keys on the vendor's global application id, which the catalogue does not answer", () => {
    expect(trelicaAppProviderId({ record: { applicationId: "global-1" } })).toBe(null);
  });

  it("keys a catalogue-only record on its own id", () => {
    expect(trelicaAppProviderId({ record: { id: "catalog-only" } })).toBe("catalog-only");
  });
});

describe("projectTrelicaApps", () => {
  it("folds the inventory and the catalogue onto one entity per application", () => {
    const entities = projectTrelicaApps({
      at: AT,
      catalog: [{ id: "row-1", name: "Example Cloud Identity" }],
      inventory: [INVENTORY_RECORD],
    });
    expect(entities.length).toBe(1);
    expect((entities[0]!.channels["first-party-api"]!.detail as TrelicaAppDetail).inCatalog).toBe(true);
  });

  // The regression the live run found: a catalogue row keyed on the vendor's global id would have folded
  // onto nothing, so one application became two entities and neither was marked as offered.
  it("does not mint a second entity for an application already in the inventory", () => {
    const entities = projectTrelicaApps({
      at: AT,
      catalog: [{ id: "row-1", name: "Example Cloud Identity" }],
      inventory: [INVENTORY_RECORD, { id: "row-2", name: "Another App" }],
    });
    expect(entities.length).toBe(2);
    expect(entities.map((entity) => entity.providerId).toSorted()).toEqual(["row-1", "row-2"]);
  });

  it("keeps a catalogue-only application, because the catalogue says it exists", () => {
    const entities = projectTrelicaApps({
      at: AT,
      catalog: [{ id: "catalog-only", name: "Offered Only" }],
      inventory: [INVENTORY_RECORD],
    });
    expect(entities.length).toBe(2);
  });

  it("marks an inventory application absent from the catalogue as not offered", () => {
    const entities = projectTrelicaApps({ at: AT, catalog: [], inventory: [INVENTORY_RECORD] });
    expect((entities[0]!.channels["first-party-api"]!.detail as TrelicaAppDetail).inCatalog).toBe(false);
  });

  it("fills only the first-party channel, so a merge can never blank another", () => {
    const entities = projectTrelicaApps({ at: AT, catalog: [], inventory: [INVENTORY_RECORD] });
    expect(entities[0]!.channels["published-api"]).toBe(null);
    expect(entities[0]!.channels.browser).toBe(null);
  });
});

describe("projectTrelicaRoles", () => {
  it("projects a role and records whether the platform ships it", () => {
    const entities = projectTrelicaRoles({
      at: AT,
      records: [{ id: "role-1", isSystemRole: false, name: "App catalog" }],
    });
    expect(entities.length).toBe(1);
    expect(entities[0]!.providerId).toBe("role-1");
    expect(entities[0]!.kind).toBe("role");
  });

  it("drops a record carrying no id, which nothing can be keyed on", () => {
    expect(projectTrelicaRoles({ at: AT, records: [{ name: "Nameless" }] }).length).toBe(0);
  });
});

describe("projectTrelicaPublishedMethods", () => {
  it("keys a published operation on its verb and declared path", () => {
    const entities = projectTrelicaPublishedMethods({
      at: AT,
      surface: {
        documents: [
          {
            document: "apps",
            operations: [
              {
                bodyParams: [],
                document: "apps",
                httpMethod: "GET",
                operationId: "listApps",
                path: "/api/apps/v1",
                pathParams: [],
                queryParams: ["take"],
                responseFields: ["id"],
                security: ["oauth2"],
                summary: "List applications",
              },
            ],
            securitySchemes: ["oauth2"],
            servers: [],
            title: "SaaS Manager API",
            version: "v1",
          },
        ],
        unreadable: [],
      },
    });
    expect(entities[0]!.providerId).toBe("GET /api/apps/v1");
    const detail = entities[0]!.channels["published-api"]!.detail as TrelicaMethodPublishedDetail;
    expect(detail.operationId).toBe("listApps");
    expect([...detail.documents]).toEqual(["apps"]);
    expect([...detail.security]).toEqual(["oauth2"]);
  });
});

describe("projectTrelicaFirstPartyMethods", () => {
  it("marks a call this atlas made as called directly, which a watched call is not", () => {
    const result: TrelicaCallResult = {
      callId: "roles",
      httpMethod: "GET",
      items: [],
      path: "/Id/AdminApi/Roles",
      statusCode: 200,
      total: 9,
    };
    const entities = projectTrelicaFirstPartyMethods({
      at: AT,
      fieldNames: new Map([["roles", ["items[].id", "total"]]]),
      results: [result],
    });
    expect(entities[0]!.providerId).toBe("GET /Id/AdminApi/Roles");
    expect(entities[0]!.channels["first-party-api"]!.detail).toEqual({
      callCount: 1,
      calledDirectly: true,
      responseFields: ["items[].id", "total"],
      statusCode: 200,
    });
  });
});
