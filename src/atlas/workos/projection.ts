/**
 * Turning what each channel saw into entities. Pure — no I/O, no clock of its own.
 *
 * The two callers each project only their own channel and leave the other slot `null`, which is what makes
 * `merge.ts`'s channel-scoped fold correct: an entity arriving with one channel filled can never blank the
 * other.
 *
 * ## Provider ids, and why they are shaped the way they are
 *
 * - `operation` — `<METHOD> <path>`, e.g. `GET /organizations`. A PAIR rather than a path, because the
 *   oracle's verdict is about a pair and `GET /directory_users` existing says nothing about
 *   `POST /directory_users` (`routeProbe.ts` § the one-way limit).
 * - `page` — the dashboard route's own path, bare. The environment segment moves the ADDRESS and never
 *   the key, so an install's own environment stays out of every stored id (`dashboardPages.ts`).
 * - `organization` / `user` / `connection` / `directory` — WorkOS's own id, which is opaque and prefixed
 *   (`org_`, `user_`, `conn_`, `directory_`) rather than a name somebody chose.
 *
 * ## A declared page is an entity BEFORE any browser runs
 *
 * `docs/atlas-intent/05-browser-proof.md` puts the exact URL first, and an agent asked for proof of a WorkOS setting needs the
 * address to open on an install whose browser surface has never been filled. So a page projects on the API
 * channel — the channel a sync runs on — with `deepLinkStatus: "unverified"` and a null `reachedAt`, and a
 * walk later fills the SAME entity's browser channel with the witness and the screenshot. The two are never
 * confused, because they are different channels on one row.
 *
 * ## An `absent` route is still an entity
 *
 * A probed pair that is not routed projects exactly like one that is, carrying `verdict: "absent"`. Dropping
 * it would turn a measured negative into a silence, and the negative is half of what makes the map
 * falsifiable: "we asked and WorkOS does not serve it" is the sentence a reader needs, and a missing row
 * cannot say it.
 */

import { absentAs } from "#lib/absent.js";
import type { AtlasArtifactRef } from "../kit/contract.js";
import { WORKOS_DASHBOARD_ROUTES, workosDashboardRouteUrl } from "./dashboardPages.js";
import { apiEntity, byId, channelEntity, surfaceLink } from "./entityShape.js";
import { workosEntityId } from "./identity.js";
import type {
  WorkosAtlasEntity,
  WorkosConnectionApiDetail,
  WorkosDirectoryApiDetail,
  WorkosOperationApiDetail,
  WorkosOrganizationApiDetail,
  WorkosPageDetail,
  WorkosUserApiDetail,
} from "./model.js";
import { WORKOS_API_ORIGIN, type WorkosRouteCandidate, workosRouteProviderId } from "./routeCandidates.js";
import type { WorkosRouteClassification } from "./routeProbe.js";

/** One candidate and what the running server said about it. */
export interface WorkosProbedRoute {
  readonly candidate: WorkosRouteCandidate;
  readonly classification: WorkosRouteClassification;
  readonly statusCode: number;
}

/**
 * Project this run's probe results into `operation` entities on the API channel.
 *
 * The deep link is the vendor's own documentation anchor for the family rather than a tenant address: a
 * route has no page of its own in anybody's browser, and pointing a reader at the dashboard section that
 * corresponds to it is the useful thing an atlas can offer instead. It is `unverified` because nothing here
 * opened it.
 *
 * @param probed every candidate this run asked about, with the server's answer
 * @param at this run's ISO timestamp
 * @returns one entity per probed pair, sorted by id
 */
export function projectWorkosOperations({
  probed,
  at,
}: {
  probed: readonly WorkosProbedRoute[];
  at: string;
}): readonly WorkosAtlasEntity[] {
  const entities = probed.map((row): WorkosAtlasEntity => {
    const detail: WorkosOperationApiDetail = {
      declaredParams: [...row.classification.declaredParams],
      family: row.candidate.family,
      httpMethod: row.candidate.httpMethod,
      path: row.candidate.path,
      statusCode: row.statusCode,
      verdict: row.classification.verdict,
      writes: row.candidate.writes,
    };
    return apiEntity({
      at,
      deepLink: null,
      deepLinkStatus: "unavailable",
      detail,
      endpoint: `${row.candidate.httpMethod} ${WORKOS_API_ORIGIN}${row.candidate.path}`,
      kind: "operation",
      providerId: workosRouteProviderId({ httpMethod: row.candidate.httpMethod, path: row.candidate.path }),
    });
  });
  return byId({ entities });
}

