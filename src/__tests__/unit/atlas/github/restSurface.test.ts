/**
 * The REST-surface extractor, over declaration text written here rather than over `node_modules`.
 *
 * Every fixture below is a miniature of a shape MEASURED in the shipped `@octokit/openapi-types`
 * description, and each one is a regression: comment braces desynchronising a depth counter, and a schema
 * whose name is a bare identifier rather than a quoted string. Both failed silently — the parser reported
 * success over a fraction of the surface — which is why they are pinned by exact counts.
 */
import { describe, expect, it } from "vitest";

import { blockMembers, interfaceBody, memberNames } from "../../../../atlas/github/restDeclarationScan.js";
import {
  operationFacts,
  parseGithubRestSurface,
  pathOperations,
  schemaReference,
} from "../../../../atlas/github/restSurface.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** A description carrying the two shapes that broke the first parser, plus one ordinary route. */
const DESCRIPTION = `
export interface paths {
  "/orgs/{org}": {
    /**
     * Get an organization
     * @description Gets information about an organization. Pass \`{org}\` in the path.
     */
    get: operations["orgs/get"];
    /**
     * Update an organization
     * @description Replaces the settings. The brace in { this sentence } is prose.
     */
    patch: operations["orgs/update"];
  };
  "/orgs/{org}/installations": {
    /**
     * List app installations for an organization
     */
    get: operations["orgs/list-app-installations"];
  };
}
export interface components {
  schemas: {
    "organization-full": {
      login: string;
      billing_email: string | null;
      two_factor_requirement_enabled?: boolean;
    };
    installation: {
      id: number;
      app_slug: string;
    };
  };
}
export interface operations {
  "orgs/get": {
    parameters: {
      path: {
        org: components["parameters"]["org"];
      };
    };
    responses: {
      200: {
        content: {
          "application/json": components["schemas"]["organization-full"];
        };
      };
    };
  };
  "orgs/update": {
    parameters: {
      path: {
        org: components["parameters"]["org"];
      };
    };
    responses: {
      200: {
        content: {
          "application/json": components["schemas"]["organization-full"];
        };
      };
    };
  };
  "orgs/list-app-installations": {
    parameters: {
      query?: {
        per_page?: components["parameters"]["per-page"];
        page?: components["parameters"]["page"];
      };
      path: {
        org: components["parameters"]["org"];
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            total_count: number;
            installations: components["schemas"]["installation"][];
          };
        };
      };
    };
  };
}
`;

describe("interfaceBody", () => {
  it("returns the body of a named interface", () => {
    const body = interfaceBody({ name: "paths", text: DESCRIPTION });
    expect(body?.includes(`"/orgs/{org}"`)).toBe(true);
  });

  it("returns null for an interface the text does not declare", () => {
    expect(interfaceBody({ name: "webhooks", text: DESCRIPTION })).toBe(null);
  });
});

describe("blockMembers", () => {
  it("reads a quoted key and a bare key from the same block", () => {
    const schemas = interfaceBody({ name: "components", text: DESCRIPTION })!;
    const keys = blockMembers({ body: blockMembers({ body: schemas })[0]!.block }).map((member) => member.key);
    expect(keys).toEqual(["organization-full", "installation"]);
  });

  it("is not desynchronised by a brace inside a comment", () => {
    const paths = interfaceBody({ name: "paths", text: DESCRIPTION })!;
    expect(blockMembers({ body: paths }).map((member) => member.key)).toEqual([
      "/orgs/{org}",
      "/orgs/{org}/installations",
    ]);
  });
});

describe("memberNames", () => {
  it("returns optional and required member names alike, sorted", () => {
    expect(memberNames({ body: "login: string;\n  billing_email?: string | null;" })).toEqual([
      "billing_email",
      "login",
    ]);
  });

  it("returns no name for a nested member", () => {
    expect(memberNames({ body: "outer: {\n  inner: string;\n};" })).toEqual(["outer"]);
  });

  it("returns an empty list for a block with no members", () => {
    expect(memberNames({ body: "" })).toEqual([]);
  });
});

