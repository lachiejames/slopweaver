/*
 * The fixtures more than one `syncPagesProjectKind` test file reads: the account and instants a run is stamped
 * at, a real client over a routing fetch, the routes a project's reads answer from, the stored kind file a run
 * folds into, two raw projects, and the entity and gap shapes a run is expected to publish. The client and the
 * stored file are the ones fan-out kinds share, in `../sync/fanoutKind.ts`. A plain module, not a `*.test.ts`, so
 * no test registers twice. It was split out when the Pages sync suite became one file per behaviour.
 */
import type Cloudflare from "cloudflare";

import { openCloudflareGap } from "../../../../../atlas/cloudflare/gaps.js";
import { cloudflareEntityId } from "../../../../../atlas/cloudflare/identity.js";
import type { CloudflareEntity, CloudflareGap, CloudflareKindFile } from "../../../../../atlas/cloudflare/model.js";
import {
  type CloudflarePagesChildItem,
  type CloudflarePagesDomainDetail,
  type CloudflarePagesRawChildItem,
  type CloudflareRawPagesProject,
  normalizeCloudflarePagesChildItem,
  projectCloudflarePagesProject,
} from "../../../../../atlas/cloudflare/projection/pages.js";
import { type RefusedRoute, resultResponse, routedKeyClient, storedKindFile } from "../sync/fanoutKind.js";

export const AT = "2026-02-01T00:00:00.000Z";
export const OLD = "2026-01-01T00:00:00.000Z";
export const ACCOUNT_ID: string = "a".repeat(32);
export const KIND_SCOPE: string = `account/${ACCOUNT_ID}/pages-project`;
export const PROJECTS: string = `/client/v4/accounts/${ACCOUNT_ID}/pages/projects`;

/** The remedy text every permission-only boundary carries (`kindFold.ts`'s `CLOUDFLARE_TOKEN_REMEDY`). */
export const TOKEN_REMEDY: string =
  "an API token scoped to read this surface — the account holds it and the configured token may not see it," +
  " so widening the token's permissions at Cloudflare is what would fill this kind";

/** One routed response: a refusal at `status`, or a JSON envelope carrying `result`. */
type Route = { readonly status: number } | { readonly result: readonly unknown[] };

/**
 * A real client over a routing fetch. Routes are keyed `<path>@<page>` (page 1 when the SDK names none); an
 * unrouted key answers 404 naming it, and every request key is recorded in arrival order.
 *
 * @returns the client, and the request keys it was asked for in arrival order
 */
export function servedClient({ routes }: { routes: Readonly<Record<string, Route>> }): {
  readonly client: Cloudflare;
  readonly requests: readonly string[];
} {
  return routedKeyClient<Exclude<Route, RefusedRoute>>({
    respond: ({ route }) => resultResponse({ result: route.result }),
    routes,
  });
}

/**
 * Page 1 of a page-paginated list carrying `items`, and the empty page 2 that ends the SDK's iteration.
 *
 * @returns the two routes, keyed `<path>@1` and `<path>@2`
 */
export function pagedRoutes({ path, items }: { path: string; items: readonly unknown[] }): Record<string, Route> {
  return { [`${path}@1`]: { result: items }, [`${path}@2`]: { result: [] } };
}

/**
 * The deployments list path for the project with this NAME (Pages addresses children by name, never id).
 *
 * @returns the request path, without a page
 */
export function deploymentsPath({ name }: { name: string }): string {
  return `${PROJECTS}/${name}/deployments`;
}

/**
 * The custom-domains list path for the project with this NAME.
 *
 * @returns the request path, without a page
 */
export function domainsPath({ name }: { name: string }): string {
  return `${PROJECTS}/${name}/domains`;
}

/**
 * The routes for one project's successful children read: paginated deployments, a single-page domain list.
 *
 * @returns the deployments' two pages and the domains' one
 */
export function childRoutes({
  name,
  deployments,
  domains,
}: {
  name: string;
  deployments: readonly unknown[];
  domains: readonly unknown[];
}): Record<string, Route> {
  return {
    ...pagedRoutes({ items: deployments, path: deploymentsPath({ name }) }),
    [`${domainsPath({ name })}@1`]: { result: domains },
  };
}

/**
 * The gap scope for one project, keyed by its id.
 *
 * @returns the kind scope with the project id appended
 */
export function projectScope({ projectId }: { projectId: string }): string {
  return `${KIND_SCOPE}/${projectId}`;
}

/**
 * A stored entity, projected by the module's own projection at the earlier timestamp from raw children.
 *
 * @returns the projected entity, stamped `OLD`
 */
