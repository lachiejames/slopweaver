/**
 * Turning what each channel saw into entities. Pure — no I/O, no clock of its own.
 *
 * The two callers each project only their own channel and leave the other slot `null`, which is what makes
 * `merge.ts`'s channel-scoped fold correct: an entity arriving with one channel filled can never blank the
 * other.
 *
 * ## Provider ids, and why they are shaped the way they are
 *
 * - `operation` — `<ParentType>.<field>`, e.g. `Query.organizations`. The one key both channels can name.
 * - `type` — the type's own name.
 * - `organization` / `project` / `target` — the slug PATH, so a project called `api` in two organisations
 *   is two entities. The hierarchy lives inside the key rather than beside it, which is what lets one flat
 *   kind file stay greppable.
 * - `page` — the route template plus the slug path it was expanded for, so two targets' settings pages are
 *   two rows.
 *
 * ## A declared page is an entity BEFORE any browser runs
 *
 * `docs/atlas-intent/05-browser-proof.md` puts the exact URL first, and an agent asked for proof of a Hive setting needs the
 * address to open on an install whose browser surface has never been filled. So a page projects on the API
 * channel — the channel that knew the slugs — with `deepLinkStatus: "unverified"` and a null `reachedAt`,
 * and the walk later fills the SAME entity's browser channel with the witness and the screenshot. The two
 * are never confused, because they are different channels on one row.
 */

import { absentAsNull, absentAsNumber } from "#lib/absent.js";
import { atlasChannelView, atlasEntityWithChannel, sortedById } from "../kit/channelProjection.js";
import type { AtlasArtifactRef } from "../kit/contract.js";
import {
  consolePageProviderId,
  expandConsoleRoute,
  HIVE_CONSOLE_ORIGIN,
  HIVE_CONSOLE_ROUTES,
  type HiveConsoleSlugs,
} from "./consolePages.js";
import { hiveEntityId } from "./identity.js";
import type {
  HiveAtlasChannel,
  HiveAtlasEntity,
  HiveChannelEntity,
  HiveDeepLinkStatus,
  HiveOperationApiDetail,
  HiveOrganizationApiDetail,
  HivePageDetail,
  HiveProjectApiDetail,
  HiveTargetApiDetail,
  HiveTypeApiDetail,
} from "./model.js";
import { type HiveRegistrySurface, projectPath, targetPath } from "./registryRead.js";
import { type HiveSchemaSurface, providerKey } from "./schemaRead.js";

/**
 * One channel's view, stamped with this run's instant.
 *
 * A thin narrowing of `kit/channelProjection.ts`'s own constructor: the mechanism — fill one channel, stamp
 * both instants, carry the source — is the kit's and is shared with every other multi-channel atlas. What
 * stays here is only this atlas's channel and deep-link vocabularies.
 */
function channelEntity({
  channel,
  detail,
  at,
  endpoint,
  deepLink,
  deepLinkStatus,
  artifacts,
}: {
  channel: HiveAtlasChannel;
  detail: unknown;
  at: string;
  endpoint: string;
  deepLink: string | null;
  deepLinkStatus: HiveDeepLinkStatus;
  artifacts: readonly AtlasArtifactRef[];
}): HiveChannelEntity {
  return atlasChannelView({ artifacts, at, channel, deepLink, deepLinkStatus, detail, endpoint });
}

/** The all-null channel map every projection starts from, so filling one cannot blank the other. */
const NO_CHANNELS: HiveAtlasEntity["channels"] = { api: null, browser: null };

/** An entity carrying one API-channel view and nothing on the browser channel. */
function apiEntity({
  kind,
  providerId,
  detail,
  at,
  endpoint,
  deepLink,
  artifacts,
}: {
  kind: HiveAtlasEntity["kind"];
  providerId: string;
  detail: unknown;
  at: string;
  endpoint: string;
  deepLink: string | null;
  artifacts: readonly AtlasArtifactRef[];
}): HiveAtlasEntity {
  return atlasEntityWithChannel({
    channel: "api",
    empty: NO_CHANNELS,
    id: hiveEntityId({ kind, providerId }),
    kind,
    providerId,
    view: channelEntity({
      artifacts,
      at,
      channel: "api",
      deepLink,
      // A link this channel COMPUTED from slugs is not one it opened, and the status has to say so —
      // `unverified` is what the console walk later upgrades to `browser-discovered`.
      deepLinkStatus: deepLink === null ? "unavailable" : "unverified",
      detail,
      endpoint,
    }),
  });
}

