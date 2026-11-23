/**
 * The extension-point projections: custom property definitions, custom repository roles, app
 * installations and repository labels.
 *
 * Each kind has its own organisation, provider id, name and timestamps, and inside one row every source
 * field carries a distinct sentinel — event names and repository ids are disjoint, the three timestamps are
 * three different instants — so a projection reading the wrong key produces a visibly wrong row. Absent
 * collections are never asserted here: an absent `permissions` or `repositories` reads as empty today, and
 * pinning that would bless a collapse of "not seen" into "none".
 */
import { describe, expect, it } from "vitest";

import type {
  GithubAppInstallation,
  GithubCustomPropertyDefinition,
  GithubCustomRepositoryRole,
  GithubRepositoryLabel,
} from "../../../../atlas/github/entities.js";
import { githubEntityId } from "../../../../atlas/github/identity.js";
import type { ProjectionContext } from "../../../../atlas/github/projectionBase.js";
import {
  projectGithubAppInstallation,
  projectGithubCustomPropertyDefinition,
  projectGithubCustomRepositoryRole,
  projectGithubRepositoryLabel,
} from "../../../../atlas/github/projectionConfigExtensions.js";

const CONTEXT: ProjectionContext = {
  at: "2026-08-11T11:11:11.000Z",
  source: {
    endpoint: "GET /orgs/extension-endpoint-sentinel",
    observedAt: "2026-08-12T12:12:12.000Z",
    surface: "rest-live",
  },
};

/** The source block every row carries when the provider hands back no deep link. */
const SOURCE_WITHOUT_LINK: GithubAppInstallation["source"] = {
  artifacts: [],
  deepLink: null,
  deepLinkStatus: "unavailable",
  endpoint: "GET /orgs/extension-endpoint-sentinel",
  observedAt: "2026-08-12T12:12:12.000Z",
  surface: "rest-live",
};

/** A 32-character hex run, which the credential screen refuses. */
const HEX_CREDENTIAL = "0123456789abcdef0123456789abcdef";

describe("projectGithubCustomPropertyDefinition", () => {
  const PROPERTY_ORG = "property-org-sentinel";

  it("projects every named field, keyed by the property name rather than any numeric id", () => {
    const expected: GithubCustomPropertyDefinition = {
      allowedValues: ["alpha-value", "zulu-value"],
      description: "property-description-sentinel",
      firstSeenAt: "2026-08-11T11:11:11.000Z",
      id: githubEntityId({
        kind: "custom-property-definition",
        providerId: "cost-centre-property",
        scopeRef: PROPERTY_ORG,
      }),
      propertyName: "cost-centre-property",
      providerId: "cost-centre-property",
      required: true,
      scopeLevel: "organization",
      scopeRef: PROPERTY_ORG,
      source: SOURCE_WITHOUT_LINK,
      state: "observed",
      valueType: "single_select",
      valuesEditableBy: "org_and_repo_actors",
    };
    expect(
      projectGithubCustomPropertyDefinition({
        context: CONTEXT,
        raw: {
          allowed_values: ["zulu-value", "alpha-value", "zulu-value", HEX_CREDENTIAL],
          default_value: "default-value-must-not-survive",
          description: "property-description-sentinel",
          id: 5550,
          property_name: "cost-centre-property",
          required: true,
          value_type: "single_select",
          values_editable_by: "org_and_repo_actors",
        },
        scopeRef: PROPERTY_ORG,
      }),
    ).toEqual(expected);
  });

  it("keeps an explicit `required: false` as false, and an absent one as null", () => {
    const optional = projectGithubCustomPropertyDefinition({
      context: CONTEXT,
      raw: { property_name: "optional-property", required: false, value_type: "string" },
      scopeRef: PROPERTY_ORG,
    })!;
    const unseen = projectGithubCustomPropertyDefinition({
      context: CONTEXT,
      raw: { property_name: "unseen-property", value_type: "true_false" },
      scopeRef: PROPERTY_ORG,
    })!;
    expect(optional.required).toBe(false);
    expect(unseen.required).toBe(null);
    expect(unseen.description).toBe(null);
    expect(unseen.valuesEditableBy).toBe(null);
  });

  it("returns null for a body with no property name, an empty one, no value type, or no record at all", () => {
    const scopeRef = PROPERTY_ORG;
    expect(projectGithubCustomPropertyDefinition({ context: CONTEXT, raw: { value_type: "string" }, scopeRef })).toBe(
      null,
    );
    expect(
      projectGithubCustomPropertyDefinition({
        context: CONTEXT,
        raw: { property_name: "", value_type: "string" },
        scopeRef,
      }),
    ).toBe(null);
    expect(
      projectGithubCustomPropertyDefinition({ context: CONTEXT, raw: { property_name: "typeless" }, scopeRef }),
    ).toBe(null);
    expect(projectGithubCustomPropertyDefinition({ context: CONTEXT, raw: ["cost-centre-property"], scopeRef })).toBe(
      null,
    );
    expect(projectGithubCustomPropertyDefinition({ context: CONTEXT, raw: null, scopeRef })).toBe(null);
  });
});

