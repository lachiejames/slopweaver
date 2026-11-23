/**
 * The `web-data` channel's PURE half: what one set of reads means, with nothing that touches a network.
 *
 * ## Why the split is here rather than inside the sync
 *
 * Everything below takes already-fetched outcomes and returns entities, coverage cells and gaps. So the
 * behaviour that actually matters — a 403 becoming a gap rather than an empty record, a family measuring to
 * zero, an organisation whose roster is empty while its workspace is plainly reachable — is settled by unit
 * tests over fixtures rather than by luck against a live tenant. `sync.ts` is then a loop and a publish.
 *
 * ## The one finding this file was written around
 *
 * MEASURED: an account can be a workspace MEMBER, read the workspace, its runs and its
 * analytics — and still list ZERO organisations, because Nx Cloud builds `/orgs` from the VCS accounts the
 * profile has linked rather than from membership. So an atlas that discovered its scope from the roster
 * alone would report a fully reachable workspace as no workspace at all, and one that treated the empty
 * roster as agreement between surfaces would report nothing wrong. It is raised as a gap, by name.
 */
import { isRecord } from "../../lib/parsers.js";
import { type AtlasCoverageCell, failedCoverageCell, succeededCoverageCell } from "../kit/coverage.js";
import type { AtlasGapRecheck } from "../kit/gaps.js";
import { responseFieldPaths } from "../kit/responseShape.js";

import type { NxCloudResponse } from "./client.js";
import { loaderData } from "./dataRoute.js";
import type { NxCloudAtlasError } from "./errors.js";
import { measureNxCloudFamily, NX_CLOUD_FAMILY_SPECS } from "./families.js";
import { endpointEntityId, familyEntityId, organizationEntityId, workspaceEntityId } from "./identity.js";
import { canonicalEndpointPattern, findNxCloudCall, NX_CLOUD_ORIGIN } from "./inventory.js";
import type {
  NxCloudAtlasChannel,
  NxCloudAtlasEntity,
  NxCloudAtlasGap,
  NxCloudAtlasKind,
  NxCloudChannelEntity,
  NxCloudCoverageCell,
  NxCloudSource,
} from "./model.js";
import { projectOrganization, projectWorkspace, projectWorkspaceRoster } from "./projection.js";
import { classifyNxCloudSegment, NX_CLOUD_SHAPE_DEPTH_CAP } from "./shape.js";
import { webDataGaps, webDataRechecks } from "./webDataGaps.js";

/** Which organisation and workspace a sync is reading. */
export interface NxCloudScope {
  readonly orgId: string;
  readonly workspaceId: string;
}

/** One inventory call's outcome, decoded, before anything decides what it means. */
export interface NxCloudCallOutcome {
  readonly callId: string;
  /** What was actually requested, so a record carries its own reproduction handle. */
  readonly url: string;
  /** The response, or `null` when the call never produced one. */
  readonly response: NxCloudResponse | null;
  /** The decoded payload, deferred values already resolved, or `null` when it could not be read. */
  readonly decoded: unknown;
  /** Why this call produced nothing usable, or `null` when it did. */
  readonly failure: NxCloudAtlasError | null;
}

/**
 * Everything one `web-data` pass concluded, per kind, ready to merge.
 *
 * @internal
 */
export interface NxCloudWebDataObservation {
  readonly entities: Readonly<Record<NxCloudAtlasKind, readonly NxCloudAtlasEntity[]>>;
  readonly coverage: Readonly<Record<NxCloudAtlasKind, readonly NxCloudCoverageCell[]>>;
  readonly gaps: readonly NxCloudAtlasGap[];
  /** What this pass actually rechecked, so a gap it answered can close rather than linger. */
  readonly rechecks: readonly AtlasGapRecheck[];
  /** Every call that failed, so a caller can refuse to publish a half-generation. */
  readonly failures: readonly NxCloudAtlasError[];
}

/**
 * The kit's coverage cell, stamped with the channel that produced it.
 *
 * @param cell the cell as the kit constructed it
 * @param channel which channel produced it
 * @returns the cell as this atlas stores it
 */
export function storedCoverageCell({
  cell,
  channel,
}: {
  cell: AtlasCoverageCell;
  channel: NxCloudAtlasChannel;
}): NxCloudCoverageCell {
  return {
    ...cell,
    artifacts: cell.artifacts.map((artifact) => ({ ...artifact })),
    channel,
    visibilityScope: "session-member-role",
  };
}

