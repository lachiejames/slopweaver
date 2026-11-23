import { describe, expect, it } from "vitest";

import { responseFieldPaths } from "../../../../atlas/kit/responseShape.js";
import {
  isTrelicaFirstPartyCall,
  reduceTrelicaCalls,
  TRELICA_PATH_DEPTH,
  TRELICA_SEGMENTS,
  trelicaPathShape,
  trelicaSecretsPruned,
} from "../../../../atlas/trelica/browserReduction.js";
import type { CapturedResponse } from "../../../../browser/pageTransport.js";

const TENANT = "https://team-example.trelica.app";

describe("TRELICA_SEGMENTS", () => {
  it("redacts this platform's own 24-character object key", () => {
    expect(TRELICA_SEGMENTS({ segment: "68198e943f2ab275a300a31f" })?.placeholder).toBe("{id}");
  });

  it("redacts a uuid in its dashed form", () => {
    expect(TRELICA_SEGMENTS({ segment: "7836019c-1c00-47cf-8bc9-0c6ee1be5cd7" })?.placeholder).toBe("{uuid}");
  });

  it("redacts a segment that merely CONTAINS an id, which an anchored test would miss", () => {
    expect(TRELICA_SEGMENTS({ segment: "logo-68198e943f2ab275a300a31f.png" })?.placeholder).toBe("{id}");
  });

  it("redacts a bare run of digits", () => {
    expect(TRELICA_SEGMENTS({ segment: "20260905" })?.placeholder).toBe("{n}");
  });

  it("leaves a real path name alone, which is what keeps two lists distinguishable", () => {
    expect(TRELICA_SEGMENTS({ segment: "CustomerApp" })).toBe(null);
  });
});

describe("trelicaPathShape", () => {
  it("keeps every non-value segment, so two sibling operations stay distinct", () => {
    expect(trelicaPathShape({ url: `${TENANT}/AppsApi/CustomerApp/FilterItems?skip=0&take=20` })).toBe(
      "/AppsApi/CustomerApp/FilterItems",
    );
    expect(trelicaPathShape({ url: `${TENANT}/AppsApi/AppCatalog/FilterItems` })).toBe(
      "/AppsApi/AppCatalog/FilterItems",
    );
  });

  it("replaces an id segment while keeping the names around it", () => {
    expect(trelicaPathShape({ url: `${TENANT}/Catalog/68198e943f2ab275a300a31f` })).toBe("/Catalog/{id}");
  });

  it("answers null for something that is not a URL at all", () => {
    expect(trelicaPathShape({ url: "not a url" })).toBe(null);
  });
});

describe("isTrelicaFirstPartyCall", () => {
  it("accepts the tenant's own origin", () => {
    expect(isTrelicaFirstPartyCall({ tenantOrigin: TENANT, url: `${TENANT}/AppsApi/X` })).toBe(true);
  });

  it("rejects the analytics and error-reporting origins a page also calls", () => {
    expect(isTrelicaFirstPartyCall({ tenantOrigin: TENANT, url: "https://api.eu.amplitude.com/2/httpapi" })).toBe(
      false,
    );
    expect(
      isTrelicaFirstPartyCall({ tenantOrigin: TENANT, url: "https://o450509.ingest.us.sentry.io/api/1/envelope/" }),
    ).toBe(false);
  });

  it("rejects the vendor's shared sign-in origin, which is not this tenant", () => {
    expect(isTrelicaFirstPartyCall({ tenantOrigin: TENANT, url: "https://app.trelica.com/Account/Login" })).toBe(false);
  });
});

describe("reduceTrelicaCalls", () => {
  /** One captured response, shaped as the transport hands them back. */
  function response(over: Partial<CapturedResponse> = {}): CapturedResponse {
    return {
      body: { items: [{ id: "68198e943f2ab275a300a31f", name: "Example App" }], total: 1 },
      method: "POST",
      statusCode: 200,
      url: `${TENANT}/AppsApi/CustomerApp/FilterItems?skip=0&take=20`,
      ...over,
    };
  }

  it("stores field NAMES and never a value", () => {
    const rows = reduceTrelicaCalls({ responses: [response()], tenantOrigin: TENANT });
    expect(rows.length).toBe(1);
    expect([...rows[0]!.responseFields]).toEqual(["items", "items[].id", "items[].name", "total"]);
    expect(JSON.stringify(rows).includes("Example App")).toBe(false);
  });

  it("keeps a secret-bearing key's name and no name beneath it, which the raw body carries", () => {
    const body = {
      baseScope: { variables: { employee_password: "pw-canary" } },
      integrations: [{ parameters: { clientSecret: "secret-canary" } }],
      status: "Completed",
    };
    const raw = responseFieldPaths({ body, classify: TRELICA_SEGMENTS, depthCap: TRELICA_PATH_DEPTH });
    const rows = reduceTrelicaCalls({
      responses: [response({ body, method: "GET", url: `${TENANT}/FlowApi/FlowItem/0123456789abcdef01234567` })],
      tenantOrigin: TENANT,
    });

    expect(raw).toContain("baseScope.variables.employee_password");
    expect(raw).toContain("integrations[].parameters.clientSecret");
    expect([...rows[0]!.responseFields]).toEqual([
      "baseScope",
      "baseScope.variables",
      "integrations",
      "integrations[].parameters",
      "status",
    ]);
  });

  it("prunes beneath a secret-bearing key at any depth, keeping the key and every sibling", () => {
    const row = {
      apiKey: { externalId: "external-canary", name: "prod" },
      nested: [{ connection: { parameters: { apiToken: "token-canary" }, status: "Connected" } }],
    };

    expect(trelicaSecretsPruned({ value: row })).toEqual({
      apiKey: { externalId: null, name: "prod" },
      nested: [{ connection: { parameters: null, status: "Connected" } }],
    });
    expect(row.nested[0]!.connection.parameters.apiToken).toBe("token-canary");
  });

  it("folds two calls to one operation into one row, widening the field set", () => {
    const rows = reduceTrelicaCalls({
      responses: [
        response({ body: { items: [{ id: "a" }] } }),
        response({ body: { items: [{ status: "Managed" }], total: 1 } }),
      ],
      tenantOrigin: TENANT,
    });
    expect(rows.length).toBe(1);
    expect([...rows[0]!.responseFields]).toEqual(["items", "items[].id", "items[].status", "total"]);
  });

  it("keeps two different operations as two rows", () => {
    const rows = reduceTrelicaCalls({
      responses: [response(), response({ url: `${TENANT}/AppsApi/AppCatalog/FilterItems` })],
      tenantOrigin: TENANT,
    });
    expect(rows.map((row) => row.pathShape)).toEqual([
      "/AppsApi/AppCatalog/FilterItems",
      "/AppsApi/CustomerApp/FilterItems",
    ]);
  });

  it("drops every third-party response at extraction rather than filtering later", () => {
    const rows = reduceTrelicaCalls({
      responses: [response({ url: "https://api.eu.amplitude.com/2/httpapi" })],
      tenantOrigin: TENANT,
    });
    expect(rows.length).toBe(0);
  });

  it("keeps a row for a first-party call that failed, with its own status", () => {
    const rows = reduceTrelicaCalls({
      responses: [response({ body: null, statusCode: 403, url: `${TENANT}/api/apps/v1` })],
      tenantOrigin: TENANT,
    });
    expect(rows.length).toBe(1);
    expect(rows[0]!.statusCode).toBe(403);
  });
});
