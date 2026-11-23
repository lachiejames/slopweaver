/**
 * Provider payloads into this atlas's entities, through an ALLOWLIST.
 *
 * ## Why an allowlist rather than a denial list
 *
 * The loader payloads carry more than the atlas wants and some of it is a credential. MEASURED
 * on one `overview.data` response: an `ENV` block with a Rollbar access token, a PostHog API key and an
 * Auth0 client id; a `posthogBootstrap` block with every feature flag; a `pylon` block with the signed-in
 * person's avatar URL and an email hash. None of that is Nx Cloud ground truth and all of it would have
 * been stored by a projection that copied the payload and excluded what somebody thought of.
 *
 * So every field this atlas holds is NAMED here, one reader per field, and a field Nx Cloud adds next month
 * is dropped at the boundary. `atlas/onepassword/model.ts` made the same choice for the same reason and is
 * the shape this follows; `sensitivity.ts` is the second, independent mechanism behind it.
 *
 * ## A missing field is `null`, never a refusal
 *
 * These payloads are a first-party client's, not a published API's, so a field appearing or vanishing
 * between deploys is ordinary. A projection that refused the whole read over one absent optional would make
 * the atlas stop working on a Tuesday; one that stores `null` says exactly what it saw.
 */
import { isRecord } from "../../lib/parsers.js";

import type { NxCloudOrganizationDetail, NxCloudWorkspaceDetail } from "./model.js";

/**
 * Read one string field, or `null` when it is absent, empty or not a string.
 *
 * @param source the record to read
 * @param key the field name
 * @returns the string, or `null`
 */
function stringField({ source, key }: { source: Record<string, unknown>; key: string }): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Read one finite number field, or `null`.
 *
 * @param source the record to read
 * @param key the field name
 * @returns the number, or `null`
 */
function numberField({ source, key }: { source: Record<string, unknown>; key: string }): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Read one boolean field, or `null`.
 *
 * @param source the record to read
 * @param key the field name
 * @returns the boolean, or `null`
 */
function booleanField({ source, key }: { source: Record<string, unknown>; key: string }): boolean | null {
  const value = source[key];
  return typeof value === "boolean" ? value : null;
}

/**
 * Read the length of an array field, or `null` when there is no array.
 *
 * A COUNT rather than the array itself: the organisation's memberships are people, and this atlas holds how
 * many there are rather than who they are — the same line the 1Password atlas draws around a vault's items.
 *
 * @param source the record to read
 * @param key the field name
 * @returns the count, or `null`
 */
function countField({ source, key }: { source: Record<string, unknown>; key: string }): number | null {
  const value = source[key];
  return Array.isArray(value) ? value.length : null;
}

/**
 * Read a nested record, or an empty one.
 *
 * @param source the record to read
 * @param key the field name
 * @returns the nested record, or an empty record when there is none
 */
function nested({ source, key }: { source: Record<string, unknown>; key: string }): Record<string, unknown> {
  const value = source[key];
  return isRecord(value) ? value : {};
}

/**
 * Project one organisation out of the `routes/_auth.orgs.$orgId` loader block.
 *
 * The identity fields a caller needs — the organisation's own id — are the caller's, because it asked for a
 * scope and knows what it asked for; a payload that disagreed about its own id would be a finding rather
 * than a source of truth.
 *
 * @param data the loader block's `data`
 * @returns the projected detail, or `null` when the block carries no organisation at all
 */
export function projectOrganization({ data }: { data: unknown }): NxCloudOrganizationDetail | null {
  if (!isRecord(data)) {
    return null;
  }
  const organization = nested({ key: "organization", source: data });
  const name = stringField({ key: "name", source: organization });
  if (name === null) {
    return null;
  }
  return {
    contributorCount: numberField({ key: "contributorsCount", source: data }),
    currentUsagePercentage: numberField({ key: "currentUsagePercentage", source: data }),
    enabled: booleanField({ key: "enabled", source: organization }),
    isAdmin: booleanField({ key: "isAdmin", source: data }),
    membershipCount: countField({ key: "memberships", source: organization }),
    name,
    plan: stringField({ key: "plan", source: organization }),
    vcsProvider: stringField({ key: "provider", source: nested({ key: "vcsConfiguration", source: organization }) }),
  };
}

/**
 * Project one workspace out of the `routes/_auth.orgs.$orgId.workspaces.$workspaceId` loader block.
 *
 * @param data the loader block's `data`
 * @returns the projected detail, or `null` when the block carries no workspace at all
 */