/**
 * This atlas's own gap vocabulary, beside `kit/gaps.ts`'s two cross-surface conditions.
 *
 * @internal
 */
export const NX_CLOUD_GAP_CONDITIONS = [
  "call-refused",
  "call-failed",
  "roster-omits-reachable-workspace",
  "route-unreachable",
] as const;

/** The one visibility ceiling both channels read under. See `descriptor.ts`. */
const VISIBILITY_SCOPE = "session-member-role";

/** The surface name the `web-data` channel publishes under. */
export const NX_CLOUD_WEB_DATA_SURFACE = "web-data";

/**
 * The channel record one fresh observation carries.
 *
 * @param detail what this channel knows
 * @param endpoint the reproduction handle
 * @param deepLink the URL a human opens to see this, or `null` when there is none
 * @param at this run's ISO timestamp
 * @returns the channel entity
 */
function webDataChannel({
  detail,
  endpoint,
  deepLink,
  at,
}: {
  detail: unknown;
  endpoint: string;
  deepLink: string | null;
  at: string;
}): NxCloudChannelEntity {
  const source: NxCloudSource = {
    artifacts: [],
    channel: "web-data",
    deepLink,
    deepLinkStatus: deepLink === null ? "unavailable" : "provider-provided",
    endpoint,
    observedAt: at,
  };
  return { channel: "web-data", detail, firstSeenAt: at, lastSeenAt: at, source, state: "observed" };
}

/**
 * Wrap one detail into a whole entity carrying only the `web-data` channel.
 *
 * @param id the stable entity id
 * @param kind the entity kind
 * @param providerId the provider's own key
 * @param scope the workspace or organisation this sits under
 * @param channel the fresh channel record
 * @returns the entity
 */
function entityOf({
  id,
  kind,
  providerId,
  scope,
  channel,
}: {
  id: string;
  kind: NxCloudAtlasKind;
  providerId: string;
  scope: string;
  channel: NxCloudChannelEntity;
}): NxCloudAtlasEntity {
  return { channels: { browser: null, "web-data": channel }, id, kind, providerId, scope };
}

/**
 * The human-facing URL for one scope, so every record carries the page a screenshot would be taken at.
 *
 * @param scope the organisation and workspace being read
 * @param suffix the path under the workspace, empty for the workspace itself
 * @returns the absolute URL
 *
 * @internal
 */
export function nxCloudDeepLink({ scope, suffix }: { scope: NxCloudScope; suffix: string }): string {
  const base = `${NX_CLOUD_ORIGIN}/orgs/${scope.orgId}/workspaces/${scope.workspaceId}`;
  return suffix === "" ? base : `${base}/${suffix}`;
}

/**
 * The path PATTERN one call is identified by — never the concrete path it was called at.
 *
 * A concrete path would mint one endpoint entity per workspace, which is how a surface map turns into an
 * entity index by accident. The template is rendered into the BROWSER channel's own placeholder vocabulary
 * first ({@link canonicalEndpointPattern}), because that pattern is what the two channels are matched on and
 * two spellings of one endpoint corroborate nothing.
 *
 * @param callId the call
 * @returns the pattern, or the call id itself when this build declares no such call
 */
function endpointPattern({ callId }: { callId: string }): string {
  const template = findNxCloudCall({ id: callId })?.pathTemplate ?? null;
  return template === null ? callId : canonicalEndpointPattern({ template });
}

/**
 * One endpoint entity per call this pass actually made.
 *
 * The response SHAPE is what is stored — `kit/responseShape.ts` paths, every value-shaped segment redacted
 * by this atlas's own classifier — so a payload's field names are held and not one of its values is.
 *
 * @param outcomes every call this pass made
 * @param at this run's ISO timestamp
 * @returns the endpoint entities, one per successful call
 */
export function endpointEntities({
  outcomes,
  at,
}: {
  outcomes: readonly NxCloudCallOutcome[];
  at: string;
}): readonly NxCloudAtlasEntity[] {
  return outcomes.flatMap((outcome): readonly NxCloudAtlasEntity[] => {
    if (outcome.response === null) {
      return [];
    }
    const call = findNxCloudCall({ id: outcome.callId });
    const pattern = endpointPattern({ callId: outcome.callId });
    const blocks = isRecord(outcome.decoded) ? Object.keys(outcome.decoded) : [];
    const detail = {
      callCount: 1,
      loaderRouteIds: blocks.toSorted(),
      queryParams: Object.keys(call?.query ?? {}).toSorted(),
      responseFields: responseFieldPaths({
        body: outcome.decoded,
        classify: classifyNxCloudSegment,
        depthCap: NX_CLOUD_SHAPE_DEPTH_CAP,
      }),
      seenOnRoutes: [],
      statusCode: outcome.response.statusCode,
    };
    return [
      entityOf({
        channel: webDataChannel({ at, deepLink: null, detail, endpoint: `GET ${pattern}` }),
        id: endpointEntityId({ method: "GET", pathPattern: pattern }),
        kind: "endpoint",
        providerId: `GET ${pattern}`,
        scope: "platform",
      }),
    ];
  });
}

