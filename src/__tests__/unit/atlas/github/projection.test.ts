/**
 * The projections: which fields survive, which are transformed, and which are dropped on the floor.
 *
 * The dropped ones carry the most weight. A variable's VALUE is returned by GitHub and must not reach the
 * store; a deploy key's material must become a fingerprint; a webhook's URL must lose anything that could
 * be a credential. Each has a test that would fail if the field came back, which is a stronger statement
 * than a comment saying it does not.
 */
import { describe, expect, it } from "vitest";

import {
  declaredSdkMethod,
  type ProjectionContext,
  projectGithubAppInstallation,
  projectGithubDeployKey,
  projectGithubOrganizationSettings,
  projectGithubRepositorySecuritySettings,
  projectGithubRuleset,
  projectGithubVariableName,
  projectGithubWebhook,
} from "../../../../atlas/github/projection.js";

const AT = "2026-09-05T00:00:00.000Z";
const CONTEXT: ProjectionContext = {
  at: AT,
  source: { endpoint: "/orgs/example-org", observedAt: AT, surface: "rest-live" },
};

describe("projectGithubOrganizationSettings", () => {
  it("keeps the administrative switches a surface map is for", () => {
    const projected = projectGithubOrganizationSettings({
      context: CONTEXT,
      raw: {
        default_repository_permission: "read",
        login: "example-org",
        two_factor_requirement_enabled: true,
      },
      scopeRef: "example-org",
    })!;
    expect(projected.defaultRepositoryPermission).toBe("read");
    expect(projected.twoFactorRequirementEnabled).toBe(true);
    expect(projected.scopeLevel).toBe("organization");
  });

  it("records an absent administrative field as null, which means this token did not see it", () => {
    const projected = projectGithubOrganizationSettings({
      context: CONTEXT,
      raw: { login: "example-org" },
      scopeRef: "example-org",
    })!;
    expect(projected.twoFactorRequirementEnabled).toBe(null);
  });

  it("returns null for a body carrying no login", () => {
    expect(projectGithubOrganizationSettings({ context: CONTEXT, raw: {}, scopeRef: "example-org" })).toBe(null);
  });
});

describe("projectGithubVariableName", () => {
  it("DROPS the value GitHub returns", () => {
    const projected = projectGithubVariableName({
      context: CONTEXT,
      raw: { name: "DEPLOY_TARGET", value: "https://internal.example.test/prod" },
      scopeLevel: "organization",
      scopeRef: "example-org",
    })!;
    expect(projected.name).toBe("DEPLOY_TARGET");
    expect(JSON.stringify(projected)).not.toContain("internal.example.test");
  });

  it("keeps which repositories may use it, by id", () => {
    const projected = projectGithubVariableName({
      context: CONTEXT,
      raw: { name: "X", selected_repositories: [{ id: 7 }, { id: 3 }] },
      scopeLevel: "organization",
      scopeRef: "example-org",
    })!;
    expect(projected.selectedRepositoryIds).toEqual(["3", "7"]);
  });
});

describe("projectGithubWebhook", () => {
  it("reduces the destination to an origin and a path shape", () => {
    const raw = {
      active: true,
      config: { content_type: "json", url: "https://hooks.example.test/services/T0000000" },
      events: ["push"],
      id: 9,
    };
    const projected = projectGithubWebhook({
      context: CONTEXT,
      raw,
      scopeLevel: "organization",
      scopeRef: "example-org",
    })!;
    expect(projected.destinationOrigin).toBe("https://hooks.example.test");
    expect(projected.destinationPathDigest).toHaveLength(64);
    // Both halves, per `.claude/rules/testing.md`'s falsifiable-witness rule.
    expect(JSON.stringify(raw)).toContain("T0000000");
    expect(JSON.stringify(projected)).not.toContain("T0000000");
  });

  it("reads GitHub's string insecure_ssl as the boolean it means", () => {
    const projected = projectGithubWebhook({
      context: CONTEXT,
      raw: { config: { insecure_ssl: "1" }, id: 9 },
      scopeLevel: "organization",
      scopeRef: "example-org",
    })!;
    expect(projected.insecureSsl).toBe(true);
  });
});

