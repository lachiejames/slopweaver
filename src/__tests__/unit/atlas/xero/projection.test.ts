/**
 * How each channel's observations become entities, and the one property the whole corroboration output
 * rests on: a route the SDK declares and a route the browser observed produce the SAME provider id.
 *
 * That is not a convenience. If the two channels keyed differently, every row would sit on one channel
 * alone, `report` would show total disagreement, and the atlas would be asserting a finding it manufactured.
 */
import { describe, expect, it } from "vitest";

import type { XeroPageObservation } from "../../../../atlas/xero/browserWalk.js";
import type { XeroFamily } from "../../../../atlas/xero/families.js";
import type { XeroMethodApiDetail, XeroMethodBrowserDetail } from "../../../../atlas/xero/model.js";
import {
  apiProviderId,
  methodProviderId,
  normalisedSdkPath,
  projectXeroApiMethods,
  projectXeroBrowserMethods,
  projectXeroFamilies,
  projectXeroPages,
  responseFieldsFor,
} from "../../../../atlas/xero/projection.js";
import type { XeroSdkOperation } from "../../../../atlas/xero/sdkEndpoints.js";

const AT = "2026-09-05T00:00:00.000Z";

/** One declared operation, with only the fields a test is about stated. */
function operation({ over }: { over: Partial<XeroSdkOperation> }): XeroSdkOperation {
  return {
    basePath: "https://api.xero.com/api.xro/2.0",
    headerParams: ["Accept", "xero-tenant-id"],
    httpMethod: "GET",
    module: "accountingApi",
    name: "getInvoices",
    path: "/Invoices",
    pathParams: [],
    queryParams: [],
    requestModel: null,
    responseModel: "Invoices",
    summary: "Retrieves sales invoices or purchase bills",
    ...over,
  };
}

/** One page observation, with only the fields a projection reads stated. */
function observation({ over }: { over: Partial<XeroPageObservation> }): XeroPageObservation {
  return {
    artifacts: [],
    attempted: true,
    calls: [],
    captureComplete: true,
    finalUrl: "https://go.xero.com/Contacts",
    observedAt: AT,
    redirected: false,
    requestedUrl: "https://go.xero.com/Contacts",
    responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
    screenshotMissingBecause: null,
    statusCode: 200,
    surface: "contacts",
    title: "Contacts",
    unreachableBecause: null,
    ...over,
  };
}

describe("normalisedSdkPath", () => {
  it("rewrites an id-suffixed parameter to the placeholder a uuid reduces to", () => {
    expect(normalisedSdkPath({ path: "/Invoices/{InvoiceID}" })).toBe("/Invoices/{id}");
  });

  it("rewrites a parameter whose value is NOT id-shaped to a different placeholder", () => {
    expect(normalisedSdkPath({ path: "/Accounts/{AccountID}/Attachments/{FileName}" })).toBe(
      "/Accounts/{id}/Attachments/{v}",
    );
  });

  it("leaves a path with no parameters alone", () => {
    expect(normalisedSdkPath({ path: "/Invoices" })).toBe("/Invoices");
  });
});

describe("methodProviderId", () => {
  it("upper-cases the verb and lower-cases the host, so two channels' spellings still match", () => {
    expect(methodProviderId({ host: "API.Xero.com", httpMethod: "get", pathShape: "/x" })).toBe("GET api.xero.com/x");
  });
});

// This is the corroboration property. Break it and every row sits on one channel alone.
describe("the two channels key a route identically", () => {
  it("gives an SDK collection route the same provider id the browser reduction produces", () => {
    expect(apiProviderId({ operation: operation({ over: {} }) })).toBe(
      methodProviderId({ host: "api.xero.com", httpMethod: "GET", pathShape: "/api.xro/2.0/Invoices" }),
    );
  });

  it("gives an SDK id-parameterised route the same provider id an observed uuid reduces to", () => {
    expect(apiProviderId({ operation: operation({ over: { path: "/Invoices/{InvoiceID}" } }) })).toBe(
      methodProviderId({ host: "api.xero.com", httpMethod: "GET", pathShape: "/api.xro/2.0/Invoices/{id}" }),
    );
  });
});

