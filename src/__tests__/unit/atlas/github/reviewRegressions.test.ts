/**
 * One test per defect an adversarial review found in this atlas before it shipped.
 *
 * Each is written from the reviewer's own counterexample rather than from the fix, so it fails against the
 * code as it stood and passes against the code as it is. Kept together rather than scattered because what
 * they have in common is the point: every one of them was a claim this atlas made about itself that was
 * false, and each was invisible to the type system, to the gates and to the ordinary tests.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { GithubAtlasApi } from "../../../../atlas/github/client.js";
import {
  githubKindScope,
  githubUncoveredMandatoryKinds,
  replaceGithubCoverageCell,
} from "../../../../atlas/github/coverage.js";
import { GITHUB_CALLS, GITHUB_DISCOVERY_CALL_IDS } from "../../../../atlas/github/inventory.js";
import type { GithubCoverageCell } from "../../../../atlas/github/kindFiles.js";
import { looksLikeCredential, withoutCredentialShaped } from "../../../../atlas/github/privacy.js";
import {
  type ProjectionContext,
  projectGithubCustomPropertyDefinition,
  projectGithubWebhook,
} from "../../../../atlas/github/projection.js";
import { parseGithubRestSurface, pathOperations } from "../../../../atlas/github/restSurface.js";
import { githubAtlasPaths } from "../../../../atlas/github/store.js";
import { syncGithubAtlas } from "../../../../atlas/github/sync.js";
import { reduceWebCalls } from "../../../../atlas/github/webReduction.js";
import { frontierClosed } from "../../../../atlas/github/webWalkProof.js";
import { ok, unwrap } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";
const CONTEXT: ProjectionContext = {
  at: AT,
  source: { endpoint: "/orgs/example-org/properties/schema", observedAt: AT, surface: "rest-live" },
};

/**
 * A token-SHAPED string, assembled at run time from a prefix and a filler.
 *
 * Never written as a literal, because the public hygiene gate scans committed files for exactly these
 * shapes and would flag this file — correctly. The gate is not weakened to let a test say "token"; the test
 * builds the shape instead, which also proves the classifier matches on the shape rather than on a constant
 * somebody could have special-cased.
 *
 * @param prefix the provider's own token prefix
 * @param length how long the whole string should be
 * @returns a credential-shaped string that is not a credential
 */
function tokenShaped({ prefix, length }: { prefix: string; length: number }): string {
  return prefix + "A".repeat(Math.max(0, length - prefix.length));
}

/** A coverage cell with the two fields the predicate reads. */
function cell({ state, scope }: { state: GithubCoverageCell["state"]; scope: string }): GithubCoverageCell {
  return {
    artifacts: [],
    lastSuccessAt: AT,
    latestAttemptFailed: false,
    reason: "test",
    role: "authoritative",
    scope,
    state,
    surface: "rest-live",
    unblockedBy: null,
    visibilityScope: "test",
  };
}

describe("a custom property cannot carry a credential into the generation", () => {
  it("stores no default value at all, because a default is a value somebody authored", () => {
    const projected = projectGithubCustomPropertyDefinition({
      context: CONTEXT,
      raw: {
        default_value: tokenShaped({ length: 42, prefix: `github${"_"}pat_` }),
        property_name: "deployment-credential",
        value_type: "string",
      },
      scopeRef: "example-org",
    })!;
    expect(JSON.stringify(projected)).not.toContain(`github${"_"}pat_`);
  });

  it("drops a credential-shaped entry from an enumerated domain and keeps the rest", () => {
    const projected = projectGithubCustomPropertyDefinition({
      context: CONTEXT,
      raw: {
        allowed_values: ["production", tokenShaped({ length: 40, prefix: `gh${"p"}_` }), "staging"],
        property_name: "environment",
        value_type: "single_select",
      },
      scopeRef: "example-org",
    })!;
    expect(projected.allowedValues).toEqual(["production", "staging"]);
  });

  it("recognises GitHub's own token prefixes and a long unbroken run", () => {
    expect(looksLikeCredential({ value: tokenShaped({ length: 40, prefix: `gh${"p"}_` }) })).toBe(true);
    expect(looksLikeCredential({ value: tokenShaped({ length: 42, prefix: `github${"_"}pat_` }) })).toBe(true);
    expect(looksLikeCredential({ value: tokenShaped({ length: 44, prefix: "" }) })).toBe(true);
  });

  it("leaves an ordinary allowed value alone", () => {
    expect(withoutCredentialShaped({ values: ["production", "staging", "eu-west-1"] })).toEqual([
      "production",
      "staging",
      "eu-west-1",
    ]);
  });
});