/** Sort by id, so a published file is byte-stable across runs that saw the same things. */
function byId({ entities }: { entities: readonly HiveAtlasEntity[] }): readonly HiveAtlasEntity[] {
  return sortedById({ entities });
}

/**
 * Project the introspected schema's root fields into `operation` entities on the API channel.
 *
 * @param surface this run's introspection
 * @param at this run's ISO timestamp
 * @returns one entity per root field, sorted by id
 */
export function projectHiveOperations({
  surface,
  at,
}: {
  surface: HiveSchemaSurface;
  at: string;
}): readonly HiveAtlasEntity[] {
  return byId({
    entities: surface.operations.map((operation): HiveAtlasEntity => {
      const detail: HiveOperationApiDetail = {
        args: operation.args.map((arg) => ({ ...arg })),
        deprecationReason: operation.deprecationReason,
        description: operation.description,
        parentType: operation.parentType,
        returnType: operation.returnType,
      };
      const id = providerKey({ operation });
      return apiEntity({
        artifacts: [],
        at,
        // A GraphQL endpoint is not a place a human opens, so there is no deep link at all — and the
        // status has to SAY that rather than leaving an absent link indistinguishable from an unattempted one.
        deepLink: null,
        detail,
        endpoint: id,
        kind: "operation",
        providerId: id,
      });
    }),
  });
}

/**
 * Project the introspected schema's named types into `type` entities on the API channel.
 *
 * @param surface this run's introspection
 * @param at this run's ISO timestamp
 * @returns one entity per named type, sorted by id
 */
export function projectHiveTypes({
  surface,
  at,
}: {
  surface: HiveSchemaSurface;
  at: string;
}): readonly HiveAtlasEntity[] {
  return byId({
    entities: surface.types.map((type): HiveAtlasEntity => {
      const detail: HiveTypeApiDetail = {
        description: type.description,
        fields: [...type.fields],
        typeKind: type.typeKind,
      };
      return apiEntity({
        artifacts: [],
        at,
        deepLink: null,
        detail,
        endpoint: type.name,
        kind: "type",
        providerId: type.name,
      });
    }),
  });
}

/**
 * Project the registry's organisations into entities, each carrying its own console address.
 *
 * @param registry this run's registry read
 * @param at this run's ISO timestamp
 * @returns one entity per organisation, sorted by id
 */
export function projectHiveOrganizations({
  registry,
  at,
}: {
  registry: HiveRegistrySurface;
  at: string;
}): readonly HiveAtlasEntity[] {
  return byId({
    entities: registry.organizations.map((organization): HiveAtlasEntity => {
      const detail: HiveOrganizationApiDetail = {
        projectCount: organization.projectCount,
        slug: organization.slug,
      };
      return apiEntity({
        artifacts: [],
        at,
        deepLink: organizationConsoleUrl({ organizationSlug: organization.slug }),
        detail,
        endpoint: `organizations/${organization.slug}`,
        kind: "organization",
        providerId: organization.slug,
      });
    }),
  });
}

/**
 * Project the registry's projects into entities.
 *
 * @param registry this run's registry read
 * @param at this run's ISO timestamp
 * @returns one entity per project, sorted by id
 */
export function projectHiveProjects({
  registry,
  at,
}: {
  registry: HiveRegistrySurface;
  at: string;
}): readonly HiveAtlasEntity[] {
  return byId({
    entities: registry.projects.map((project): HiveAtlasEntity => {
      const detail: HiveProjectApiDetail = {
        organizationSlug: project.organizationSlug,
        projectType: project.projectType,
        slug: project.slug,
        targetCount: project.targetCount,
      };
      const path = projectPath({ project });
      return apiEntity({
        artifacts: [],
        at,
        deepLink: consoleUrlForPath({ path }),
        detail,
        endpoint: `projects/${path}`,
        kind: "project",
        providerId: path,
      });
    }),
  });
}

/** What a target's composed schema resolved to once its bytes were written as an artifact. */
export interface HiveTargetSchemaArtifact {
  /** The slug path of the target this artifact belongs to. */
  readonly targetPath: string;
  readonly artifact: AtlasArtifactRef;
}