describe("schemaReference", () => {
  it("returns the referenced schema name", () => {
    expect(schemaReference({ text: `x: components["schemas"]["organization-full"];` })).toBe("organization-full");
  });

  it("returns null when nothing references a schema", () => {
    expect(schemaReference({ text: "x: string;" })).toBe(null);
  });
});

describe("pathOperations", () => {
  it("returns every verb a path declares, upper-cased, with its operation id", () => {
    expect(pathOperations({ block: `get: operations["orgs/get"];\n patch: operations["orgs/update"];` })).toEqual([
      { operationId: "orgs/get", verb: "GET" },
      { operationId: "orgs/update", verb: "PATCH" },
    ]);
  });

  it("returns nothing for a path object declaring no verb", () => {
    expect(pathOperations({ block: "parameters: { path: { org: string } };" })).toEqual([]);
  });
});

describe("operationFacts", () => {
  it("reads path and query parameter names and the success schema", () => {
    const operations = interfaceBody({ name: "operations", text: DESCRIPTION })!;
    const block = blockMembers({ body: operations }).find(
      (member) => member.key === "orgs/list-app-installations",
    )!.block;
    const facts = operationFacts({ block });
    expect(facts.pathParams).toEqual(["org"]);
    expect(facts.queryParams).toEqual(["page", "per_page"]);
    expect(facts.responseSchema).toBe("installation");
  });

  it("reports no schema for an operation declaring no success body", () => {
    expect(operationFacts({ block: "responses: {\n 204: { content?: never };\n};" }).responseSchema).toBe(null);
  });
});

describe("parseGithubRestSurface", () => {
  it("extracts every route, sorted, with its summary, parameters and response fields", () => {
    const routes = unwrap(parseGithubRestSurface({ declarations: DESCRIPTION }));
    expect(routes.map((route) => route.route)).toEqual([
      "GET /orgs/{org}",
      "GET /orgs/{org}/installations",
      "PATCH /orgs/{org}",
    ]);
    const org = routes.find((route) => route.route === "GET /orgs/{org}")!;
    expect(org.operationId).toBe("orgs/get");
    expect(org.summary).toBe("Get an organization");
    expect(org.pathParams).toEqual(["org"]);
    expect(org.queryParams).toEqual([]);
    expect(org.responseSchema).toBe("organization-full");
    expect(org.responseFields).toEqual(["billing_email", "login", "two_factor_requirement_enabled"]);
  });

  it("resolves the fields of a schema whose name is a bare identifier", () => {
    const routes = unwrap(parseGithubRestSurface({ declarations: DESCRIPTION }));
    const installations = routes.find((route) => route.route === "GET /orgs/{org}/installations")!;
    expect(installations.responseSchema).toBe("installation");
    expect(installations.responseFields).toEqual(["app_slug", "id"]);
  });

  it("refuses a description declaring no paths interface", () => {
    const parsed = parseGithubRestSurface({ declarations: "export interface components { schemas: {} }" });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toContain("declares no `paths`");
  });

  it("refuses a paths interface that declares no route at all", () => {
    const parsed = parseGithubRestSurface({
      declarations: "export interface paths {\n}\nexport interface operations {\n}",
    });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toContain("declared no route at all");
  });

  it("prints the missing-interface refusal as one exact line", () => {
    expect(unwrapErr(parseGithubRestSurface({ declarations: "export interface components { schemas: {} }" }))).toEqual([
      "the GitHub OpenAPI description declares no `paths` or no `operations` interface — its shape has changed, and enumerating zero routes would report a complete API surface over nothing",
    ]);
  });

  it("prints the no-route refusal as one exact line", () => {
    const declarations = "export interface paths {\n}\nexport interface operations {\n}";
    expect(unwrapErr(parseGithubRestSurface({ declarations }))).toEqual([
      "the GitHub OpenAPI description declared no route at all, so its `paths` shape has changed",
    ]);
  });
});