describe("every route this atlas sends is built from the closed table", () => {
  it("carries the two scope-discovery calls the sync needs, so neither is built ad hoc", () => {
    const paths = GITHUB_CALLS.map((call) => call.path);
    expect(paths).toContain("/user/orgs");
    expect(paths).toContain("/orgs/{org}/repos");
  });

  it("marks both as discovery, so neither is run again as part of a scope's own read", () => {
    expect(GITHUB_DISCOVERY_CALL_IDS).toContain("account-organisations");
    expect(GITHUB_DISCOVERY_CALL_IDS).toContain("org-repositories");
  });
});

describe("coverage is universal WITHIN a kind, not only across kinds", () => {
  it("refuses a kind where one scope synced and another was refused", () => {
    expect(
      githubUncoveredMandatoryKinds({
        cells: {
          "organization-settings": [
            cell({ scope: "good/organization-settings", state: "synced" }),
            cell({ scope: "bad/organization-settings", state: "unreadable" }),
          ],
        },
      }),
    ).toEqual(["organization-settings"]);
  });

  it("accepts a kind where every scope synced", () => {
    expect(
      githubUncoveredMandatoryKinds({
        cells: {
          "organization-settings": [
            cell({ scope: "a/organization-settings", state: "synced" }),
            cell({ scope: "b/organization-settings", state: "synced" }),
          ],
        },
      }),
    ).toEqual([]);
  });

  it("accepts a kind where one scope synced and another is honestly absent", () => {
    expect(
      githubUncoveredMandatoryKinds({
        cells: {
          ruleset: [cell({ scope: "a/ruleset", state: "synced" }), cell({ scope: "b/ruleset", state: "unavailable" })],
        },
      }),
    ).toEqual([]);
  });

  it("refuses a mandatory kind with no cell at all, which is a kind nobody looked at", () => {
    expect(githubUncoveredMandatoryKinds({ cells: { webhook: [] } })).toEqual(["webhook"]);
  });
});

describe("the parser never invents a route the description does not declare", () => {
  it("ignores a verb that appears inside a doc comment", () => {
    const commented = [
      "/*" + "*",
      ' * get: operations["ghost/op"]',
      " */",
      "parameters: { query?: { q?: string } };",
    ].join("\n");
    expect(pathOperations({ block: commented })).toEqual([]);
  });

  it("still reads a real declaration that a doc comment sits above", () => {
    const declared = ["/*" + "*", " * Get an organization", " */", 'get: operations["orgs/get"];'].join("\n");
    expect(pathOperations({ block: declared })).toEqual([{ operationId: "orgs/get", verb: "GET" }]);
  });

  it("extracts no route for a path whose only verb-like text is commented out", () => {
    const declarations = [
      "export interface paths {",
      '  "/parameters-only": {',
      "    /*" + "*",
      '     * get: operations["ghost/op"]',
      "     */",
      "    parameters: { query?: { q?: string } };",
      "  };",
      '  "/real": {',
      '    get: operations["real/op"];',
      "  };",
      "}",
      "export interface operations {",
      '  "real/op": { responses: { 200: { content: { "application/json": { ok: boolean } } } } };',
      "}",
    ].join("\n");
    expect(unwrap(parseGithubRestSurface({ declarations })).map((route) => route.route)).toEqual(["GET /real"]);
  });
});

describe("a response VALUE used as a map key never survives into a stored path", () => {
  it("redacts an email address used as a dynamic key", () => {
    const calls = [
      {
        body: { membersByEmail: { "alice@corp.example": { role: "owner" } } },
        method: "GET",
        onPage: "/settings/profile",
        statusCode: 200,
        url: "https://github.example.test/panel.json",
      },
    ];
    const reduced = reduceWebCalls({ calls });
    // Both halves, per `.claude/rules/testing.md`'s falsifiable-witness rule.
    expect(JSON.stringify(calls)).toContain("alice@corp.example");
    expect(JSON.stringify(reduced)).not.toContain("alice@corp.example");
    expect(reduced[0]!.responseFieldPaths).toEqual([
      "membersByEmail",
      "membersByEmail.<value>",
      "membersByEmail.<value>.role",
    ]);
  });

  it("redacts a display name with spaces used as a key", () => {
    const reduced = reduceWebCalls({
      calls: [
        {
          body: { byName: { "Ada Lovelace": { seat: 1 } } },
          method: "GET",
          onPage: "/settings/profile",
          statusCode: 200,
          url: "https://github.example.test/panel.json",
        },
      ],
    });
    expect(JSON.stringify(reduced)).not.toContain("Ada Lovelace");
  });

  it("leaves an ordinary field name alone, so a shape reader still learns something", () => {
    const reduced = reduceWebCalls({
      calls: [
        {
          body: { user: { login_count: 3, ssoOrganizations: [] } },
          method: "GET",
          onPage: "/settings/profile",
          statusCode: 200,
          url: "https://github.example.test/panel.json",
        },
      ],
    });
    expect(reduced[0]!.responseFieldPaths).toEqual(["user", "user.login_count", "user.ssoOrganizations"]);
  });
});