export function storedProject({
  raw,
  children,
}: {
  raw: CloudflareRawPagesProject;
  children: readonly CloudflarePagesRawChildItem[];
}): CloudflareEntity {
  return projectCloudflarePagesProject({
    accountId: ACCOUNT_ID,
    at: OLD,
    children: children.map((child) => normalizeCloudflarePagesChildItem({ raw: child })),
    raw,
  });
}

/**
 * A stored kind file holding the given entities and gaps, plus the kind's earlier synced coverage cell.
 *
 * @returns the kind file a run folds into
 */
export function storedFile({
  entities,
  gaps,
}: {
  entities: readonly CloudflareEntity[];
  gaps: readonly CloudflareGap[];
}): CloudflareKindFile {
  return storedKindFile({ entities, gaps, kind: "pages-project", scope: KIND_SCOPE, updatedAt: OLD });
}

/**
 * A gap a previous run opened, stamped at the earlier timestamp.
 *
 * @returns the open gap
 */
export function storedGap({
  condition,
  scope,
}: {
  condition: "permission-refused" | "pagination-incomplete";
  scope: string;
}): CloudflareGap {
  return openCloudflareGap({ at: OLD, condition, kind: "pages-project", reason: "stored", scope });
}

/**
 * One stored deployment as the projection writes it, every optional field absent except `environment`.
 *
 * @returns the deployment's stored detail
 */
export function deploymentDetail({
  id,
  environment,
}: {
  id: string;
  environment: string;
}): Extract<CloudflarePagesChildItem, { readonly itemKind: "deployment" }>["deployment"] {
  return {
    aliases: [],
    config: {},
    createdOn: null,
    environment,
    id,
    latestStageName: null,
    latestStageStatus: null,
    modifiedOn: null,
    shortId: null,
    url: null,
  };
}

/**
 * One stored custom domain as the projection writes it, every optional field absent except `status`.
 *
 * @returns the domain's stored detail
 */
export function domainDetail({ name, status }: { name: string; status: string }): CloudflarePagesDomainDetail {
  return {
    certificateAuthority: null,
    domainId: null,
    name,
    status,
    validationStatus: null,
    verificationStatus: null,
    zoneTag: null,
  };
}

/**
 * The entity this run is expected to publish, written out field by field rather than projected.
 *
 * @returns the entity, observed at `at` by the Pages fan-out
 */
export function expectedEntity({
  providerId,
  detail,
  firstSeenAt,
  at,
}: {
  providerId: string;
  detail: Record<string, unknown>;
  firstSeenAt: string;
  at: string;
}): CloudflareEntity {
  return {
    detail: {
      canonicalDeploymentId: null,
      config: {},
      framework: null,
      frameworkVersion: null,
      kind: "pages-project",
      latestDeploymentId: null,
      usesFunctions: null,
      ...detail,
    },
    firstSeenAt,
    id: cloudflareEntityId({ components: { accountId: ACCOUNT_ID, providerId }, kind: "pages-project" }),
    kind: "pages-project",
    lastSeenAt: at,
    providerId,
    scope: { accountId: ACCOUNT_ID, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "pages-projects-fanout" },
    state: "observed",
  };
}

/**
 * Sort as `reconcileParentFanout` does: by hashed entity id, not by inventory order.
 *
 * @returns a sorted copy
 */
export function byId<T extends { id: string }>({ entities }: { entities: readonly T[] }): readonly T[] {
  return entities.toSorted((left, right) => left.id.localeCompare(right.id));
}

/**
 * Every gap as `{ condition, scope, status, lastCheckedAt }`, sorted by scope then condition.
 *
 * @returns each gap's lifecycle fields, in that order
 */
export function gapLifecycle({
  file,
}: {
  file: CloudflareKindFile;
}): readonly Pick<CloudflareGap, "condition" | "lastCheckedAt" | "scope" | "status">[] {
  return file.gaps
    .map((gap) => ({
      condition: gap.condition,
      lastCheckedAt: gap.lastCheckedAt,
      scope: gap.scope,
      status: gap.status,
    }))
    .toSorted((left, right) => `${left.scope}/${left.condition}`.localeCompare(`${right.scope}/${right.condition}`));
}

/** Project `proj-1`, named `site-one`, declaring its `*.pages.dev` subdomain and one custom domain. */
export const PROJECT_ONE: CloudflareRawPagesProject = {
  domains: ["site-one.pages.dev", "www.one.example"],
  id: "proj-1",
  name: "site-one",
  production_branch: "main",
  subdomain: "site-one.pages.dev",
};
/** Project `proj-2`, named `site-two`, declaring only its `*.pages.dev` subdomain. */
export const PROJECT_TWO: CloudflareRawPagesProject = {
  domains: ["site-two.pages.dev"],
  id: "proj-2",
  name: "site-two",
  production_branch: "main",
  subdomain: "site-two.pages.dev",
};
