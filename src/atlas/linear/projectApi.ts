/**
 * The API channel's own projection: schema operations, schema types, and configuration, plus the coverage
 * and gaps each earned. PURE.
 *
 * Split from `projection.ts` so the two channels' judgements sit in separate files. They answer different
 * questions and fail in different ways — a refused configuration read is an entitlement fact, a lost page
 * is a browser fact — and reading one while looking for the other was the thing that made the combined file
 * hard to follow.
 */
import { failedCoverageCell, succeededCoverageCell } from "../kit/coverage.js";
import { openGap } from "../kit/gaps.js";

import type { LinearApiSurfaceReading } from "./apiSurface.js";
import { settingsDeepLink } from "./deepLinks.js";
import {
  LINEAR_ATLAS_VISIBILITY_SCOPE,
  type LinearAtlasEntity,
  type LinearAtlasGap,
  type LinearAtlasKind,
  type LinearCoverageCell,
  type LinearSource,
} from "./model.js";
import {
  API_SURFACE,
  byKind,
  type ChannelProjection,
  cell,
  gap,
  oneChannelEntity,
  priorCoverageCell,
} from "./projectionKit.js";

/** Project the API channel: operations, types and settings, plus the coverage each earned.  * @returns the entities, coverage and gaps the API channel earned
 */
export function projectApiChannel({
  reading,
  at,
  workspaceUrlBase,
  previous,
}: {
  reading: LinearApiSurfaceReading;
  at: string;
  workspaceUrlBase: string | null;
  previous: Readonly<Record<LinearAtlasKind, readonly LinearCoverageCell[]>>;
}): ChannelProjection {
  const entities = byKind<LinearAtlasEntity[]>({ make: () => [] });
  const coverage = byKind<LinearCoverageCell[]>({ make: () => [] });
  const gaps = byKind<LinearAtlasGap[]>({ make: () => [] });

  foldSchema({ at, coverage, entities, reading });
  foldSettings({ at, entities, coverage, gaps, previous, reading, workspaceUrlBase });

  return { coverage, entities, gaps };
}

/**
 * Fold every configuration surface's outcome into the `setting` kind: its records, its coverage cell, and
 * the gap a refusal or a paging bound earns.
 *
 * Separate from {@link projectApiChannel} because it is the half with all the branching — the schema half
 * is a straight map — and because a refused configuration read is the single most important thing this
 * atlas says about its own coverage.
 *
 * @param at this run's ISO timestamp
 * @param entities the entity accumulator to fill
 * @param coverage the coverage accumulator to fill
 * @param gaps the gap accumulator to fill
 * @param previous the coverage the stored generation holds, so a refusal keeps its prior success
 * @param reading what the API channel read
 * @param workspaceUrlBase the workspace's own settings root, for a record's deep link
 */
function foldSettings({
  at,
  entities,
  coverage,
  gaps,
  previous,
  reading,
  workspaceUrlBase,
}: {
  at: string;
  entities: Record<LinearAtlasKind, LinearAtlasEntity[]>;
  coverage: Record<LinearAtlasKind, LinearCoverageCell[]>;
  gaps: Record<LinearAtlasKind, LinearAtlasGap[]>;
  previous: Readonly<Record<LinearAtlasKind, readonly LinearCoverageCell[]>>;
  reading: LinearApiSurfaceReading;
  workspaceUrlBase: string | null;
}): void {
  for (const outcome of reading.settings) {
    foldSettingRecords({ at, entities, outcome, workspaceUrlBase });
    if (outcome.refusedBecause !== null) {
      foldRefusedSurface({ at, coverage, gaps, outcome, previous, refusedBecause: outcome.refusedBecause });
      continue;
    }
    coverage.setting.push(
      cell({
        built: succeededCoverageCell({
          artifacts: [],
          at,
          reason: `${String(outcome.records.length)} record(s) over ${String(outcome.pagesRead)} page(s)`,
          role: "authoritative",
          scope: outcome.group,
          state: "synced",
          surface: API_SURFACE,
          visibilityScope: LINEAR_ATLAS_VISIBILITY_SCOPE,
        }),
        channel: "api",
      }),
    );
    if (outcome.pageBoundReached) {
      gaps.setting.push(
        gap({
          built: openGap({
            at,
            condition: "settings-paging-bound-reached",
            fields: [],
            kind: "setting",
            reason: `${outcome.group} was still reporting more pages after the paging bound, so this read is incomplete`,
            scope: outcome.group,
            surfaces: ["api"],
          }),
          kind: "setting",
        }),
      );
    }
  }
}

/**
 * Fold one configuration surface's records into the `setting` kind, each carrying the page that shows it.
 *
 * @param at this run's ISO timestamp
 * @param entities the accumulator to fill
 * @param outcome the surface's own read
 * @param workspaceUrlBase the workspace's settings root, for a record's deep link
 */