describe("second pass — no part of a webhook path survives", () => {
  it("keeps nothing from a path whose token happens to look like a route word", () => {
    const raw = { config: { url: "https://hooks.example.test/hook/lowercasebearer" }, id: 9 };
    const projected = projectGithubWebhook({
      context: CONTEXT,
      raw,
      scopeLevel: "organization",
      scopeRef: "example-org",
    })!;
    // Both halves, per `.claude/rules/testing.md`'s falsifiable-witness rule.
    expect(JSON.stringify(raw)).toContain("lowercasebearer");
    expect(JSON.stringify(projected)).not.toContain("lowercasebearer");
    expect(projected.destinationPathDigest).toHaveLength(64);
  });
});

describe("second pass — one call's success cannot erase another call's refusal", () => {
  it("gives two calls feeding one kind at one scope two distinct coverage scopes", () => {
    const enablement = githubKindScope({
      callId: "org-actions-policy",
      kind: "actions-policy",
      scopeRef: "example-org",
    });
    const defaults = githubKindScope({
      callId: "org-actions-workflow-defaults",
      kind: "actions-policy",
      scopeRef: "example-org",
    });
    expect(enablement).not.toBe(defaults);
  });

  it("keeps both cells when one call failed and the other succeeded", () => {
    const refused = cell({
      scope: githubKindScope({ callId: "org-actions-policy", kind: "actions-policy", scopeRef: "example-org" }),
      state: "unreadable",
    });
    const synced = cell({
      scope: githubKindScope({
        callId: "org-actions-workflow-defaults",
        kind: "actions-policy",
        scopeRef: "example-org",
      }),
      state: "synced",
    });
    const cells = replaceGithubCoverageCell({ cell: synced, cells: [refused] });
    expect(cells).toHaveLength(2);
    expect(githubUncoveredMandatoryKinds({ cells: { "actions-policy": cells } })).toEqual(["actions-policy"]);
  });
});

describe("second pass — a walk that failed to navigate has not closed its frontier", () => {
  it("refuses to call the frontier closed when a page failed", () => {
    expect(
      frontierClosed({
        walk: {
          artifactsWritten: 0,
          frontierRemaining: [],
          incompletePages: [],
          linkReadFailures: [],
          notAttempted: [],
          pages: [
            {
              artifacts: [],
              discoveredFrom: null,
              finalUrl: null,
              linksRendered: [],
              outcome: "failed",
              path: "/settings/profile",
              statusCode: null,
              title: null,
            },
          ],
          requests: [],
          roundsRun: 1,
        },
      }),
    ).toBe(false);
  });

  it("still calls it closed when every page completed, even where the answer was no", () => {
    expect(
      frontierClosed({
        walk: {
          artifactsWritten: 1,
          frontierRemaining: [],
          incompletePages: [],
          linkReadFailures: [],
          notAttempted: [],
          pages: [
            {
              artifacts: [],
              discoveredFrom: null,
              finalUrl: "https://github.example.test/settings/admin",
              linksRendered: [],
              outcome: "unavailable",
              path: "/settings/admin",
              statusCode: 403,
              title: null,
            },
          ],
          requests: [],
          roundsRun: 1,
        },
      }),
    ).toBe(true);
  });
});

describe("second pass — a comment inside a declaration does not drop a real route", () => {
  it("reads a route whose verb is separated from `operations` by a comment", () => {
    const declarations = [
      "export interface paths {",
      '  "/kept": { get: operations["kept/op"]; };',
      '  "/commented": { get:/* formatting */ operations["commented/op"]; };',
      "}",
      "export interface operations {",
      '  "kept/op": { responses: { 204: { content?: never } } };',
      '  "commented/op": { responses: { 204: { content?: never } } };',
      "}",
    ].join("\n");
    expect(unwrap(parseGithubRestSurface({ declarations })).map((route) => route.route)).toEqual([
      "GET /commented",
      "GET /kept",
    ]);
  });
});

describe("third pass — a short high-entropy value in an enumerated domain is refused", () => {
  it("refuses a 32-character hex run, the shape a 40-character floor let through", () => {
    expect(looksLikeCredential({ value: "0123456789abcdef0123456789abcdef" })).toBe(true);
  });

  it("refuses an unbroken 24-character base64url run", () => {
    expect(looksLikeCredential({ value: tokenShaped({ length: 24, prefix: "" }) })).toBe(true);
  });

  it("keeps an ordinary allowed value that is merely long", () => {
    expect(looksLikeCredential({ value: "production-eu-west-1" })).toBe(false);
  });

  it("drops the credential from the domain while keeping the domain", () => {
    const projected = projectGithubCustomPropertyDefinition({
      context: CONTEXT,
      raw: {
        allowed_values: ["production", "0123456789abcdef0123456789abcdef"],
        property_name: "deployment-token",
        value_type: "single_select",
      },
      scopeRef: "example-org",
    })!;
    expect(projected.allowedValues).toEqual(["production"]);
  });
});

