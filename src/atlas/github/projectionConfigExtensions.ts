/**
 * The projections for the EXTENSION POINTS an organisation or repository adds to GitHub — custom property
 * definitions, custom repository roles, app installations and repository labels.
 *
 * Split from `projectionConfig.ts` on size alone; both share `projectionBase.ts`, whose header carries the
 * rules every projection here follows, and `projection.ts` re-exports both.
 */

import { isRecord } from "../../lib/parsers.js";

import type {
  GithubAppInstallation,
  GithubCustomPropertyDefinition,
  GithubCustomRepositoryRole,
  GithubRepositoryLabel,
} from "./entities.js";

import { withoutCredentialShaped } from "./privacy.js";
import {
  bool,
  idsOf,
  iso,
  nested,
  type ProjectionContext,
  providerIdOf,
  scopedOf,
  str,
  strings,
} from "./projectionBase.js";

/**
 * Project one custom property definition.
 *
 * @param raw one definition from the schema
 * @param scopeRef the organisation login
 * @param context the run's provenance
 * @returns the stored definition, or `null` when it carries no name or type
 */
export function projectGithubCustomPropertyDefinition({
  raw,
  scopeRef,
  context,
}: {
  raw: unknown;
  scopeRef: string;
  context: ProjectionContext;
}): GithubCustomPropertyDefinition | null {
  if (!isRecord(raw)) {
    return null;
  }
  const propertyName = str({ key: "property_name", raw });
  const valueType = str({ key: "value_type", raw });
  if (propertyName === null || valueType === null) {
    return null;
  }
  return {
    ...scopedOf({
      context,
      deepLink: null,
      kind: "custom-property-definition",
      providerId: propertyName,
      scopeLevel: "organization",
      scopeRef,
    }),
    allowedValues: withoutCredentialShaped({ values: strings({ key: "allowed_values", raw }) }),
    description: str({ key: "description", raw }),
    propertyName,
    required: bool({ key: "required", raw }),
    valueType,
    valuesEditableBy: str({ key: "values_editable_by", raw }),
  };
}

/**
 * Project one custom repository role.
 *
 * @param raw one role from the listing
 * @param scopeRef the organisation login
 * @param context the run's provenance
 * @returns the stored role, or `null` when it carries no name
 */
export function projectGithubCustomRepositoryRole({
  raw,
  scopeRef,
  context,
}: {
  raw: unknown;
  scopeRef: string;
  context: ProjectionContext;
}): GithubCustomRepositoryRole | null {
  if (!isRecord(raw)) {
    return null;
  }
  const name = str({ key: "name", raw });
  if (name === null) {
    return null;
  }
  return {
    ...scopedOf({
      context,
      deepLink: null,
      kind: "custom-repository-role",
      providerId: providerIdOf({ fallback: name, raw }),
      scopeLevel: "organization",
      scopeRef,
    }),
    baseRole: str({ key: "base_role", raw }),
    description: str({ key: "description", raw }),
    name,
    permissions: strings({ key: "permissions", raw }),
  };
}

/**
 * Project one installed GitHub App.
 *
 * `permissions` is kept whole because it IS the question: which capability was granted at which level is
 * exactly what "what can reach the code that is not a person" means, and dropping a level to a boolean
 * would lose the difference between read and write.
 *
 * @param raw one installation from the listing
 * @param scopeRef the organisation login
 * @param context the run's provenance
 * @returns the stored installation, or `null` when it names no app
 */
export function projectGithubAppInstallation({
  raw,
  scopeRef,
  context,
}: {
  raw: unknown;
  scopeRef: string;
  context: ProjectionContext;
}): GithubAppInstallation | null {
  if (!isRecord(raw)) {
    return null;
  }
  const appSlug = str({ key: "app_slug", raw });
  if (appSlug === null) {
    return null;
  }
  const permissionsRaw = nested({ key: "permissions", raw });
  const permissions: Record<string, string> = {};
  for (const [name, level] of Object.entries(permissionsRaw)) {
    if (typeof level === "string") {
      permissions[name] = level;
    }
  }
  return {
    ...scopedOf({
      context,
      deepLink: str({ key: "html_url", raw }),
      kind: "github-app-installation",
      providerId: providerIdOf({ fallback: appSlug, raw }),
      scopeLevel: "organization",
      scopeRef,
    }),
    appSlug,
    createdAt: iso({ key: "created_at", raw }),
    events: strings({ key: "events", raw }),
    permissions,
    repositorySelection: str({ key: "repository_selection", raw }),
    selectedRepositoryIds: idsOf({ key: "repositories", raw }),
    suspendedAt: iso({ key: "suspended_at", raw }),
    updatedAt: iso({ key: "updated_at", raw }),
  };
}

/**
 * Project one repository label: its name, colour and description, and nothing about who made it.
 *
 * The NAME is the provider id rather than GitHub's numeric id, because the name is the key GitHub itself
 * addresses a label by within a repository (`/repos/{owner}/{repo}/labels/{name}`), and it is what a new
 * repository reproducing this one is given — the numeric id is minted fresh there.
 *
 * @param raw one label from the listing
 * @param scopeRef the `owner/repo` coordinate
 * @param context the run's provenance
 * @returns the stored label, or `null` when it carries no name or colour
 */
export function projectGithubRepositoryLabel({
  raw,
  scopeRef,
  context,
}: {
  raw: unknown;
  scopeRef: string;
  context: ProjectionContext;
}): GithubRepositoryLabel | null {
  if (!isRecord(raw)) {
    return null;
  }
  const name = str({ key: "name", raw });
  const color = str({ key: "color", raw });
  if (name === null || color === null) {
    return null;
  }
  return {
    ...scopedOf({
      context,
      deepLink: null,
      kind: "repository-label",
      providerId: name,
      scopeLevel: "repository",
      scopeRef,
    }),
    color,
    description: str({ key: "description", raw }),
    name,
  };
}