/**
 * Project the declared dashboard routes into `page` entities on the API channel.
 *
 * Every row carries its exact URL and `deepLinkStatus: "unverified"`, because this atlas computed the
 * address and did not open it. A walk upgrades the SAME entity's browser channel to `browser-discovered`.
 *
 * @param at this run's ISO timestamp
 * @param environmentId this installation's environment segment, or `null` when none is resolved — an
 *   environment route then takes its bootstrap address, which `dashboardPages.ts` explains
 * @returns one entity per declared route, sorted by id
 */
export function projectWorkosDeclaredPages({
  at,
  environmentId,
}: {
  at: string;
  environmentId: string | null;
}): readonly WorkosAtlasEntity[] {
  const entities = WORKOS_DASHBOARD_ROUTES.map((route): WorkosAtlasEntity => {
    const detail: WorkosPageDetail = {
      finalUrl: null,
      needsAdmin: route.needsAdmin,
      purpose: route.purpose,
      reachedAt: null,
      title: null,
      unreachableBecause: null,
    };
    return apiEntity({
      at,
      deepLink: workosDashboardRouteUrl({ environmentId, route }),
      deepLinkStatus: "unverified",
      detail,
      endpoint: route.path,
      kind: "page",
      providerId: route.path,
    });
  });
  return byId({ entities });
}

/**
 * One page a walk actually landed on, as the walk document reports it.
 * @internal
 */
export interface WorkosWitnessedPage {
  /** The declared route this witness is for — the byte-exact provider id the two channels match on. */
  readonly path: string;
  readonly finalUrl: string;
  readonly title: string | null;
  /** Why the walk could not open it, or `null` when it did. */
  readonly unreachableBecause: string | null;
  /** The screenshot the walk captured, or `null` when it captured none. */
  readonly artifact: AtlasArtifactRef | null;
}

/**
 * Project a walk's witnesses into `page` entities on the BROWSER channel.
 *
 * A witness for a route the declared table does not name still projects, and that is the point: it is the
 * dashboard showing an address this atlas's own map could not have produced, which `disagreement.ts` reports
 * as `witnessed-and-undeclared` — the most interesting of the three findings.
 *
 * @param witnessed every page the walk reported on
 * @param at this run's ISO timestamp
 * @returns one browser-channel entity per witness, sorted by id
 */
export function projectWorkosWitnessedPages({
  witnessed,
  at,
}: {
  witnessed: readonly WorkosWitnessedPage[];
  at: string;
}): readonly WorkosAtlasEntity[] {
  const declared = new Map(WORKOS_DASHBOARD_ROUTES.map((route) => [route.path, route]));
  const entities = witnessed.map((page): WorkosAtlasEntity => {
    const route = declared.get(page.path);
    const detail: WorkosPageDetail = {
      finalUrl: page.finalUrl,
      needsAdmin: route?.needsAdmin === true,
      purpose: absentAs({
        value: route?.purpose,
        whenAbsent: "an address the walk reached that this atlas's route table does not declare",
      }),
      reachedAt: page.unreachableBecause === null ? at : null,
      title: page.title,
      unreachableBecause: page.unreachableBecause,
    };
    const artifacts = page.artifact === null ? [] : [page.artifact];
    return {
      channels: {
        api: null,
        browser: channelEntity({
          artifacts,
          at,
          channel: "browser",
          deepLink: page.finalUrl,
          // The walk OPENED this address, which is the one thing that earns `browser-discovered`.
          deepLinkStatus: page.unreachableBecause === null ? "browser-discovered" : "unverified",
          detail,
          endpoint: page.path,
        }),
      },
      id: workosEntityId({ kind: "page", providerId: page.path }),
      kind: "page",
      providerId: page.path,
    };
  });
  return byId({ entities });
}

/** One organisation, as the content read saw it. */
export interface WorkosOrganizationRecord {
  readonly id: string;
  readonly name: string;
  readonly domainCount: number;
}

/**
 * Project organisations into entities on the API channel.
 *
 * @param records this run's organisations
 * @param at this run's ISO timestamp
 * @param environmentId this installation's environment segment, or `null` when none is resolved
 * @returns one entity per organisation, sorted by id
 */