describe("projectGithubCustomRepositoryRole", () => {
  const ROLE_ORG = "role-org-sentinel";

  it("projects a role keyed by its numeric id, with its permissions sorted and de-duplicated", () => {
    const expected: GithubCustomRepositoryRole = {
      baseRole: "read",
      description: "role-description-sentinel",
      firstSeenAt: "2026-08-11T11:11:11.000Z",
      id: githubEntityId({ kind: "custom-repository-role", providerId: "7301", scopeRef: ROLE_ORG }),
      name: "security-auditor-role",
      permissions: ["read_audit_logs", "write_code_scanning"],
      providerId: "7301",
      scopeLevel: "organization",
      scopeRef: ROLE_ORG,
      source: SOURCE_WITHOUT_LINK,
      state: "observed",
    };
    expect(
      projectGithubCustomRepositoryRole({
        context: CONTEXT,
        raw: {
          base_role: "read",
          description: "role-description-sentinel",
          id: 7301,
          name: "security-auditor-role",
          permissions: ["write_code_scanning", "read_audit_logs", "write_code_scanning", 12],
        },
        scopeRef: ROLE_ORG,
      }),
    ).toEqual(expected);
  });

  it("falls back to the role name as provider id when the body carries no id", () => {
    const expected: GithubCustomRepositoryRole = {
      baseRole: null,
      description: null,
      firstSeenAt: "2026-08-11T11:11:11.000Z",
      id: githubEntityId({ kind: "custom-repository-role", providerId: "idless-role", scopeRef: ROLE_ORG }),
      name: "idless-role",
      permissions: ["manage_webhooks"],
      providerId: "idless-role",
      scopeLevel: "organization",
      scopeRef: ROLE_ORG,
      source: SOURCE_WITHOUT_LINK,
      state: "observed",
    };
    expect(
      projectGithubCustomRepositoryRole({
        context: CONTEXT,
        raw: { name: "idless-role", permissions: ["manage_webhooks"] },
        scopeRef: ROLE_ORG,
      }),
    ).toEqual(expected);
  });

  it("returns null for a body with no name, an empty name, or no record at all", () => {
    const scopeRef = ROLE_ORG;
    expect(projectGithubCustomRepositoryRole({ context: CONTEXT, raw: { id: 7302 }, scopeRef })).toBe(null);
    expect(projectGithubCustomRepositoryRole({ context: CONTEXT, raw: { id: 7303, name: "" }, scopeRef })).toBe(null);
    expect(projectGithubCustomRepositoryRole({ context: CONTEXT, raw: "security-auditor-role", scopeRef })).toBe(null);
  });
});

