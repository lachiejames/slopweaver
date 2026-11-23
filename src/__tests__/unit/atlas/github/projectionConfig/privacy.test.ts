/*
 * The PRIVACY reductions: a webhook's destination, a secret's and a variable's name without its value, and a deploy
 * key reduced to a fingerprint. None of them may store the credential material GitHub returns.
 *
 * One recorded residue is deliberately NOT asserted here: the literal fallbacks for an ABSENT webhook `active` and
 * deploy-key `read_only`. Each of those fields is only ever asserted where the provider supplied it.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  projectGithubDeployKey,
  projectGithubSecretName,
  projectGithubVariableName,
  projectGithubWebhook,
} from "../../../../../atlas/github/projectionConfig.js";
import { CONTEXT, scopedFields } from "./harness.js";

/** The SHA-256 hex digest of a known input — what the privacy reductions are specified to produce. */
function sha256Hex({ text }: { text: string }): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("projectGithubWebhook", () => {
  const destination = "https://hookuser:hookpass@hooks.example.test/services/T0CFG/hook-secret-token?sig=query-secret";

  it("reduces the destination to an origin and a path digest, reading config fields from the config object", () => {
    const projected = projectGithubWebhook({
      context: CONTEXT,
      raw: {
        active: true,
        config: { content_type: "json-content", insecure_ssl: "1", url: destination },
        content_type: "body-decoy-content",
        events: ["push", "pull_request", "push", ""],
        id: 4401,
        insecure_ssl: "0",
        updated_at: "2026-08-20T23:15:00-02:00",
        url: "https://decoy.example.test/body-level",
      },
      scopeLevel: "repository",
      scopeRef: "acme-config/hooks-repo",
    });
    expect(projected).toEqual({
      ...scopedFields({
        deepLink: null,
        deepLinkStatus: "unavailable",
        kind: "webhook",
        providerId: "4401",
        scopeLevel: "repository",
        scopeRef: "acme-config/hooks-repo",
      }),
      active: true,
      contentType: "json-content",
      destinationOrigin: "https://hooks.example.test",
      destinationPathDigest: sha256Hex({ text: "/services/T0CFG/hook-secret-token?sig=query-secret" }),
      events: ["pull_request", "push"],
      insecureSsl: true,
      updatedAt: "2026-08-21T01:15:00.000Z",
    });
  });

  it("stores none of the destination's credential material", () => {
    const projected = projectGithubWebhook({
      context: CONTEXT,
      raw: { active: true, config: { url: destination }, id: 4402 },
      scopeLevel: "organization",
      scopeRef: "acme-config",
    });
    const stored = JSON.stringify(projected);
    expect(destination).toContain("hook-secret-token");
    expect(stored).not.toContain("hook-secret-token");
    expect(stored).not.toContain("query-secret");
    expect(stored).not.toContain("hookpass");
  });

  it('reads an inactive hook, a secure-ssl string of "0" and an unreadable destination', () => {
    const projected = projectGithubWebhook({
      context: CONTEXT,
      raw: {
        active: false,
        config: { insecure_ssl: "0", url: "not a url at all" },
        id: "hook-string-4403",
      },
      scopeLevel: "organization",
      scopeRef: "acme-config-hooks-org",
    });
    expect(projected).toEqual({
      ...scopedFields({
        deepLink: null,
        deepLinkStatus: "unavailable",
        kind: "webhook",
        providerId: "hook-string-4403",
        scopeLevel: "organization",
        scopeRef: "acme-config-hooks-org",
      }),
      active: false,
      contentType: null,
      destinationOrigin: null,
      destinationPathDigest: null,
      events: [],
      insecureSsl: false,
      updatedAt: null,
    });
  });

  it("reads an absent config as no destination and an unknown ssl setting", () => {
    const projected = projectGithubWebhook({
      context: CONTEXT,
      raw: { active: true, id: 4404, insecure_ssl: "1" },
      scopeLevel: "repository",
      scopeRef: "acme-config/no-config-repo",
    });
    expect(projected).toEqual({
      ...scopedFields({
        deepLink: null,
        deepLinkStatus: "unavailable",
        kind: "webhook",
        providerId: "4404",
        scopeLevel: "repository",
        scopeRef: "acme-config/no-config-repo",
      }),
      active: true,
      contentType: null,
      destinationOrigin: null,
      destinationPathDigest: null,
      events: [],
      insecureSsl: null,
      updatedAt: null,
    });
  });

  it("refuses a hook that is not an object", () => {
    expect(projectGithubWebhook({ context: CONTEXT, raw: "not-a-hook", scopeLevel: "repository", scopeRef: "r" })).toBe(
      null,
    );
  });
});