describe("responseFieldsFor", () => {
  const modelFields = { Invoice: ["AmountDue", "InvoiceID"], Invoices: ["Invoices"] };

  it("resolves a declared model to its wire field names", () => {
    expect(responseFieldsFor({ modelFields, responseModel: "Invoice" })).toEqual(["AmountDue", "InvoiceID"]);
  });

  it("unwraps an array reference to the element's fields, which is what a caller actually sees", () => {
    expect(responseFieldsFor({ modelFields, responseModel: "Array<Invoice>" })).toEqual(["AmountDue", "InvoiceID"]);
  });

  it("answers nothing for a primitive return, which genuinely has no named fields", () => {
    expect(responseFieldsFor({ modelFields, responseModel: "Buffer" })).toEqual([]);
  });

  it("answers nothing when the operation declares no response model at all", () => {
    expect(responseFieldsFor({ modelFields, responseModel: null })).toEqual([]);
  });
});

describe("projectXeroApiMethods", () => {
  const modelFields = { Employee: ["EmployeeID"], Employees: ["Employees"], Invoices: ["Invoices"] };

  it("fills only the api channel, so a merge can never blank what the browser knew", () => {
    const entities = projectXeroApiMethods({ at: AT, modelFields, operations: [operation({ over: {} })] });
    expect(entities[0]!.channels.browser).toBe(null);
  });

  it("declares no deep link for a REST route, and SAYS the provider offers none", () => {
    const entities = projectXeroApiMethods({ at: AT, modelFields, operations: [operation({ over: {} })] });
    expect(entities[0]!.channels.api!.source!.deepLinkStatus).toBe("unavailable");
  });

  it("carries the response field names the model declares", () => {
    const entities = projectXeroApiMethods({ at: AT, modelFields, operations: [operation({ over: {} })] });
    expect((entities[0]!.channels.api!.detail as XeroMethodApiDetail).responseFields).toEqual(["Invoices"]);
  });

  // Three payroll clients share one base path; dropping one client's declaration loses a real fact, and
  // unioning their parameters would assert a false one.
  it("keeps BOTH declarations when two clients declare the same route", () => {
    const entities = projectXeroApiMethods({
      at: AT,
      modelFields,
      operations: [
        operation({
          over: {
            basePath: "https://api.xero.com/payroll.xro/2.0",
            module: "payrollNZApi",
            name: "getEmployees",
            path: "/Employees",
            queryParams: ["page"],
            responseModel: "Employees",
          },
        }),
        operation({
          over: {
            basePath: "https://api.xero.com/payroll.xro/2.0",
            module: "payrollUKApi",
            name: "getEmployees",
            path: "/Employees",
            queryParams: ["filter"],
            responseModel: "Employee",
          },
        }),
      ],
    });
    const detail = entities[0]!.channels.api!.detail as XeroMethodApiDetail;
    expect(detail.declarations.map((one) => one.module)).toEqual(["payrollNZApi", "payrollUKApi"]);
  });

  it("does not union two clients' query parameters, because that would invent a route neither sends", () => {
    const entities = projectXeroApiMethods({
      at: AT,
      modelFields,
      operations: [
        operation({
          over: {
            basePath: "https://api.xero.com/payroll.xro/2.0",
            module: "payrollNZApi",
            path: "/Employees",
            queryParams: ["page"],
          },
        }),
        operation({
          over: {
            basePath: "https://api.xero.com/payroll.xro/2.0",
            module: "payrollUKApi",
            path: "/Employees",
            queryParams: ["filter"],
          },
        }),
      ],
    });
    const detail = entities[0]!.channels.api!.detail as XeroMethodApiDetail;
    expect(detail.declarations.map((one) => one.queryParams)).toEqual([["page"], ["filter"]]);
  });

  it("DOES union the response fields, because that is the which-call-returns-this index", () => {
    const entities = projectXeroApiMethods({
      at: AT,
      modelFields,
      operations: [
        operation({
          over: {
            basePath: "https://api.xero.com/payroll.xro/2.0",
            module: "payrollNZApi",
            path: "/Employees",
            responseModel: "Employees",
          },
        }),
        operation({
          over: {
            basePath: "https://api.xero.com/payroll.xro/2.0",
            module: "payrollUKApi",
            path: "/Employees",
            responseModel: "Employee",
          },
        }),
      ],
    });
    const detail = entities[0]!.channels.api!.detail as XeroMethodApiDetail;
    expect(detail.responseFields).toEqual(["EmployeeID", "Employees"]);
  });

  it("produces one entity per route rather than one per operation", () => {
    const entities = projectXeroApiMethods({
      at: AT,
      modelFields,
      operations: [
        operation({ over: { module: "payrollNZApi", path: "/Employees" } }),
        operation({ over: { module: "payrollUKApi", path: "/Employees" } }),
      ],
    });
    expect(entities).toHaveLength(1);
  });
});