export function projectWorkosOrganizations({
  records,
  at,
  environmentId,
}: {
  records: readonly WorkosOrganizationRecord[];
  at: string;
  environmentId: string | null;
}): readonly WorkosAtlasEntity[] {
  const entities = records.map((record): WorkosAtlasEntity => {
    const detail: WorkosOrganizationApiDetail = { domainCount: record.domainCount, name: record.name };
    return apiEntity({
      at,
      ...surfaceLink({ environmentId, path: "/organizations" }),
      detail,
      endpoint: "GET /organizations",
      kind: "organization",
      providerId: record.id,
    });
  });
  return byId({ entities });
}

/** One User Management user, as the content read saw it. */
export interface WorkosUserRecord {
  readonly id: string;
  readonly emailVerified: boolean;
  readonly organizationIds: readonly string[];
}

/**
 * Project users into entities on the API channel.
 *
 * @param records this run's users
 * @param at this run's ISO timestamp
 * @param environmentId this installation's environment segment, or `null` when none is resolved
 * @returns one entity per user, sorted by id
 */
export function projectWorkosUsers({
  records,
  at,
  environmentId,
}: {
  records: readonly WorkosUserRecord[];
  at: string;
  environmentId: string | null;
}): readonly WorkosAtlasEntity[] {
  const entities = records.map((record): WorkosAtlasEntity => {
    const detail: WorkosUserApiDetail = {
      emailVerified: record.emailVerified,
      organizationIds: [...record.organizationIds].toSorted(),
    };
    return apiEntity({
      at,
      ...surfaceLink({ environmentId, path: "/users" }),
      detail,
      endpoint: "GET /user_management/users",
      kind: "user",
      providerId: record.id,
    });
  });
  return byId({ entities });
}

/** One SSO connection, as the content read saw it. */
export interface WorkosConnectionRecord {
  readonly id: string;
  readonly connectionType: string;
  readonly organizationId: string;
  readonly state: string;
}

/**
 * Project SSO connections into entities on the API channel.
 *
 * These carry no deep link, and that is a finding rather than an omission: the dashboard's `/sso` page is
 * gone and this atlas has witnessed no address that replaced it, which `sync.ts` raises as
 * `dashboard-surface-moved-unknown-address`.
 *
 * @param records this run's connections
 * @param at this run's ISO timestamp
 * @param environmentId this installation's environment segment, or `null` when none is resolved
 * @returns one entity per connection, sorted by id
 */
export function projectWorkosConnections({
  records,
  at,
  environmentId,
}: {
  records: readonly WorkosConnectionRecord[];
  at: string;
  environmentId: string | null;
}): readonly WorkosAtlasEntity[] {
  const entities = records.map((record): WorkosAtlasEntity => {
    const detail: WorkosConnectionApiDetail = {
      connectionType: record.connectionType,
      organizationId: record.organizationId,
      state: record.state,
    };
    return apiEntity({
      at,
      ...surfaceLink({ environmentId, path: "/sso" }),
      detail,
      endpoint: "GET /connections",
      kind: "connection",
      providerId: record.id,
    });
  });
  return byId({ entities });
}

/** One SCIM directory, as the content read saw it. */
export interface WorkosDirectoryRecord {
  readonly id: string;
  readonly directoryType: string;
  readonly organizationId: string;
  readonly state: string;
}

/**
 * Project SCIM directories into entities on the API channel.
 *
 * @param records this run's directories
 * @param at this run's ISO timestamp
 * @param environmentId this installation's environment segment, or `null` when none is resolved
 * @returns one entity per directory, sorted by id
 */
export function projectWorkosDirectories({
  records,
  at,
  environmentId,
}: {
  records: readonly WorkosDirectoryRecord[];
  at: string;
  environmentId: string | null;
}): readonly WorkosAtlasEntity[] {
  const entities = records.map((record): WorkosAtlasEntity => {
    const detail: WorkosDirectoryApiDetail = {
      directoryType: record.directoryType,
      organizationId: record.organizationId,
      state: record.state,
    };
    return apiEntity({
      at,
      ...surfaceLink({ environmentId, path: "/directory-sync" }),
      detail,
      endpoint: "GET /directories",
      kind: "directory",
      providerId: record.id,
    });
  });
  return byId({ entities });
}