describe("projectGithubAppInstallation", () => {
  const INSTALLATION_ORG = "installation-org-sentinel";
  const HTML_URL = "https://github.com/organizations/installation-org-sentinel/settings/installations/88001";

  it("projects the grant whole, normalises each timestamp and keeps repository ids only", () => {
    const expected: GithubAppInstallation = {
      appSlug: "renovate-sentinel-app",
      createdAt: "2026-01-02T03:04:05.000Z",
      events: ["pull_request", "push"],
      firstSeenAt: "2026-08-11T11:11:11.000Z",
      id: githubEntityId({ kind: "github-app-installation", providerId: "88001", scopeRef: INSTALLATION_ORG }),
      permissions: { contents: "write", metadata: "read" },
      providerId: "88001",
      repositorySelection: "selected",
      scopeLevel: "organization",
      scopeRef: INSTALLATION_ORG,
      selectedRepositoryIds: ["4002", "repo-string-id-9"],
      source: {
        artifacts: [],
        deepLink: HTML_URL,
        deepLinkStatus: "provider-provided",
        endpoint: "GET /orgs/extension-endpoint-sentinel",
        observedAt: "2026-08-12T12:12:12.000Z",
        surface: "rest-live",
      },
      state: "observed",
      suspendedAt: "2026-05-06T07:08:09.000Z",
      updatedAt: "2026-03-04T03:06:07.000Z",
    };
    expect(
      projectGithubAppInstallation({
        context: CONTEXT,
        raw: {
          app_slug: "renovate-sentinel-app",
          created_at: "2026-01-02T03:04:05Z",
          events: ["push", "pull_request", "push"],
          html_url: HTML_URL,
          id: 88001,
          permissions: { checks: 3, contents: "write", metadata: "read" },
          repositories: [
            { id: "repo-string-id-9", name: "repo-name-decoy-9" },
            { id: 4002, name: "repo-name-decoy" },
          ],
          repository_selection: "selected",
          suspended_at: "2026-05-06T07:08:09Z",
          updated_at: "2026-03-04T05:06:07+02:00",
        },
        scopeRef: INSTALLATION_ORG,
      }),
    ).toEqual(expected);
  });

  it("falls back to the app slug as provider id, and marks a missing deep link and unset times", () => {
    const expected: GithubAppInstallation = {
      appSlug: "idless-sentinel-app",
      createdAt: null,
      events: [],
      firstSeenAt: "2026-08-11T11:11:11.000Z",
      id: githubEntityId({
        kind: "github-app-installation",
        providerId: "idless-sentinel-app",
        scopeRef: INSTALLATION_ORG,
      }),
      permissions: {},
      providerId: "idless-sentinel-app",
      repositorySelection: "all",
      scopeLevel: "organization",
      scopeRef: INSTALLATION_ORG,
      selectedRepositoryIds: [],
      source: SOURCE_WITHOUT_LINK,
      state: "observed",
      suspendedAt: null,
      updatedAt: null,
    };
    expect(
      projectGithubAppInstallation({
        context: CONTEXT,
        raw: {
          app_slug: "idless-sentinel-app",
          events: [],
          permissions: {},
          repositories: [],
          repository_selection: "all",
          suspended_at: null,
        },
        scopeRef: INSTALLATION_ORG,
      }),
    ).toEqual(expected);
  });

  it("returns null for a body with no app slug, an empty one, or no record at all", () => {
    const scopeRef = INSTALLATION_ORG;
    expect(projectGithubAppInstallation({ context: CONTEXT, raw: { id: 88002 }, scopeRef })).toBe(null);
    expect(projectGithubAppInstallation({ context: CONTEXT, raw: { app_slug: "", id: 88003 }, scopeRef })).toBe(null);
    expect(projectGithubAppInstallation({ context: CONTEXT, raw: 88004, scopeRef })).toBe(null);
  });
});

describe("projectGithubRepositoryLabel", () => {
  const LABEL_REPO = "acme-labels/label-repo";

  it("projects a label keyed by its NAME rather than its numeric id, with no deep link", () => {
    const expected: GithubRepositoryLabel = {
      color: "a2eeef",
      description: "label-description-sentinel",
      firstSeenAt: "2026-08-11T11:11:11.000Z",
      id: githubEntityId({ kind: "repository-label", providerId: "kind: feature", scopeRef: LABEL_REPO }),
      name: "kind: feature",
      providerId: "kind: feature",
      scopeLevel: "repository",
      scopeRef: LABEL_REPO,
      source: SOURCE_WITHOUT_LINK,
      state: "observed",
    };
    expect(
      projectGithubRepositoryLabel({
        context: CONTEXT,
        raw: {
          color: "a2eeef",
          default: false,
          description: "label-description-sentinel",
          id: 9911,
          name: "kind: feature",
          node_id: "node-id-must-not-survive",
          url: "https://api.github.com/repos/acme-labels/label-repo/labels/kind:%20feature",
        },
        scopeRef: LABEL_REPO,
      }),
    ).toEqual(expected);
  });

  it("reads a null or empty description as null", () => {
    const nullDescription = projectGithubRepositoryLabel({
      context: CONTEXT,
      raw: { color: "ededed", description: null, name: "bare-label" },
      scopeRef: LABEL_REPO,
    })!;
    const emptyDescription = projectGithubRepositoryLabel({
      context: CONTEXT,
      raw: { color: "ededed", description: "", name: "empty-label" },
      scopeRef: LABEL_REPO,
    })!;
    expect(nullDescription.description).toBe(null);
    expect(emptyDescription.description).toBe(null);
  });

  it("returns null for a label with no name, no colour, an empty one, or no record at all", () => {
    const scopeRef = LABEL_REPO;
    expect(projectGithubRepositoryLabel({ context: CONTEXT, raw: { color: "ededed" }, scopeRef })).toBe(null);
    expect(projectGithubRepositoryLabel({ context: CONTEXT, raw: { name: "colourless" }, scopeRef })).toBe(null);
    expect(projectGithubRepositoryLabel({ context: CONTEXT, raw: { color: "", name: "blank" }, scopeRef })).toBe(null);
    expect(projectGithubRepositoryLabel({ context: CONTEXT, raw: "kind: feature", scopeRef })).toBe(null);
  });
});
