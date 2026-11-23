/**
 * The `atlas github` verbs' refusal lines. Two of their refusals have always printed a second line saying
 * what the first one means, and the surface parser's list is its own; each must still reach stderr one line
 * per entry rather than as the joined `message`.
 */
import { describe, expect, it } from "vitest";

import { GithubAtlasErrors } from "../../../../../atlas/github/errors.js";
import { GithubAtlasVerbErrors, githubAtlasVerbErrorLines } from "../../../../../cli/commands/githubAtlas/errors.js";

describe("githubAtlasVerbErrorLines", () => {
  it("prints an unreadable description as the failure, then what it means, on two lines", () => {
    expect(
      githubAtlasVerbErrorLines({ error: GithubAtlasVerbErrors.descriptionUnreadable({ detail: "EACCES" }) }),
    ).toEqual([
      "could not read GitHub's published OpenAPI description from @octokit/openapi-types: EACCES",
      "the API surface is compiled from the installed package rather than fetched, so this is an install problem rather than a network one",
    ]);
  });

  it("prints an unfinished repository enumeration as the failure, then why the sync refuses, on two lines", () => {
    const cause = GithubAtlasErrors.routeAbsent({ route: "GET /orgs/acme/repos" });
    expect(
      githubAtlasVerbErrorLines({ error: GithubAtlasVerbErrors.repositoriesUnenumerated({ cause, org: "acme" }) }),
    ).toEqual([
      "could not enumerate acme's repositories to the end of paging: GitHub answered 404 for GET /orgs/acme/repos — the route is not served on this host, or the object it names does not exist",
      "the sync refuses rather than covering a subset — a generation that silently capped its own enumeration would claim to cover an organisation it had only partly walked",
    ]);
  });

  it("prints each of the surface parser's refusals on its own line", () => {
    expect(
      githubAtlasVerbErrorLines({ error: GithubAtlasVerbErrors.surfaceUnparseable({ reasons: ["first", "second"] }) }),
    ).toEqual(["first", "second"]);
  });

  it("prints a single-problem refusal as its message", () => {
    expect(
      githubAtlasVerbErrorLines({ error: GithubAtlasVerbErrors.listingRouteUnbuildable({ org: "acme" }) }),
    ).toEqual(["could not build the repository listing route for acme"]);
  });
});
