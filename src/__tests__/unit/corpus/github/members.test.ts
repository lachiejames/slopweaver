import { describe, expect, it } from "vitest";
import { GithubMemberErrors, type GithubSamlError } from "../../../../corpus/github/errors.js";
import {
  collectSamlEmails,
  fetchGithubMembers,
  type GithubMembersApi,
  parseSamlPage,
  projectGithubMember,
} from "../../../../corpus/github/members.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";

const GH_AT = "2026-07-20T00:00:00.000Z";

describe("projectGithubMember", () => {
  it("prefers the SAML SSO email over the public profile email and keeps the raw profile", () => {
    const profile = {
      avatar_url: "https://cdn/av.png",
      email: "public@example.org",
      login: "ada",
      name: "Ada Lovelace",
    };
    const row = projectGithubMember({
      fetchedAtIso: GH_AT,
      profile,
      samlEmail: "ada@example.com",
      stub: { login: "ada" },
    })!;
    expect(row.identity).toEqual({
      email: "ada@example.com",
      emailNormalised: "ada@example.com",
      emailTrust: "trusted",
      handle: "ada",
      name: "Ada Lovelace",
      nativeId: "ada",
      source: "github",
    });
    expect(row.provenance).toEqual(["github.orgs.listMembers", "github.saml"]);
    // FULL raw = the composite of BOTH source calls (the org-membership stub AND the profile), nothing lost.
    expect(row.raw).toEqual({ listMember: { login: "ada" }, profile });
  });

  it("falls back to the public profile email when there is no SAML join", () => {
    const row = projectGithubMember({
      fetchedAtIso: GH_AT,
      profile: { email: "grace@example.com", login: "grace" },
      stub: { login: "grace" },
    })!;
    expect(row.identity.email).toBe("grace@example.com");
    expect(row.provenance).toEqual(["github.orgs.listMembers"]);
  });

  it("warns (no guessed email) when neither SAML nor a public email is available", () => {
    const row = projectGithubMember({ fetchedAtIso: GH_AT, profile: { login: "eng" }, stub: { login: "eng" } })!;
    expect(row.identity.emailTrust).toBe("missing");
    expect(row.warnings).toEqual(["no email — GitHub public profile empty and no SAML SSO email resolved"]);
  });

  it("flags a Bot account", () => {
    const row = projectGithubMember({
      fetchedAtIso: GH_AT,
      profile: { login: "ci", type: "Bot" },
      stub: { login: "ci" },
    })!;
    expect(row.profile.bot).toBe(true);
  });
});

describe("parseSamlPage", () => {
  it("extracts login→nameId pairs and reports the provider present", () => {
    const data = {
      organization: {
        samlIdentityProvider: {
          externalIdentities: {
            nodes: [
              { samlIdentity: { nameId: "ada@example.com" }, user: { login: "ada" } },
              { samlIdentity: {}, user: { login: "x" } },
            ],
            pageInfo: { endCursor: null, hasNextPage: false },
          },
        },
      },
    };
    const page = parseSamlPage({ data });
    expect(page.hasProvider).toBe(true);
    expect(page.pairs).toEqual([["ada", "ada@example.com"]]); // the nameId-less node dropped
    expect(page.nextCursor).toBeUndefined();
  });

  it("reports no provider for a non-SAML org", () => {
    expect(parseSamlPage({ data: { organization: { samlIdentityProvider: null } } })).toEqual({
      hasProvider: false,
      pairs: [],
    });
  });
});

/** A fake GitHub member seam: one page of two members, per-login profiles, a canned SAML result. */
function fakeApi({ saml }: { saml: Result<ReadonlyMap<string, string>, GithubSamlError> }): GithubMembersApi {
  const profiles: Record<string, unknown> = {
    ada: { email: null, login: "ada", name: "Ada Lovelace" },
    grace: { email: "grace@example.com", login: "grace", name: "Grace Hopper" },
  };
  return {
    getUser: async ({ username }) => profiles[username],
    listMembers: async ({ page }) => (page === 1 ? [{ login: "ada" }, { login: "grace" }] : []),
    samlEmails: async () => saml,
  };
}

describe("fetchGithubMembers", () => {
  it("joins SAML emails, enriches profiles, and hydrates one row per member", async () => {
    const saml: Result<ReadonlyMap<string, string>, GithubSamlError> = ok(new Map([["ada", "ada@example.com"]]));
    const result = unwrap(await fetchGithubMembers({ api: fakeApi({ saml }), fetchedAtIso: GH_AT, org: "acme" }));
    expect(result.rows.map((r) => r.sourceId)).toEqual(["ada", "grace"]);
    expect(result.rows.map((r) => r.identity.email)).toEqual(["ada@example.com", "grace@example.com"]);
  });

  it("degrades to public/login-only with a warning when the org is not SAML-backed", async () => {
    const saml: Result<ReadonlyMap<string, string>, GithubSamlError> = err(GithubMemberErrors.samlNoProvider());
    const result = unwrap(await fetchGithubMembers({ api: fakeApi({ saml }), fetchedAtIso: GH_AT, org: "acme" }));
    expect(result.warnings).toContain(
      "github: no SAML external identities (needs an org-admin token + a SAML org) — emails limited to public profile",
    );
    expect(result.rows.find((r) => r.sourceId === "ada")!.identity.emailTrust).toBe("missing"); // no guessed email
  });
});

describe("collectSamlEmails", () => {
  /** One page of the SAML shape, with an optional next cursor. */
  function samlPage({ login, email, after }: { login: string; email: string; after: string | undefined }): unknown {
    return {
      organization: {
        samlIdentityProvider: {
          externalIdentities: {
            nodes: [{ samlIdentity: { nameId: email }, user: { login } }],
            pageInfo: { endCursor: after, hasNextPage: after !== undefined },
          },
        },
      },
    };
  }

  it("sends the EXACT query and variables, threading the cursor onto the second page only", async () => {
    // `GithubGraphql` is positional because it mirrors `@octokit/graphql`, so dropping `variables` — or
    // failing to thread `after` — still typechecks and still passes any fake that ignores its arguments.
    // Asserted by exact value, because that is the only thing standing between this seam and a silent
    // single-page truncation: page one must carry NO `after`, page two must carry the previous cursor.
    const calls: { query: string; variables: Record<string, unknown> }[] = [];
    const result = await collectSamlEmails({
      graphql: async (query, variables) => {
        calls.push({ query, variables });
        return calls.length === 1
          ? samlPage({ after: "CUR1", email: "ada@x.test", login: "ada" })
          : samlPage({ after: undefined, email: "grace@x.test", login: "grace" });
      },
      org: "acme",
    });

    expect(result.isOk()).toBe(true);
    expect([...unwrap(result)]).toEqual([
      ["ada", "ada@x.test"],
      ["grace", "grace@x.test"],
    ]);
    expect(calls.map((c) => c.variables)).toEqual([{ org: "acme" }, { after: "CUR1", org: "acme" }]);
    expect(calls[0]!.query).toContain("externalIdentities(first:100,after:$after)");
    expect(calls[0]!.query).toBe(calls[1]!.query);
  });

  it("errs with a token-shaped explanation when the org has no SAML provider", async () => {
    const result = await collectSamlEmails({
      graphql: async () => ({ organization: {} }),
      org: "acme",
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("no SAML external identities");
  });

  it("errs (never throws) when the transport throws", async () => {
    const result = await collectSamlEmails({
      graphql: async () => {
        throw new Error("bad credentials");
      },
      org: "acme",
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("bad credentials");
  });
});