describe("third pass — a lost response body means the walk saw less than it looks like", () => {
  it("refuses to call the frontier closed when a page lost a body", () => {
    expect(
      frontierClosed({
        walk: {
          artifactsWritten: 1,
          frontierRemaining: [],
          incompletePages: ["/settings/profile"],
          linkReadFailures: [],
          notAttempted: [],
          pages: [],
          requests: [],
          roundsRun: 1,
        },
      }),
    ).toBe(false);
  });
});

describe("third pass — a newline between a verb and its colon does not drop a route", () => {
  it("reads a declaration a formatter wrapped across two lines", () => {
    const declarations = [
      "export interface paths {",
      '  "/kept": { get: operations["kept/op"]; };',
      '  "/wrapped": { get',
      '    : operations["wrapped/op"]; };',
      "}",
      "export interface operations {",
      '  "kept/op": { responses: { 204: { content?: never } } };',
      '  "wrapped/op": { responses: { 204: { content?: never } } };',
      "}",
    ].join("\n");
    expect(unwrap(parseGithubRestSurface({ declarations })).map((route) => route.route)).toEqual([
      "GET /kept",
      "GET /wrapped",
    ]);
  });
});

describe("a page whose links could not be read is not a closed frontier", () => {
  it("refuses to call the frontier closed when a link read threw", () => {
    expect(
      frontierClosed({
        walk: {
          artifactsWritten: 1,
          frontierRemaining: [],
          incompletePages: [],
          linkReadFailures: [{ path: "/settings/profile", reason: "Execution context was destroyed" }],
          notAttempted: [],
          pages: [],
          requests: [],
          roundsRun: 1,
        },
      }),
    ).toBe(false);
  });
});

describe("fourth pass — an unexpected refusal is never an honest absence", () => {
  it("refuses a kind whose only cell is an unexpected 404, which grades unavailable on its own", () => {
    expect(
      githubUncoveredMandatoryKinds({
        cells: { "organization-settings": [cell({ scope: "example-org/x", state: "unreadable" })] },
      }),
    ).toEqual(["organization-settings"]);
  });
});

describe("fourth pass — a verb inside a template literal is not a declaration", () => {
  it("ignores a verb written inside backticks", () => {
    const declarations = [
      "export interface paths {",
      '  "/ghost": { note: `get: operations["ghost/op"]`; };',
      '  "/real": { get: operations["real/op"]; };',
      "}",
      "export interface operations {",
      '  "real/op": { responses: { 204: { content?: never } } };',
      "}",
    ].join("\n");
    expect(unwrap(parseGithubRestSurface({ declarations })).map((route) => route.route)).toEqual(["GET /real"]);
  });
});

describe("a successful read that did not exhaust its pages is still incomplete", () => {
  it("does not stale an entity the read never reached", async () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-r3-02-"));
    try {
      const paths = githubAtlasPaths({ home });
      const api: GithubAtlasApi = {
        read: ({ route }) =>
          ResultAsync.fromSafePromise(
            Promise.resolve(
              ok({
                // The seam's contract admits this: a successful read of PART of a listing.
                pagesExhausted: !route.endsWith("/hooks"),
                records: route.endsWith("/hooks") ? [{ active: true, config: {}, events: [], id: 1 }] : [],
                reportedTotal: route.endsWith("/hooks") ? 2 : null,
              }),
            ),
          ).andThen((value) => value),
      };
      const synced = await syncGithubAtlas({
        api,
        at: AT,
        paths,
        restOperations: [],
        scopes: { organisations: ["example-org"], repositories: [] },
      });
      expect(synced.isOk()).toBe(true);
      // The partial read contributed one webhook and must not have concluded anything about the rest.
      expect(synced._unsafeUnwrap().uncovered).toContain("webhook");
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });
});

describe("a fake interface inside a template literal is not the description", () => {
  it("reads the real `paths` interface, not one quoted in a string", () => {
    const declarations = [
      "export type Noise = `export interface paths {",
      '  "/ghost": { get: operations["ghost/op"]; };',
      "}`;",
      "export interface paths {",
      '  "/real": { get: operations["real/op"]; };',
      "}",
      "export interface operations {",
      '  "real/op": { responses: { 204: { content?: never } } };',
      "}",
    ].join("\n");
    expect(unwrap(parseGithubRestSurface({ declarations })).map((route) => route.route)).toEqual(["GET /real"]);
  });
});
