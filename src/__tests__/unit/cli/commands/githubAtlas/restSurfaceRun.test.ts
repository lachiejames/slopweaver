/**
 * The GitHub REST surface compiler's pure half, over declaration and endpoint-table text written here — never
 * over the installed `node_modules` packages the shell reads.
 */
import { describe, expect, it } from "vitest";

import { GithubRefusalErrors } from "../../../../../atlas/github/errors.js";
import { GithubAtlasVerbErrors } from "../../../../../cli/commands/githubAtlas/errors.js";
import { compileGithubRestSurfaceDocuments } from "../../../../../cli/commands/githubAtlas/restSurfaceRun.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

/** Two routes: one documented read with a response schema, one undocumented delete with none. */
const DECLARATIONS = `
export interface paths {
  "/orgs/{org}": {
    /**
     * Get an organization
     */
    get: operations["orgs/get"];
  };
  "/repos/{owner}/{repo}": {
    delete: operations["repos/delete"];
  };
}
export interface components {
  schemas: {
    "organization-full": {
      login: string;
      billing_email: string | null;
    };
  };
}
export interface operations {
  "orgs/get": {
    parameters: {
      path: {
        org: string;
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
  "repos/delete": {
    parameters: {
      path: {
        owner: string;
        repo: string;
      };
    };
    responses: {
      204: never;
    };
  };
}
`;

/**
 * An endpoint table carrying one inline method, one wrapped method, and two near-misses: a method line before
 * any scope header, and a method line indented one level too deep.
 */
const ENDPOINT_SOURCE = [
  "const Endpoints = {",
  '    early: ["GET /before/any/scope"],',
  "  orgs: {",
  '    get: ["GET /orgs/{org}"],',
  '      tooDeep: ["GET /too/deep"],',
  "  },",
  "  repos: {",
  "    delete: [",
  '      "DELETE /repos/{owner}/{repo}"',
  "    ],",
  "  },",
  "};",
].join("\n");

/** The routes {@link DECLARATIONS} compiles to, sorted by route. */
const ROUTES = [
  {
    operationId: "repos/delete",
    pathParams: ["owner", "repo"],
    queryParams: [],
    responseFields: [],
    responseSchema: null,
    route: "DELETE /repos/{owner}/{repo}",
    summary: "",
  },
  {
    operationId: "orgs/get",
    pathParams: ["org"],
    queryParams: [],
    responseFields: ["billing_email", "login"],
    responseSchema: "organization-full",
    route: "GET /orgs/{org}",
    summary: "Get an organization",
  },
];

describe("compileGithubRestSurfaceDocuments", () => {
  it("compiles the routes, carries the version and maps the inline and wrapped methods, skipping both near-misses", () => {
    let reads = 0;
    const compiled = compileGithubRestSurfaceDocuments({
      declarations: DECLARATIONS,
      descriptionVersion: "12.6.0",
      readEndpointSource: () => {
        reads += 1;
        return ENDPOINT_SOURCE;
      },
    });
    expect(compiled.isOk()).toBe(true);
    const surface = unwrap(compiled);
    expect(surface.descriptionVersion).toBe("12.6.0");
    expect(surface.routes).toEqual(ROUTES);
    expect([...surface.sdkMethodByRoute.entries()]).toEqual([
      ["GET /orgs/{org}", "orgs.get"],
      ["DELETE /repos/{owner}/{repo}", "repos.delete"],
    ]);
    expect(reads).toBe(1);
  });

  it("keeps the routes and answers an empty SDK map when the endpoint table is unavailable", () => {
    const surface = unwrap(
      compileGithubRestSurfaceDocuments({
        declarations: DECLARATIONS,
        descriptionVersion: "12.6.0",
        readEndpointSource: () => null,
      }),
    );
    expect(surface.routes).toEqual(ROUTES);
    expect([...surface.sdkMethodByRoute.entries()]).toEqual([]);
  });

  it("refuses declarations with no paths interface as SURFACE_UNPARSEABLE without reading the endpoint table", () => {
    let reads = 0;
    const compiled = compileGithubRestSurfaceDocuments({
      declarations: "export interface webhooks {}",
      descriptionVersion: "12.6.0",
      readEndpointSource: () => {
        reads += 1;
        return ENDPOINT_SOURCE;
      },
    });
    expect(compiled.isErr()).toBe(true);
    const error = unwrapErr(compiled);
    const shapeChanged =
      "the GitHub OpenAPI description declares no `paths` or no `operations` interface — its shape has changed, and enumerating zero routes would report a complete API surface over nothing";
    expect(error.code).toBe("SURFACE_UNPARSEABLE");
    expect(error.message).toBe(shapeChanged);
    expect(error).toEqual(
      GithubAtlasVerbErrors.surfaceUnparseable({ reasons: [GithubRefusalErrors.shapeChanged().message] }),
    );
    expect(reads).toBe(0);
  });
});