describe("projectGithubDeployKey", () => {
  it("stores a fingerprint and never the key material", () => {
    const projected = projectGithubDeployKey({
      context: CONTEXT,
      raw: { id: 4, key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyMaterial", read_only: false, title: "ci" },
      scopeRef: "example-org/example-repo",
    })!;
    expect(projected.publicKeyFingerprint).toHaveLength(64);
    expect(projected.readOnly).toBe(false);
    expect(JSON.stringify(projected)).not.toContain("AAAAC3NzaC1lZDI1NTE5");
  });

  it("returns null when there is no key to fingerprint", () => {
    expect(projectGithubDeployKey({ context: CONTEXT, raw: { id: 4 }, scopeRef: "example-org/example-repo" })).toBe(
      null,
    );
  });
});

describe("timestamp normalisation", () => {
  it("normalises a provider timestamp carrying an offset to UTC", () => {
    const projected = projectGithubRuleset({
      context: CONTEXT,
      raw: { enforcement: "active", id: 3, name: "x", updated_at: "2026-09-05T10:30:00+10:00" },
      scopeLevel: "organization",
      scopeRef: "example-org",
    })!;
    expect(projected.updatedAt).toBe("2026-09-05T00:30:00.000Z");
  });

  it("passes a UTC timestamp through unchanged in meaning", () => {
    const projected = projectGithubRuleset({
      context: CONTEXT,
      raw: { enforcement: "active", id: 3, name: "x", updated_at: "2026-09-05T00:30:00Z" },
      scopeLevel: "organization",
      scopeRef: "example-org",
    })!;
    expect(projected.updatedAt).toBe("2026-09-05T00:30:00.000Z");
  });

  it("records a value that is not a time as absent rather than storing it", () => {
    const projected = projectGithubRuleset({
      context: CONTEXT,
      raw: { enforcement: "active", id: 3, name: "x", updated_at: "not a time" },
      scopeLevel: "organization",
      scopeRef: "example-org",
    })!;
    expect(projected.updatedAt).toBe(null);
  });
});

describe("projectGithubRuleset", () => {
  it("keeps rule TYPES and bypass actor ids, not the actors themselves", () => {
    const projected = projectGithubRuleset({
      context: CONTEXT,
      raw: {
        bypass_actors: [{ actor_type: "Team", id: 12 }],
        conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
        enforcement: "active",
        id: 3,
        name: "main protection",
        rules: [{ type: "pull_request" }, { type: "required_status_checks" }],
      },
      scopeLevel: "organization",
      scopeRef: "example-org",
    })!;
    expect(projected.ruleTypes).toEqual(["pull_request", "required_status_checks"]);
    expect(projected.bypassActorIds).toEqual(["12"]);
    expect(projected.conditionKeys).toEqual(["ref_name"]);
  });
});

describe("projectGithubAppInstallation", () => {
  it("keeps the permission LEVELS, which are the whole question", () => {
    const projected = projectGithubAppInstallation({
      context: CONTEXT,
      raw: {
        app_slug: "example-app",
        events: ["push"],
        id: 55,
        permissions: { contents: "write", metadata: "read" },
        repository_selection: "selected",
        repositories: [{ id: 2 }],
      },
      scopeRef: "example-org",
    })!;
    expect(projected.permissions).toEqual({ contents: "write", metadata: "read" });
    expect(projected.repositorySelection).toBe("selected");
    expect(projected.selectedRepositoryIds).toEqual(["2"]);
  });

  it("drops a permission whose level is not a string, rather than storing a shape nobody reviewed", () => {
    const projected = projectGithubAppInstallation({
      context: CONTEXT,
      raw: { app_slug: "example-app", id: 55, permissions: { contents: { nested: true } } },
      scopeRef: "example-org",
    })!;
    expect(projected.permissions).toEqual({});
  });
});

describe("projectGithubRepositorySecuritySettings", () => {
  it("reads the nested security-and-analysis statuses GitHub returns on the repository document", () => {
    const projected = projectGithubRepositorySecuritySettings({
      context: CONTEXT,
      raw: {
        security_and_analysis: {
          secret_scanning: { status: "enabled" },
          secret_scanning_push_protection: { status: "disabled" },
        },
      },
      scopeRef: "example-org/example-repo",
    })!;
    expect(projected.secretScanning).toBe("enabled");
    expect(projected.secretScanningPushProtection).toBe("disabled");
  });

  it("returns null when the repository document carries no security-and-analysis object", () => {
    expect(
      projectGithubRepositorySecuritySettings({ context: CONTEXT, raw: {}, scopeRef: "example-org/example-repo" }),
    ).toBe(null);
  });
});

describe("declaredSdkMethod", () => {
  const sdkMethods: ReadonlyMap<string, string> = new Map([["GET /orgs/{org}", "orgs.get"]]);

  it("names the method the installed Octokit declares for a route", () => {
    expect(declaredSdkMethod({ route: "GET /orgs/{org}", sdkMethods })).toBe("orgs.get");
  });

  it("answers null for a route the installed Octokit declares no method for", () => {
    expect(declaredSdkMethod({ route: "GET /orgs/{org}/hooks", sdkMethods })).toBe(null);
  });
});