/**
 * The organisation and workspace entities one overview read yields.
 *
 * Both come out of the same call and both are `null` when the payload carried no such block — which is what
 * a 403 looks like once decoded, and is exactly why the caller raises a gap rather than storing an entity
 * whose every field is null.
 *
 * @param outcome the `workspace-overview` call's outcome
 * @param scope the organisation and workspace being read
 * @param at this run's ISO timestamp
 * @returns the entities that could be projected, in kind order
 */
export function scopeEntities({
  outcome,
  scope,
  at,
}: {
  outcome: NxCloudCallOutcome;
  scope: NxCloudScope;
  at: string;
}): readonly NxCloudAtlasEntity[] {
  const endpoint = `GET ${endpointPattern({ callId: outcome.callId })}`;
  const organization = projectOrganization({
    data: loaderData({ routeId: "routes/_auth.orgs.$orgId", value: outcome.decoded }),
  });
  const workspace = projectWorkspace({
    data: loaderData({
      routeId: "routes/_auth.orgs.$orgId.workspaces.$workspaceId",
      value: outcome.decoded,
    }),
  });
  const entities: NxCloudAtlasEntity[] = [];
  if (organization !== null) {
    entities.push(
      entityOf({
        channel: webDataChannel({
          at,
          deepLink: `${NX_CLOUD_ORIGIN}/orgs/${scope.orgId}`,
          detail: organization,
          endpoint,
        }),
        id: organizationEntityId({ organizationId: scope.orgId }),
        kind: "organization",
        providerId: scope.orgId,
        scope: scope.orgId,
      }),
    );
  }
  if (workspace !== null) {
    entities.push(
      entityOf({
        channel: webDataChannel({
          at,
          deepLink: nxCloudDeepLink({ scope, suffix: "overview" }),
          detail: workspace,
          endpoint,
        }),
        id: workspaceEntityId({ workspaceId: scope.workspaceId }),
        kind: "workspace",
        providerId: scope.workspaceId,
        scope: scope.orgId,
      }),
    );
  }
  return entities;
}

/**
 * A workspace entity per row of the organisation's own roster.
 *
 * This is what makes the atlas hold the ORGANISATION rather than only the workspace it was pointed at: the
 * roster describes every workspace with the same fields the overview does, so one nobody has ever named on
 * a command line still lands with its default branch and its access levels.
 *
 * @param outcome the `org-workspaces` call's outcome
 * @param scope the organisation and workspace being read
 * @param at this run's ISO timestamp
 * @returns one entity per workspace the roster described
 *
 * @internal
 */
export function rosterWorkspaceEntities({
  outcome,
  scope,
  at,
}: {
  outcome: NxCloudCallOutcome | null;
  scope: NxCloudScope;
  at: string;
}): readonly NxCloudAtlasEntity[] {
  if (outcome === null) {
    return [];
  }
  const rows = projectWorkspaceRoster({
    data: loaderData({ routeId: "routes/_auth.orgs.$orgId.workspaces._index", value: outcome.decoded }),
    organizationId: scope.orgId,
  });
  const endpoint = `GET ${endpointPattern({ callId: outcome.callId })}`;
  return rows.map((row): NxCloudAtlasEntity =>
    entityOf({
      channel: webDataChannel({
        at,
        deepLink: `${NX_CLOUD_ORIGIN}/orgs/${scope.orgId}/workspaces/${row.id}/overview`,
        detail: row.detail,
        endpoint,
      }),
      id: workspaceEntityId({ workspaceId: row.id }),
      kind: "workspace",
      providerId: row.id,
      scope: scope.orgId,
    }),
  );
}

/**
 * One family entity per declared family, measured against whichever call reached it.
 *
 * A family whose call failed still produces an entity, with `recordsInWindow` null: the family EXISTS
 * whether or not this run could count it, and dropping the row would make a failed measurement
 * indistinguishable from a family that does not exist.
 *
 * @param outcomes every call this pass made
 * @param scope the organisation and workspace being read
 * @param at this run's ISO timestamp
 * @returns one entity per declared family
 *
 * @internal
 */
