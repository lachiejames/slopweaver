/**
 * The GitHub admin walk's declared-route reduction: the published routes reduced to the path shape a
 * browser-observed call is compared against, with no browser, clock or filesystem involved.
 */
import { describe, expect, it } from "vitest";

import type { GithubRestRoute } from "../../../../../atlas/github/restSurface.js";
import { githubDeclaredRouteShapes } from "../../../../../cli/commands/githubAtlas/walkRun.js";

/** A declared route with only its route string varying; nothing else is read by the reduction. */
function route({ path }: { path: string }): GithubRestRoute {
  return {
    operationId: "op",
    pathParams: [],
    queryParams: [],
    responseFields: [],
    responseSchema: null,
    route: path,
    summary: "",
  };
}

describe("githubDeclaredRouteShapes", () => {
  it("replaces a placeholder at the start, middle and end of a path, and two in one path, with <id>", () => {
    const shapes = githubDeclaredRouteShapes({
      routes: [
        route({ path: "GET /{org}/settings" }),
        route({ path: "GET /orgs/{org}/hooks" }),
        route({ path: "DELETE /orgs/acme/hooks/{hook_id}" }),
        route({ path: "PATCH /repos/{owner}/{repo}" }),
      ],
    });
    expect([...shapes]).toEqual([
      "GET /<id>/settings",
      "GET /orgs/<id>/hooks",
      "DELETE /orgs/acme/hooks/<id>",
      "PATCH /repos/<id>/<id>",
    ]);
  });

  it("leaves a route with no placeholder unchanged", () => {
    expect([...githubDeclaredRouteShapes({ routes: [route({ path: "GET /meta" })] })]).toEqual(["GET /meta"]);
  });

  it("collapses two routes that reduce to one shape into one entry", () => {
    const shapes = githubDeclaredRouteShapes({
      routes: [route({ path: "GET /orgs/{org}" }), route({ path: "GET /orgs/{organisation}" })],
    });
    expect([...shapes]).toEqual(["GET /orgs/<id>"]);
  });

  it("answers an empty set for no routes", () => {
    expect(githubDeclaredRouteShapes({ routes: [] }).size).toBe(0);
  });
});