function foldSettingRecords({
  at,
  entities,
  outcome,
  workspaceUrlBase,
}: {
  at: string;
  entities: Record<LinearAtlasKind, LinearAtlasEntity[]>;
  outcome: LinearApiSurfaceReading["settings"][number];
  workspaceUrlBase: string | null;
}): void {
  for (const record of outcome.records) {
    const deepLink = settingsDeepLink({
      group: outcome.group,
      scope: record.detail.settingScope,
      urlBase: workspaceUrlBase,
    });
    entities.setting.push(
      oneChannelEntity({
        at,
        channel: "api",
        detail: record.detail,
        kind: "setting",
        providerId: record.providerId,
        source: {
          artifacts: [],
          channel: "api",
          deepLink,
          deepLinkStatus: deepLink === null ? "unavailable" : "unverified",
          endpoint: `POST /graphql — ${outcome.group}`,
          observedAt: at,
        },
      }),
    );
  }
}

/**
 * Fold a configuration surface this account's entitlements REFUSED: an `unavailable` cell carrying the
 * provider's own sentence, and a gap naming what would unblock it.
 *
 * Its own function because it is the most important thing this atlas says about its own coverage, and
 * because a refusal must keep the prior generation's success rather than erasing it.
 *
 * @param at this run's ISO timestamp
 * @param coverage the coverage accumulator to fill
 * @param gaps the gap accumulator to fill
 * @param outcome the surface's own read
 * @param previous the coverage the stored generation holds
 * @param refusedBecause the provider's own refusal sentence
 */
function foldRefusedSurface({
  at,
  coverage,
  gaps,
  outcome,
  previous,
  refusedBecause,
}: {
  at: string;
  coverage: Record<LinearAtlasKind, LinearCoverageCell[]>;
  gaps: Record<LinearAtlasKind, LinearAtlasGap[]>;
  outcome: LinearApiSurfaceReading["settings"][number];
  previous: Readonly<Record<LinearAtlasKind, readonly LinearCoverageCell[]>>;
  refusedBecause: string;
}): void {
  coverage.setting.push(
    cell({
      built: failedCoverageCell({
        previous: priorCoverageCell({ cells: previous.setting, matches: (held) => held.scope === outcome.group }),
        reason: `Linear refused this configuration read: ${refusedBecause}`,
        role: "authoritative",
        scope: outcome.group,
        state: "unavailable",
        surface: API_SURFACE,
        unblockedBy: "a credential whose actor holds the entitlement Linear named in the refusal",
        visibilityScope: LINEAR_ATLAS_VISIBILITY_SCOPE,
      }),
      channel: "api",
    }),
  );
  gaps.setting.push(
    gap({
      built: openGap({
        at,
        condition: "settings-surface-refused",
        fields: [],
        kind: "setting",
        reason: `the ${outcome.group} configuration could not be read: ${refusedBecause}`,
        scope: outcome.group,
        surfaces: ["api"],
      }),
      kind: "setting",
    }),
  );
}

/**
 * Fold the schema half into the `operation` and `type` kinds, plus the one coverage cell each earns.
 *
 * @param at this run's ISO timestamp
 * @param coverage the coverage accumulator to fill
 * @param entities the entity accumulator to fill
 * @param reading what the API channel read
 */
function foldSchema({
  at,
  coverage,
  entities,
  reading,
}: {
  at: string;
  coverage: Record<LinearAtlasKind, LinearCoverageCell[]>;
  entities: Record<LinearAtlasKind, LinearAtlasEntity[]>;
  reading: LinearApiSurfaceReading;
}): void {
  const schemaSource = ({ endpoint }: { endpoint: string }): LinearSource => ({
    artifacts: [],
    channel: "api",
    deepLink: null,
    deepLinkStatus: "unavailable",
    endpoint,
    observedAt: at,
  });
  for (const record of reading.operations) {
    entities.operation.push(
      oneChannelEntity({
        at,
        channel: "api",
        detail: record.detail,
        kind: "operation",
        providerId: record.providerId,
        source: schemaSource({ endpoint: "POST /graphql — __schema introspection" }),
      }),
    );
  }
  for (const record of reading.types) {
    entities.type.push(
      oneChannelEntity({
        at,
        channel: "api",
        detail: record.detail,
        kind: "type",
        providerId: record.providerId,
        source: schemaSource({ endpoint: "POST /graphql — __type introspection" }),
      }),
    );
  }
  foldSchemaCoverage({ at, coverage, reading });
}

/**
 * The one coverage cell the schema read earns, on each of the two kinds it fills.
 *
 * @param at this run's ISO timestamp
 * @param coverage the accumulator to fill
 * @param reading what the API channel read
 */
function foldSchemaCoverage({
  at,
  coverage,
  reading,
}: {
  at: string;
  coverage: Record<LinearAtlasKind, LinearCoverageCell[]>;
  reading: LinearApiSurfaceReading;
}): void {
  for (const kind of ["operation", "type"] as const) {
    coverage[kind].push(
      cell({
        built: succeededCoverageCell({
          artifacts: [],
          at,
          reason: `the whole GraphQL schema, read in ${String(reading.introspectionBatches)} introspection batch(es)`,
          role: "authoritative",
          scope: "schema",
          state: "synced",
          surface: API_SURFACE,
          visibilityScope: LINEAR_ATLAS_VISIBILITY_SCOPE,
        }),
        channel: "api",
      }),
    );
  }
}