describe("projectXeroBrowserMethods", () => {
  const call = {
    host: "edge-api.xero.com",
    method: "GET",
    pathShape: "/graphql",
    responseFields: ["data"],
    statusCode: 200,
  };

  it("fills only the browser channel", () => {
    const entities = projectXeroBrowserMethods({ at: AT, pages: [observation({ over: { calls: [call] } })] });
    expect(entities[0]!.channels.api).toBe(null);
  });

  it("counts how often it saw an operation called", () => {
    const entities = projectXeroBrowserMethods({
      at: AT,
      pages: [
        observation({ over: { calls: [call], surface: "one" } }),
        observation({ over: { calls: [call], surface: "two" } }),
      ],
    });
    expect((entities[0]!.channels.browser!.detail as XeroMethodBrowserDetail).callCount).toBe(2);
  });

  it("names every page an operation fired on, which is where a lead can be reproduced", () => {
    const entities = projectXeroBrowserMethods({
      at: AT,
      pages: [
        observation({ over: { calls: [call], surface: "two" } }),
        observation({ over: { calls: [call], surface: "one" } }),
      ],
    });
    expect((entities[0]!.channels.browser!.detail as XeroMethodBrowserDetail).seenOnPages).toEqual(["one", "two"]);
  });

  // Keeping only the last page's fields understates the surface.
  it("widens the observed field set across pages rather than letting the last one win", () => {
    const entities = projectXeroBrowserMethods({
      at: AT,
      pages: [
        observation({ over: { calls: [{ ...call, responseFields: ["a"] }], surface: "one" } }),
        observation({ over: { calls: [{ ...call, responseFields: ["b"] }], surface: "two" } }),
      ],
    });
    expect((entities[0]!.channels.browser!.detail as XeroMethodBrowserDetail).responseFields).toEqual(["a", "b"]);
  });

  it("marks a browser-found link as discovered by the browser", () => {
    const entities = projectXeroBrowserMethods({ at: AT, pages: [observation({ over: { calls: [call] } })] });
    expect(entities[0]!.channels.browser!.source!.deepLinkStatus).toBe("browser-discovered");
  });
});

describe("projectXeroPages", () => {
  it("gives a page that could not be addressed its own surface name as a reproduction handle", () => {
    const entities = projectXeroPages({
      at: AT,
      pages: [observation({ over: { requestedUrl: "", surface: "app-dashboard" } })],
    });
    expect(entities[0]!.channels.browser!.source!.endpoint).toBe("app-dashboard");
  });

  it("keys a page entity on its declared surface name rather than on its URL", () => {
    const entities = projectXeroPages({ at: AT, pages: [observation({ over: {} })] });
    expect(entities[0]!.providerId).toBe("contacts");
  });
});

describe("projectXeroFamilies", () => {
  const family: XeroFamily = {
    disposition: "voluminous",
    key: "api.xro/2.0:Journals",
    operations: ["GET /Journals"],
    product: "api.xro/2.0",
    reason: "the general ledger",
    segment: "Journals",
    voluminousOperations: ["GET /Journals"],
  };

  it("carries the disposition, which is what makes the voluminous bound a stored record", () => {
    const entities = projectXeroFamilies({ at: AT, families: [family], ingestBlockedBy: "a credential" });
    expect(entities[0]!.channels.api!.detail).toMatchObject({ disposition: "voluminous" });
  });

  it("says the rows are not ingested and names what would change that", () => {
    const entities = projectXeroFamilies({ at: AT, families: [family], ingestBlockedBy: "a credential" });
    expect(entities[0]!.channels.api!.detail).toMatchObject({
      ingest: "not-ingested",
      ingestBlockedBy: "a credential",
    });
  });

  it("joins a family to the declared pages that show it, so a row can say where a human goes to look", () => {
    const contacts: XeroFamily = { ...family, key: "api.xro/2.0:Contacts", segment: "Contacts" };
    const entities = projectXeroFamilies({ at: AT, families: [contacts], ingestBlockedBy: "a credential" });
    expect(entities[0]!.channels.api!.detail).toMatchObject({
      pages: ["app-contacts", "app-contacts-suppliers", "contacts"],
    });
  });

  it("leaves a family no declared page shows with an empty page list rather than a wrong one", () => {
    const entities = projectXeroFamilies({ at: AT, families: [family], ingestBlockedBy: "a credential" });
    expect(entities[0]!.channels.api!.detail).toMatchObject({ pages: [] });
  });
});