export function projectWorkspace({ data }: { data: unknown }): NxCloudWorkspaceDetail | null {
  if (!isRecord(data)) {
    return null;
  }
  const workspace = nested({ key: "workspace", source: data });
  const organizationId = stringField({ key: "orgId", source: workspace });
  if (organizationId === null) {
    return null;
  }
  return workspaceDetailFrom({ organizationId, row: workspace });
}

/**
 * Project one workspace out of a record that already IS the workspace — a roster row, or the overview
 * loader's own `workspace` block.
 *
 * Shared between the two callers because the roster and the overview describe the same thing with the same
 * field names, and a second reader would be a second place for the allowlist to drift.
 *
 * @param row the workspace record
 * @param organizationId the organisation it belongs to
 * @returns the projected detail, or `null` when the record carries no name
 *
 * @internal
 */
export function workspaceDetailFrom({
  row,
  organizationId,
}: {
  row: Record<string, unknown>;
  organizationId: string;
}): NxCloudWorkspaceDetail | null {
  const name = stringField({ key: "name", source: row });
  if (name === null) {
    return null;
  }
  const workspace = row;
  const vcs = nested({ key: "vcsConfiguration", source: workspace });
  return {
    defaultBranch: stringField({ key: "defaultBranch", source: workspace }),
    idAccessLevel: stringField({ key: "idAccessLevel", source: workspace }),
    name,
    organizationId,
    patAccessLevel: stringField({ key: "patAccessLevel", source: workspace }),
    vcsProvider: stringField({ key: "provider", source: vcs }),
    vcsRepositoryFullName: stringField({ key: "repositoryFullName", source: vcs }),
    vcsRepositoryVisibility: stringField({ key: "repositoryVisibility", source: vcs }),
  };
}

/**
 * One workspace as the organisation's own roster describes it.
 *
 * @internal
 */
export interface NxCloudWorkspaceRosterRow {
  readonly id: string;
  readonly detail: NxCloudWorkspaceDetail;
}

/**
 * Project the workspace roster out of the `orgs/:orgId/workspaces.data` loader block.
 *
 * This is the call that makes the atlas hold the whole ORGANISATION rather than only the workspace it was
 * pointed at: each row carries the same shape the overview does, so a workspace nobody has ever named on a
 * command line still lands with its default branch and its feature configuration.
 *
 * @param data the loader block's `data`
 * @param organizationId the organisation these workspaces belong to
 * @returns every workspace the roster described, in payload order
 */
export function projectWorkspaceRoster({
  data,
  organizationId,
}: {
  data: unknown;
  organizationId: string;
}): readonly NxCloudWorkspaceRosterRow[] {
  if (!isRecord(data)) {
    return [];
  }
  const rows = data["workspaces"];
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.flatMap((row: unknown): readonly NxCloudWorkspaceRosterRow[] => {
    if (!isRecord(row)) {
      return [];
    }
    const id = stringField({ key: "id", source: row });
    const detail = workspaceDetailFrom({ organizationId, row });
    return id === null || detail === null ? [] : [{ detail, id }];
  });
}

/**
 * One organisation as the account-level list names it.
 *
 * @internal
 */
export interface NxCloudOrganizationRosterRow {
  readonly id: string;
  readonly name: string;
}

/**
 * Project the organisation roster out of the `/orgs.data` loader payload.
 *
 * Measured, and worth stating because it is this atlas's first finding: this list can be EMPTY
 * for an account that is nonetheless a member of a workspace, because Nx Cloud builds it from the VCS
 * accounts the profile has linked rather than from membership. An atlas that discovered its scope only from
 * here would report a fully reachable workspace as no workspace at all.
 *
 * @param data the `routes/_auth.orgs._index` loader block's `data`
 * @returns every organisation the list named, in payload order
 */
export function projectOrganizationRoster({ data }: { data: unknown }): readonly NxCloudOrganizationRosterRow[] {
  if (!isRecord(data)) {
    return [];
  }
  const rows = data["organizations"];
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.flatMap((row: unknown): readonly NxCloudOrganizationRosterRow[] => {
    if (!isRecord(row)) {
      return [];
    }
    const id = stringField({ key: "id", source: row });
    const name = stringField({ key: "name", source: row });
    return id === null || name === null ? [] : [{ id, name }];
  });
}
