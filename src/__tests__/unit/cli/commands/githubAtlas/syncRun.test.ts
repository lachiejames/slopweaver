/**
 * The GitHub atlas sync's offline projection: a compiled REST surface becoming stored `rest-operation`
 * entities, with no token, network, clock or filesystem involved.
 */
import { describe, expect, it } from "vitest";

import { githubEntityId } from "../../../../../atlas/github/identity.js";
import type { CompiledRestSurface } from "../../../../../cli/commands/githubAtlas/restSurfaceRun.js";
import { projectCompiledGithubOperations } from "../../../../../cli/commands/githubAtlas/syncRun.js";

const AT = "2026-10-13T04:05:06.000Z";

/** The provenance every projected operation carries for a run at {@link AT}. */
const SOURCE = {
  artifacts: [],
  deepLink: null,
  deepLinkStatus: "unavailable",
  endpoint: "@octokit/openapi-types",
  observedAt: AT,
  surface: "rest-openapi",
};

/** Two declared routes, of which the installed Octokit maps only the first. */
const COMPILED: CompiledRestSurface = {
  descriptionVersion: "12.6.0",
  routes: [
    {
      operationId: "orgs/get",
      pathParams: ["org"],
      queryParams: [],
      responseFields: ["login"],
      responseSchema: "organization-full",
      route: "GET /orgs/{org}",
      summary: "Get an organization",
    },
    {
      operationId: "repos/delete",
      pathParams: ["owner", "repo"],
      queryParams: ["dry_run"],
      responseFields: [],
      responseSchema: null,
      route: "DELETE /repos/{owner}/{repo}",
      summary: "",
    },
  ],
  sdkMethodByRoute: new Map([
    ["GET /orgs/{org}", "orgs.get"],
    ["PUT /unrelated/route", "unrelated.put"],
  ]),
};

describe("projectCompiledGithubOperations", () => {
  it("projects each compiled route into an operation, with the SDK method where Octokit maps one and null where it does not", () => {
    expect(projectCompiledGithubOperations({ at: AT, compiled: COMPILED })).toEqual([
      {
        documentationUrl: null,
        firstSeenAt: AT,
        id: githubEntityId({ kind: "rest-operation", providerId: "GET /orgs/{org}", scopeRef: "github" }),
        method: "GET",
        mutating: false,
        operationId: "orgs/get",
        pathParams: ["org"],
        pathTemplate: "/orgs/{org}",
        providerId: "GET /orgs/{org}",
        queryParams: [],
        responseFields: ["login"],
        responseSchema: "organization-full",
        sdkMethod: "orgs.get",
        source: SOURCE,
        state: "observed",
        summary: "Get an organization",
      },
      {
        documentationUrl: null,
        firstSeenAt: AT,
        id: githubEntityId({
          kind: "rest-operation",
          providerId: "DELETE /repos/{owner}/{repo}",
          scopeRef: "github",
        }),
        method: "DELETE",
        mutating: true,
        operationId: "repos/delete",
        pathParams: ["owner", "repo"],
        pathTemplate: "/repos/{owner}/{repo}",
        providerId: "DELETE /repos/{owner}/{repo}",
        queryParams: ["dry_run"],
        responseFields: [],
        responseSchema: null,
        sdkMethod: null,
        source: SOURCE,
        state: "observed",
        summary: "",
      },
    ]);
  });

  it("answers an empty list for a surface with no routes", () => {
    expect(
      projectCompiledGithubOperations({
        at: AT,
        compiled: { descriptionVersion: "12.6.0", routes: [], sdkMethodByRoute: new Map() },
      }),
    ).toEqual([]);
  });
});
