/**
 * The admin-page frontier: which links are in scope, which are refused outright, and how a round expands.
 *
 * Every value here is synthetic. The atlas's real scopes are an organisation login and repository names,
 * which are private identifiers and may never enter a committed file — so the fixtures use `example-org`
 * and `example-repo`, exactly as the sibling CrowdStrike sitemap tests use a synthetic Falcon origin.
 */
import { describe, expect, it } from "vitest";

import {
  canonicaliseGithubHref,
  expandFrontier,
  githubSettingsSeeds,
  isAdminPath,
  isCredentialRevealPath,
  isRepositorySettingsPath,
} from "../../../../atlas/github/webRoutes.js";

const ORIGIN = "https://github.example.test";

describe("isRepositorySettingsPath", () => {
  it("accepts a repository settings root", () => {
    expect(isRepositorySettingsPath({ path: "/example-org/example-repo/settings" })).toBe(true);
  });

  it("accepts a repository settings sub-page", () => {
    expect(isRepositorySettingsPath({ path: "/example-org/example-repo/settings/branches" })).toBe(true);
  });

  it("rejects a repository page that is not settings", () => {
    expect(isRepositorySettingsPath({ path: "/example-org/example-repo/pulls" })).toBe(false);
  });

  it("rejects an account settings path, which is matched by prefix instead", () => {
    expect(isRepositorySettingsPath({ path: "/settings/profile" })).toBe(false);
  });
});

describe("isCredentialRevealPath", () => {
  it("refuses a token-minting page", () => {
    expect(isCredentialRevealPath({ path: "/settings/tokens/new" })).toBe(true);
  });

  it("refuses the recovery-codes page", () => {
    expect(isCredentialRevealPath({ path: "/settings/auth/recovery-codes" })).toBe(true);
  });

  it("admits an ordinary settings page", () => {
    expect(isCredentialRevealPath({ path: "/settings/security" })).toBe(false);
  });
});

describe("isAdminPath", () => {
  it("admits an account settings page", () => {
    expect(isAdminPath({ path: "/settings/security_analysis" })).toBe(true);
  });

  it("admits an organisation settings page", () => {
    expect(isAdminPath({ path: "/organizations/example-org/settings/profile" })).toBe(true);
  });

  it("admits a repository settings page", () => {
    expect(isAdminPath({ path: "/example-org/example-repo/settings/secrets" })).toBe(true);
  });

  it("refuses ordinary product navigation", () => {
    expect(isAdminPath({ path: "/example-org/example-repo/pulls" })).toBe(false);
  });

  it("refuses a credential-reveal page even though its prefix is admitted", () => {
    expect(isAdminPath({ path: "/settings/tokens/new" })).toBe(false);
  });
});

describe("canonicaliseGithubHref", () => {
  it("drops the fragment, because a fragment is a position rather than a page", () => {
    expect(canonicaliseGithubHref({ href: `${ORIGIN}/settings/profile#bio`, origin: ORIGIN })).toBe(
      "/settings/profile",
    );
  });

  it("sorts the query so two orderings are one destination", () => {
    expect(canonicaliseGithubHref({ href: `${ORIGIN}/settings/repositories?b=2&a=1`, origin: ORIGIN })).toBe(
      "/settings/repositories?a=1&b=2",
    );
  });

  it("returns null for an off-origin link", () => {
    expect(canonicaliseGithubHref({ href: "https://elsewhere.example.test/settings", origin: ORIGIN })).toBe(null);
  });

  it("resolves a relative href against the origin", () => {
    expect(canonicaliseGithubHref({ href: "/settings/emails", origin: ORIGIN })).toBe("/settings/emails");
  });
});

describe("githubSettingsSeeds", () => {
  it("returns a root per organisation and per repository, plus the account root", () => {
    expect(githubSettingsSeeds({ organisations: ["example-org"], repositories: ["example-org/example-repo"] })).toEqual(
      ["/example-org/example-repo/settings", "/organizations/example-org/settings/profile", "/settings/profile"],
    );
  });

  it("returns only the account root when no scope is given", () => {
    expect(githubSettingsSeeds({ organisations: [], repositories: [] })).toEqual(["/settings/profile"]);
  });

  it("de-duplicates a repository named twice", () => {
    expect(
      githubSettingsSeeds({
        organisations: [],
        repositories: ["example-org/example-repo", "example-org/example-repo"],
      }),
    ).toEqual(["/example-org/example-repo/settings", "/settings/profile"]);
  });
});

describe("expandFrontier", () => {
  it("returns admin links that have not been visited", () => {
    expect(
      expandFrontier({
        origin: ORIGIN,
        rendered: [`${ORIGIN}/settings/security`, `${ORIGIN}/settings/emails`],
        visited: new Set(["/settings/emails"]),
      }),
    ).toEqual(["/settings/security"]);
  });

  it("drops off-origin links", () => {
    expect(
      expandFrontier({
        origin: ORIGIN,
        rendered: ["https://elsewhere.example.test/settings/security"],
        visited: new Set(),
      }),
    ).toEqual([]);
  });

  it("drops a credential-reveal page", () => {
    expect(expandFrontier({ origin: ORIGIN, rendered: [`${ORIGIN}/settings/tokens/new`], visited: new Set() })).toEqual(
      [],
    );
  });

  it("de-duplicates a link rendered on two pages", () => {
    expect(
      expandFrontier({
        origin: ORIGIN,
        rendered: [`${ORIGIN}/settings/security`, `${ORIGIN}/settings/security#top`],
        visited: new Set(),
      }),
    ).toEqual(["/settings/security"]);
  });

  it("returns nothing when every rendered link was already visited", () => {
    expect(
      expandFrontier({
        origin: ORIGIN,
        rendered: [`${ORIGIN}/settings/security`],
        visited: new Set(["/settings/security"]),
      }),
    ).toEqual([]);
  });
});