describe("projectGithubSecretName", () => {
  it("keeps the name, scope, visibility, selected repository ids and timestamps", () => {
    const projected = projectGithubSecretName({
      context: CONTEXT,
      raw: {
        created_at: "2026-08-01T09:00:00Z",
        id: 9901,
        name: "DEPLOY_TOKEN_SECRET",
        selected_repositories: [{ id: 52 }, { id: 17 }, { id: 52 }],
        updated_at: "2026-08-02T10:00:00+01:00",
        visibility: "selected-visibility",
      },
      scopeLevel: "organization",
      scopeRef: "acme-config-secrets-org",
    });
    expect(projected).toEqual({
      ...scopedFields({
        deepLink: null,
        deepLinkStatus: "unavailable",
        kind: "secret-name",
        providerId: "DEPLOY_TOKEN_SECRET",
        scopeLevel: "organization",
        scopeRef: "acme-config-secrets-org",
      }),
      createdAt: "2026-08-01T09:00:00.000Z",
      name: "DEPLOY_TOKEN_SECRET",
      selectedRepositoryIds: ["17", "52"],
      updatedAt: "2026-08-02T09:00:00.000Z",
      visibility: "selected-visibility",
    });
  });

  it("reads absent fields as null or empty", () => {
    const projected = projectGithubSecretName({
      context: CONTEXT,
      raw: { name: "BARE_SECRET" },
      scopeLevel: "repository",
      scopeRef: "acme-config/secrets-repo",
    });
    expect(projected).toEqual({
      ...scopedFields({
        deepLink: null,
        deepLinkStatus: "unavailable",
        kind: "secret-name",
        providerId: "BARE_SECRET",
        scopeLevel: "repository",
        scopeRef: "acme-config/secrets-repo",
      }),
      createdAt: null,
      name: "BARE_SECRET",
      selectedRepositoryIds: [],
      updatedAt: null,
      visibility: null,
    });
  });

  it("refuses a secret with no name, an empty name, or no body", () => {
    const refuse = ({ raw }: { raw: unknown }): unknown =>
      projectGithubSecretName({ context: CONTEXT, raw, scopeLevel: "organization", scopeRef: "acme-config" });
    expect(refuse({ raw: { visibility: "all" } })).toBe(null);
    expect(refuse({ raw: { name: "" } })).toBe(null);
    expect(refuse({ raw: null })).toBe(null);
  });
});

describe("projectGithubVariableName", () => {
  it("keeps the name and scope and DROPS the value GitHub returns", () => {
    const projected = projectGithubVariableName({
      context: CONTEXT,
      raw: {
        created_at: "2026-07-03T11:00:00+02:00",
        name: "RELEASE_CHANNEL_VAR",
        selected_repositories: [{ id: 64 }, { id: 23 }, { id: 64 }],
        updated_at: "2026-07-04T12:15:00Z",
        value: "CONSPICUOUS-VARIABLE-VALUE",
        visibility: "private-visibility",
      },
      scopeLevel: "repository",
      scopeRef: "acme-config/vars-repo",
    });
    expect(projected).toEqual({
      ...scopedFields({
        deepLink: null,
        deepLinkStatus: "unavailable",
        kind: "variable-name",
        providerId: "RELEASE_CHANNEL_VAR",
        scopeLevel: "repository",
        scopeRef: "acme-config/vars-repo",
      }),
      createdAt: "2026-07-03T09:00:00.000Z",
      name: "RELEASE_CHANNEL_VAR",
      selectedRepositoryIds: ["23", "64"],
      updatedAt: "2026-07-04T12:15:00.000Z",
      visibility: "private-visibility",
    });
    expect(Object.keys(projected!)).not.toContain("value");
    expect(JSON.stringify(projected)).not.toContain("CONSPICUOUS-VARIABLE-VALUE");
  });

  it("refuses a variable with no name, an empty name, or no body", () => {
    const refuse = ({ raw }: { raw: unknown }): unknown =>
      projectGithubVariableName({ context: CONTEXT, raw, scopeLevel: "repository", scopeRef: "acme-config/r" });
    expect(refuse({ raw: { value: "orphan-value" } })).toBe(null);
    expect(refuse({ raw: { name: "" } })).toBe(null);
    expect(refuse({ raw: "not-a-body" })).toBe(null);
  });
});