export function familyEntities({
  outcomes,
  scope,
  at,
}: {
  outcomes: readonly NxCloudCallOutcome[];
  scope: NxCloudScope;
  at: string;
}): readonly NxCloudAtlasEntity[] {
  return NX_CLOUD_FAMILY_SPECS.map((spec): NxCloudAtlasEntity => {
    const outcome = outcomes.find((candidate) => candidate.callId === spec.callId) ?? null;
    const data = outcome === null ? null : loaderData({ routeId: spec.routeId, value: outcome.decoded });
    const measurement = measureNxCloudFamily({ data, spec });
    const detail = {
      endpoint: endpointPattern({ callId: spec.callId }),
      recordsInWindow: measurement.recordsInWindow,
      reportedTotal: measurement.reportedTotal,
      responseFields: responseFieldPaths({
        body: data,
        classify: classifyNxCloudSegment,
        depthCap: NX_CLOUD_SHAPE_DEPTH_CAP,
      }),
      voluminousBecause: spec.voluminousBecause,
      windowDescription: spec.windowDescription,
    };
    return entityOf({
      channel: webDataChannel({
        at,
        deepLink: nxCloudDeepLink({ scope, suffix: "runs" }),
        detail,
        endpoint: `GET ${endpointPattern({ callId: spec.callId })}`,
      }),
      id: familyEntityId({ family: spec.name, workspaceId: scope.workspaceId }),
      kind: "family",
      providerId: spec.name,
      scope: scope.workspaceId,
    });
  });
}

/**
 * The coverage cell one kind earned this pass.
 *
 * @param kind the kind being graded
 * @param scope the concrete scope acquired
 * @param entityCount how many entities this pass produced for it
 * @param failed whether the call backing this kind failed
 * @param previous the cell as it stood before this attempt, or `null`
 * @param at this run's ISO timestamp
 * @returns the cell
 *
 * @internal
 */
export function webDataCoverageCell({
  kind,
  scope,
  entityCount,
  failed,
  previous,
  at,
}: {
  kind: NxCloudAtlasKind;
  scope: string;
  entityCount: number;
  failed: boolean;
  previous: AtlasCoverageCell | null;
  at: string;
}): AtlasCoverageCell {
  if (failed) {
    return failedCoverageCell({
      previous,
      reason: `the ${kind} read did not complete this run; what is held is whatever the last one published`,
      role: "authoritative",
      scope,
      state: "unreadable",
      surface: NX_CLOUD_WEB_DATA_SURFACE,
      unblockedBy: "run the sync again; a persistent failure is a gap on this kind naming the call",
      visibilityScope: VISIBILITY_SCOPE,
    });
  }
  return succeededCoverageCell({
    artifacts: [],
    at,
    reason: `${String(entityCount)} ${kind} record(s) read through the owner's own signed-in session`,
    role: "authoritative",
    scope,
    state: "synced",
    surface: NX_CLOUD_WEB_DATA_SURFACE,
    visibilityScope: VISIBILITY_SCOPE,
  });
}

/**
 * Turn one pass's raw outcomes into everything a publisher needs.
 *
 * @param outcomes every call this pass made, in inventory order
 * @param scope the organisation and workspace being read
 * @param at this run's ISO timestamp
 * @param previousCoverage the cells the stored generation holds, so a failure carries the prior success
 * @returns the entities, coverage, gaps and failures this pass concluded
 */
export function buildNxCloudWebData({
  outcomes,
  scope,
  at,
  previousCoverage,
}: {
  outcomes: readonly NxCloudCallOutcome[];
  scope: NxCloudScope;
  at: string;
  previousCoverage: Readonly<Partial<Record<NxCloudAtlasKind, AtlasCoverageCell | null>>>;
}): NxCloudWebDataObservation {
  const entities = webDataEntities({ at, outcomes, scope });
  const overview = outcomes.find((candidate) => candidate.callId === "workspace-overview") ?? null;
  const overviewFailed = overview === null || overview.response?.statusCode !== 200;
  return {
    coverage: webDataCoverage({ at, entities, overviewFailed, previousCoverage, scope }),
    entities,
    failures: outcomes.flatMap((outcome) => (outcome.failure === null ? [] : [outcome.failure])),
    gaps: webDataGaps({ at, outcomes, scope }),
    rechecks: webDataRechecks({ outcomes, scope }),
  };
}