/**
 * Project the registry's targets into entities, attaching each composed schema by reference.
 *
 * The SDL's bytes are not here: a caller writes them as a content-addressed artifact and passes the
 * resulting reference in, so this stays pure and a kind file never carries a schema blob.
 *
 * @param registry this run's registry read
 * @param schemas the artifact written for each target that published one, keyed by slug path
 * @param at this run's ISO timestamp
 * @returns one entity per target, sorted by id
 */
export function projectHiveTargets({
  registry,
  schemas,
  at,
}: {
  registry: HiveRegistrySurface;
  schemas: readonly HiveTargetSchemaArtifact[];
  at: string;
}): readonly HiveAtlasEntity[] {
  const byPath = new Map(schemas.map((entry) => [entry.targetPath, entry.artifact]));
  return byId({
    entities: registry.targets.map((target): HiveAtlasEntity => {
      const path = targetPath({ target });
      const artifact = absentAsNull({ value: byPath.get(path) });
      const detail: HiveTargetApiDetail = {
        graphqlEndpointUrl: target.graphqlEndpointUrl,
        organizationSlug: target.organizationSlug,
        projectSlug: target.projectSlug,
        schemaByteLength: absentAsNumber({ value: artifact?.byteLength, whenAbsent: 0 }),
        schemaSha256: absentAsNull({ value: artifact?.sha256 }),
        schemaVersionId: target.schemaVersionId,
        slug: target.slug,
      };
      return apiEntity({
        artifacts: artifact === null ? [] : [artifact],
        at,
        deepLink: consoleUrlForPath({ path }),
        detail,
        endpoint: `targets/${path}`,
        kind: "target",
        providerId: path,
      });
    }),
  });
}

/**
 * Project the declared console routes into `page` entities, expanded against the registry's own slugs.
 *
 * Every route whose scope the registry reaches becomes a row carrying its exact URL and a null `reachedAt`
 * — the address is published, the witness is not. A route whose scope the registry does not reach (there
 * are no projects yet, say) simply produces no row, because an address nothing can be substituted into is
 * not an address.
 *
 * @param registry this run's registry read, which supplies every slug a template needs
 * @param at this run's ISO timestamp
 * @returns one entity per (route × reachable scope), sorted by id
 */
export function projectHiveConsolePages({
  registry,
  at,
}: {
  registry: HiveRegistrySurface;
  at: string;
}): readonly HiveAtlasEntity[] {
  const entities: HiveAtlasEntity[] = [];
  for (const route of HIVE_CONSOLE_ROUTES) {
    for (const slugs of slugSetsFor({ registry, scope: route.scope })) {
      const url = expandConsoleRoute({ route, slugs });
      if (url === null) {
        continue;
      }
      const providerId = consolePageProviderId({ route, slugs });
      const detail: HivePageDetail = {
        finalUrl: null,
        needsAdmin: route.needsAdmin,
        purpose: route.purpose,
        reachedAt: null,
        title: null,
        unreachableBecause: null,
      };
      entities.push(apiEntity({ artifacts: [], at, deepLink: url, detail, endpoint: url, kind: "page", providerId }));
    }
  }
  return byId({ entities });
}

/**
 * Every slug combination one route scope expands into.
 *
 * @param registry this run's registry read
 * @param scope the route's declared scope
 * @returns one slug set per concrete page that scope produces
 */
function slugSetsFor({
  registry,
  scope,
}: {
  registry: HiveRegistrySurface;
  scope: (typeof HIVE_CONSOLE_ROUTES)[number]["scope"];
}): readonly HiveConsoleSlugs[] {
  if (scope === "root") {
    return [{ organizationSlug: null, projectSlug: null, targetSlug: null }];
  }
  if (scope === "organization") {
    return registry.organizations.map((organization) => ({
      organizationSlug: organization.slug,
      projectSlug: null,
      targetSlug: null,
    }));
  }
  if (scope === "project") {
    return registry.projects.map((project) => ({
      organizationSlug: project.organizationSlug,
      projectSlug: project.slug,
      targetSlug: null,
    }));
  }
  return registry.targets.map((target) => ({
    organizationSlug: target.organizationSlug,
    projectSlug: target.projectSlug,
    targetSlug: target.slug,
  }));
}

/** The console address for one organisation. */
function organizationConsoleUrl({ organizationSlug }: { organizationSlug: string }): string {
  return consoleUrlForPath({ path: organizationSlug });
}

/** The console address for one slug path, however deep. */
function consoleUrlForPath({ path }: { path: string }): string {
  const encoded = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${HIVE_CONSOLE_ORIGIN}/${encoded}`;
}
