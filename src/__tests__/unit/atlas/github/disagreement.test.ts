/**
 * The corroboration output, which resolves nothing.
 *
 * That last clause is the owner's ruling rather than a limitation, so what is asserted here is that both
 * comparisons REPORT and neither picks a winner: every disagreement carries both surface names and no
 * verdict field exists for one to be written into.
 */
import { describe, expect, it } from "vitest";

import {
  calledNotDeclared,
  declaredNotExposed,
  summariseDisagreements,
} from "../../../../atlas/github/disagreement.js";
import type { GithubRestOperation, GithubWebRequest } from "../../../../atlas/github/entities.js";

const AT = "2026-09-05T00:00:00.000Z";
const SOURCE = {
  artifacts: [],
  deepLink: null,
  deepLinkStatus: "unavailable" as const,
  endpoint: "@octokit/openapi-types",
  observedAt: AT,
  surface: "rest-openapi" as const,
};

/** One stored operation, with the SDK method a caller wants. */
function operation({ route, sdkMethod }: { route: string; sdkMethod: string | null }): GithubRestOperation {
  const [method = "GET", path = "/"] = route.split(" ");
  return {
    documentationUrl: null,
    firstSeenAt: AT,
    id: route,
    method,
    mutating: false,
    operationId: "orgs/example",
    pathParams: [],
    pathTemplate: path,
    providerId: route,
    queryParams: [],
    responseFields: [],
    responseSchema: null,
    sdkMethod,
    source: SOURCE,
    state: "observed",
    summary: "Example",
  };
}

/** One observed web request, declared in the description or not. */
function request({ pathShape, declared }: { pathShape: string; declared: boolean }): GithubWebRequest {
  return {
    callability: "browser-observed-only",
    declaredInOpenApi: declared,
    firstSeenAt: AT,
    id: pathShape,
    method: "GET",
    observedOnPages: ["/settings/profile"],
    paramNames: [],
    pathShape,
    providerId: `GET ${pathShape}`,
    responseFieldPaths: ["a", "b"],
    source: { ...SOURCE, surface: "github-web" },
    state: "observed",
    statusCodes: [200],
  };
}

describe("declaredNotExposed", () => {
  it("reports an operation GitHub declares that the installed client does not expose", () => {
    const found = declaredNotExposed({
      operations: [
        operation({ route: "GET /a", sdkMethod: null }),
        operation({ route: "GET /b", sdkMethod: "orgs.get" }),
      ],
    });
    expect(found).toHaveLength(1);
    expect(found[0]!.subject).toBe("GET /a");
    expect(found[0]!.surfaces).toEqual(["rest-openapi", "rest-live"]);
  });

  it("reports nothing when every declared operation has a method", () => {
    expect(declaredNotExposed({ operations: [operation({ route: "GET /b", sdkMethod: "orgs.get" })] })).toEqual([]);
  });
});

describe("calledNotDeclared", () => {
  it("reports an endpoint the web client calls that the description does not declare", () => {
    const found = calledNotDeclared({
      requests: [
        request({ declared: false, pathShape: "/_side-panels/user.json" }),
        request({ declared: true, pathShape: "/orgs/<id>" }),
      ],
    });
    expect(found).toHaveLength(1);
    expect(found[0]!.subject).toBe("GET /_side-panels/user.json");
    expect(found[0]!.surfaces).toEqual(["github-web", "rest-openapi"]);
  });

  it("says how many pages depend on it, which is what makes it worth chasing", () => {
    const found = calledNotDeclared({ requests: [request({ declared: false, pathShape: "/x.json" })] });
    expect(found[0]!.detail).toContain("1 page(s)");
  });
});

describe("summariseDisagreements", () => {
  it("counts each comparison separately, because they are different kinds of unknown", () => {
    const summary = summariseDisagreements({
      disagreements: [
        ...declaredNotExposed({ operations: [operation({ route: "GET /a", sdkMethod: null })] }),
        ...calledNotDeclared({ requests: [request({ declared: false, pathShape: "/x.json" })] }),
      ],
    });
    expect(summary).toContain("1 operation(s)");
    expect(summary).toContain("1 endpoint(s)");
  });

  it("reports zeroes for an atlas whose surfaces agree", () => {
    expect(summariseDisagreements({ disagreements: [] })).toContain("0 operation(s)");
  });
});