/**
 * Every entity one `web-data` pass produced, per kind.
 *
 * The overview's own workspace record wins over the roster's for the workspace this run was pointed at:
 * both carry the same fields, and reading one thing twice in one pass would trip `mergeKind`'s duplicate
 * refusal — which is exactly the check that stops a count double-counting.
 *
 * @param outcomes every call this pass made
 * @param scope the organisation and workspace being read
 * @param at this run's ISO timestamp
 * @returns the entities, per kind
 *
 * @internal
 */
export function webDataEntities({
  outcomes,
  scope,
  at,
}: {
  outcomes: readonly NxCloudCallOutcome[];
  scope: NxCloudScope;
  at: string;
}): NxCloudWebDataObservation["entities"] {
  const overview = outcomes.find((candidate) => candidate.callId === "workspace-overview") ?? null;
  const scoped = overview === null ? [] : scopeEntities({ at, outcome: overview, scope });
  const scopedWorkspaces = scoped.filter((entity) => entity.kind === "workspace");
  const scopedIds = new Set(scopedWorkspaces.map((entity) => entity.id));
  const roster = rosterWorkspaceEntities({
    at,
    outcome: outcomes.find((candidate) => candidate.callId === "org-workspaces") ?? null,
    scope,
  });
  return {
    endpoint: endpointEntities({ at, outcomes }),
    family: familyEntities({ at, outcomes, scope }),
    organization: scoped.filter((entity) => entity.kind === "organization"),
    route: [],
    workspace: [...scopedWorkspaces, ...roster.filter((entity) => !scopedIds.has(entity.id))],
  };
}

/**
 * The coverage cell each kind earned this pass.
 *
 * The `route` kind gets none at all: the browser channel owns it, and a `web-data` pass writing an empty
 * cell there would claim to have looked at a surface it never touches.
 *
 * @param entities what this pass produced
 * @param overviewFailed whether the call backing the organisation and workspace kinds answered
 * @param previousCoverage the cells the stored generation holds, so a failure carries its prior success
 * @param scope the organisation and workspace being read
 * @param at this run's ISO timestamp
 * @returns the cells, per kind
 *
 * @internal
 */
export function webDataCoverage({
  entities,
  overviewFailed,
  previousCoverage,
  scope,
  at,
}: {
  entities: NxCloudWebDataObservation["entities"];
  overviewFailed: boolean;
  previousCoverage: Readonly<Partial<Record<NxCloudAtlasKind, AtlasCoverageCell | null>>>;
  scope: NxCloudScope;
  at: string;
}): NxCloudWebDataObservation["coverage"] {
  const cell = ({
    kind,
    entityCount,
    failed,
    cellScope,
  }: {
    kind: NxCloudAtlasKind;
    entityCount: number;
    failed: boolean;
    cellScope: string;
  }): readonly NxCloudCoverageCell[] => [
    storedCoverageCell({
      cell: webDataCoverageCell({
        at,
        entityCount,
        failed,
        kind,
        previous: previousCoverage[kind] ?? null,
        scope: cellScope,
      }),
      channel: "web-data",
    }),
  ];
  return {
    endpoint: cell({ cellScope: "platform", entityCount: entities.endpoint.length, failed: false, kind: "endpoint" }),
    family: cell({
      cellScope: scope.workspaceId,
      entityCount: entities.family.length,
      failed: entities.family.every((entity) => familyUnmeasured({ entity })),
      kind: "family",
    }),
    organization: cell({
      cellScope: scope.orgId,
      entityCount: entities.organization.length,
      failed: overviewFailed,
      kind: "organization",
    }),
    route: [],
    workspace: cell({
      cellScope: scope.workspaceId,
      entityCount: entities.workspace.length,
      failed: overviewFailed,
      kind: "workspace",
    }),
  };
}

/**
 * Whether one family entity carries no measurement at all — neither a window count nor a reported total.
 *
 * @param entity the family entity to inspect
 * @returns `true` when this run learned nothing about the family's size
 */
function familyUnmeasured({ entity }: { entity: NxCloudAtlasEntity }): boolean {
  // A channel that never looked learned nothing, exactly like one whose detail carries no measurement shape.
  const held = entity.channels["web-data"];
  if (held === null || !isRecord(held.detail)) {
    return true;
  }
  return held.detail["recordsInWindow"] === null && held.detail["reportedTotal"] === null;
}
