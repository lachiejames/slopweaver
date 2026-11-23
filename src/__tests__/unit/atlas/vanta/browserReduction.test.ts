import { describe, expect, it } from "vitest";

import {
  isFirstPartyVantaCall,
  reduceVantaCalls,
  vantaCallProviderId,
  vantaOperationName,
  vantaPathShape,
} from "../../../../atlas/vanta/browserReduction.js";
import type { CapturedResponse } from "../../../../browser/pageTransport.js";

const ORIGIN = "https://app.vanta.com";

const response = ({
  url,
  body = {},
  method = "POST",
  statusCode = 200,
}: {
  url: string;
  body?: unknown;
  method?: string;
  statusCode?: number;
}): CapturedResponse => ({ body, method, statusCode, url });

describe("isFirstPartyVantaCall", () => {
  it("keeps Vanta's own call", () => {
    expect(isFirstPartyVantaCall({ origin: ORIGIN, url: `${ORIGIN}/c/acme/graphql?operation=userContext` })).toBe(true);
  });

  it("drops the telemetry a page also sends beside Vanta's own calls", () => {
    expect(isFirstPartyVantaCall({ origin: ORIGIN, url: "https://browser-intake-datadoghq.com/api/v2/rum" })).toBe(
      false,
    );
  });

  it("drops something that is not a URL", () => {
    expect(isFirstPartyVantaCall({ origin: ORIGIN, url: "::::" })).toBe(false);
  });
});

describe("vantaCallProviderId", () => {
  const call = { method: "GET", pathShape: "/c/{tenant}/api/me", responseFields: [], statusCode: 200 };

  it("names a GraphQL call by its operation", () => {
    expect(vantaCallProviderId({ call: { ...call, operation: "userContext" } })).toBe("userContext");
  });

  it("names a call that is not a GraphQL post by its method and redacted path shape", () => {
    expect(vantaCallProviderId({ call: { ...call, operation: null } })).toBe("GET /c/{tenant}/api/me");
  });
});

describe("vantaOperationName", () => {
  it("reads the operation, which is the identity of a Vanta client call", () => {
    expect(vantaOperationName({ url: `${ORIGIN}/c/acme/graphql?operation=FetchAuditorsForAudit` })).toBe(
      "FetchAuditorsForAudit",
    );
  });

  it("answers null for a call that is not a named GraphQL post", () => {
    expect(vantaOperationName({ url: `${ORIGIN}/c/acme/tests` })).toBe(null);
  });
});

describe("vantaPathShape", () => {
  it("redacts the tenant, so a reduced row can be committed at all", () => {
    expect(vantaPathShape({ url: `${ORIGIN}/c/acme/graphql?operation=userContext` })).toBe("/c/{tenant}/graphql");
  });

  it("redacts a Vanta id", () => {
    expect(vantaPathShape({ url: `${ORIGIN}/c/acme/tests/6a44f7b34701837c5a3d6581` })).toBe("/c/{tenant}/tests/{id}");
  });

  it("redacts a uuid and a bare number", () => {
    expect(vantaPathShape({ url: `${ORIGIN}/x/49618c1f-e4e7-4379-890f-4a83a86d9f5b/42` })).toBe("/x/{uuid}/{n}");
  });

  it("keeps a real path name", () => {
    expect(vantaPathShape({ url: `${ORIGIN}/c/acme/risk-management/risk-register` })).toBe(
      "/c/{tenant}/risk-management/risk-register",
    );
  });

  it("answers null for something that is not a URL", () => {
    expect(vantaPathShape({ url: "nope" })).toBe(null);
  });
});

describe("reduceVantaCalls", () => {
  it("keeps field NAMES and never a value", () => {
    const rows = reduceVantaCalls({
      origin: ORIGIN,
      responses: [
        response({
          body: { data: { user: { displayName: "A Person", email: "a.person@example.test" } } },
          url: `${ORIGIN}/c/acme/graphql?operation=userContext`,
        }),
      ],
    });
    expect(rows.length).toBe(1);
    const serialised = JSON.stringify(rows);
    expect(serialised).toContain("data.user.email");
    expect(serialised).not.toContain("a.person@example.test");
    expect(serialised).not.toContain("A Person");
  });

  it("drops third-party telemetry at extraction rather than filtering it later", () => {
    const rows = reduceVantaCalls({
      origin: ORIGIN,
      responses: [
        response({ url: "https://browser-intake-datadoghq.com/api/v2/rum" }),
        response({ url: `${ORIGIN}/c/acme/graphql?operation=userContext` }),
      ],
    });
    expect(rows.map((row) => row.operation)).toEqual(["userContext"]);
  });

  it("orders named operations first and alphabetically, so a published file is stable between runs", () => {
    const rows = reduceVantaCalls({
      origin: ORIGIN,
      responses: [
        response({ url: `${ORIGIN}/c/acme/graphql?operation=zeta` }),
        response({ url: `${ORIGIN}/c/acme/assets/thing` }),
        response({ url: `${ORIGIN}/c/acme/graphql?operation=alpha` }),
      ],
    });
    expect(rows.map((row) => row.operation)).toEqual(["alpha", "zeta", null]);
  });

  it("carries the method and status of each call", () => {
    const rows = reduceVantaCalls({
      origin: ORIGIN,
      responses: [response({ method: "GET", statusCode: 404, url: `${ORIGIN}/c/acme/graphql?operation=x` })],
    });
    expect(rows[0]!.method).toBe("GET");
    expect(rows[0]!.statusCode).toBe(404);
  });

  it("reduces an empty capture to no rows", () => {
    expect(reduceVantaCalls({ origin: ORIGIN, responses: [] })).toEqual([]);
  });
});