describe("projectGithubDeployKey", () => {
  const keyMaterial = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDeployKeySentinel deploy@config-test";

  it("reduces the key to a fingerprint of its trimmed material and keeps the rest", () => {
    const projected = projectGithubDeployKey({
      context: CONTEXT,
      raw: {
        added_by: "deploy-adder-login",
        created_at: "2026-06-01T08:00:00Z",
        id: 6601,
        key: `  ${keyMaterial}\n`,
        last_used: "2026-06-15T09:30:00-05:00",
        read_only: false,
        title: "ci-deploy-title",
        url: "https://api.github.com/repos/acme-config/keys-repo/keys/6601",
      },
      scopeRef: "acme-config/keys-repo",
    });
    expect(projected).toEqual({
      ...scopedFields({
        deepLink: null,
        deepLinkStatus: "unavailable",
        kind: "deploy-key",
        providerId: "6601",
        scopeLevel: "repository",
        scopeRef: "acme-config/keys-repo",
      }),
      addedBy: "deploy-adder-login",
      createdAt: "2026-06-01T08:00:00.000Z",
      lastUsedAt: "2026-06-15T14:30:00.000Z",
      publicKeyFingerprint: sha256Hex({ text: keyMaterial }),
      readOnly: false,
      title: "ci-deploy-title",
    });
    expect(JSON.stringify(projected)).not.toContain("DeployKeySentinel");
  });

  it("reads the inverse: read-only, no adder, and the fingerprint as the provider id when GitHub gives none", () => {
    const secondKey = "ssh-rsa AAAAB3NzaC1yc2EAAAADSecondKeySentinel second@config-test";
    const project = ({ addedBy }: { addedBy: unknown }): unknown =>
      projectGithubDeployKey({
        context: CONTEXT,
        raw: { added_by: addedBy, key: secondKey, read_only: true },
        scopeRef: "acme-config/second-keys-repo",
      });
    const expected = {
      ...scopedFields({
        deepLink: null,
        deepLinkStatus: "unavailable",
        kind: "deploy-key",
        providerId: sha256Hex({ text: secondKey }),
        scopeLevel: "repository",
        scopeRef: "acme-config/second-keys-repo",
      }),
      addedBy: null,
      createdAt: null,
      lastUsedAt: null,
      publicKeyFingerprint: sha256Hex({ text: secondKey }),
      readOnly: true,
      title: null,
    };
    expect(project({ addedBy: "" })).toEqual(expected);
    expect(project({ addedBy: 4242 })).toEqual(expected);
  });

  it("refuses a key with no material, whitespace-only material, or no body", () => {
    const refuse = ({ raw }: { raw: unknown }): unknown =>
      projectGithubDeployKey({ context: CONTEXT, raw, scopeRef: "acme-config/keys-repo" });
    expect(refuse({ raw: { id: 6602, title: "keyless" } })).toBe(null);
    expect(refuse({ raw: { key: "   " } })).toBe(null);
    expect(refuse({ raw: { key: 6603 } })).toBe(null);
    expect(refuse({ raw: "not-a-body" })).toBe(null);
  });
});
