/**
 * Assemble a Slack atlas generation from the API surface ALONE — the half a scheduled pass can bring current
 * with no browser and no walk document. Pure, and the sibling of `./atlasSync.ts`'s walked assembly.
 *
 * ## Why this exists beside the walked assembly rather than inside it
 *
 * The descriptor's `resyncCommand` is what `resync-atlas-slack` runs every four hours, and a scheduled pass
 * has no walk document to hand `sync --session` — only a visible session's walk produces one. So the row
 * pointed at `sync` failed on every firing (board finding). `atlas slack-drive refresh` runs
 * this assembly and then prints the walk brief, the same two-phase shape `atlas graphql-hive refresh` and
 * `atlas workos refresh` declare.
 *
 * ## Why the `page` kind is not here
 *
 * Both halves of the page kind are the walk's: the browser channel is what a walk saw, and the declared map's
 * own deep links are composed through `surfacePageUrl` from `SlackSurfaceRoots.clientWorkspaceId`, which only
 * a walk document carries. So this assembly returns the `method` kind only and the store leaves `pages.jsonl`
 * exactly as the last walk published it; its manifest status is carried from the prior manifest, or the
 * never-attempted status on an install that has never walked.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { mergeKind } from "../kit/merge.js";
import { coverageCell, syncedStatus } from "./atlasCoverage.js";
import { reconcileMethodGaps } from "./atlasGaps.js";
import {
  emptySlackAtlasKindFile,
  SLACK_ATLAS_PLATFORM,
  SLACK_ATLAS_SCHEMA_VERSION,
  SLACK_ATLAS_VISIBILITY_SCOPE,
  type SlackAtlasEntity,
  type SlackAtlasGap,
  type SlackAtlasKind,
  type SlackAtlasKindFile,
  type SlackAtlasKindStatus,
  type SlackAtlasManifest,
  type SlackCoverageCell,
} from "./atlasModel.js";
import { matchMethodSurfaces, projectApiMethods } from "./atlasProjection.js";
import {
  compareSurfaces,
  type DisagreementSummary,
  type SurfaceComparison,
  summariseDisagreements,
} from "./disagreement.js";
import { foldSlackEntity } from "./entityFold.js";
import type { SdkMethod } from "./model.js";

/**
 * Mark a stored method's `api` channel stale when this SDK read no longer declares it — and nothing else.
 *
 * The API-only assembly's stale pass. {@link staleSlackEntity} stales BOTH channels, which is right after a
 * walked run because both surfaces were read; on a run that read only the installed typings, a method the
 * web client called and the SDK never declared has not disappeared — it was not looked for. So a browser-only
 * entity answers `null` and is left byte-identical, and an entity with both channels loses only its `api`.
 *
 * @param stored the method entity nothing observed this run
 * @returns the entity with its `api` channel staled, or `null` when there is nothing to stale
 */
export function staleSlackApiChannel({ stored }: { stored: SlackAtlasEntity }): SlackAtlasEntity | null {
  if (stored.channels.api === null || stored.channels.api.state === "stale") {
    return null;
  }
  return { ...stored, channels: { ...stored.channels, api: { ...stored.channels.api, state: "stale" } } };
}

/**
 * The browser cell an API-only run publishes: whatever the last WALK said, carried forward verbatim.
 *
 * Never rebuilt from an empty walk — `browserCoverage` over no pages would say "0 of N reached, failed",
 * which reports an attempt this run did not make. On an install that has never walked there is nothing to
 * carry, so the cell says so and names the two commands that fill it, with `lastSuccessAt` `null` rather
 * than this run's stamp.
 *
 * @param stored the method kind file already on disk, `null` when never published
 * @returns the cell
 *
 * @internal — exported for its own unit test.
 */
export function carriedBrowserCoverage({ stored }: { stored: SlackAtlasKindFile | null }): SlackCoverageCell {
  const prior = stored?.coverage.find((cell) => cell.channel === "browser");
  if (prior !== undefined) {
    return prior;
  }
  return {
    artifacts: [],
    channel: "browser",
    lastSuccessAt: null,
    latestAttemptFailed: false,
    reason:
      "no walk document has been handed back yet — `slopweaver atlas slack-drive plan` briefs the walk and " +
      "`slopweaver atlas slack-drive sync --session <document>` publishes it; this run read the installed SDK only",
    role: "authoritative",
    scope: "declared-surface-map",
    state: "deferred",
    surface: "browser",
    unblockedBy: null,
    visibilityScope: SLACK_ATLAS_VISIBILITY_SCOPE,
  };
}

/** What one API-only assembly produced — the `method` kind alone, and the manifest that vouches for it. */
export interface SlackAtlasApiGeneration {
  readonly files: Readonly<Pick<Record<SlackAtlasKind, SlackAtlasKindFile>, "method">>;
  readonly manifest: SlackAtlasManifest;
  readonly comparisons: readonly SurfaceComparison[];
  readonly summary: DisagreementSummary;
}

/**
 * Assemble one generation from the API surface ALONE — the `method` kind, and the manifest that vouches for it.
 *
 * The fold keeps every stored browser channel (an observed entity here has `browser: null`, and
 * {@link foldSlackEntity} keeps the stored slot for a `null` observation); the stale pass is
 * {@link staleSlackApiChannel}; the browser coverage cell is {@link carriedBrowserCoverage}. Method-gap
 * reconciliation still runs: an SDK bump that finally declares a parameter the web client always sent closes
 * an `api-browser-disagreement` gap, and that is an API-side fact this run can honestly assert.
 *
 * @param methods every method the installed SDK declares
 * @param stored the method kind file already on disk, `null` for a kind never published
 * @param priorManifest the manifest on disk, whose `page` status is carried forward; `null` when fresh
 * @param sdkVersion the installed `@slack/web-api` version the API channel was read from
 * @param at this run's ISO timestamp
 * @returns the generation, or every reason it cannot be assembled
 */
export function assembleSlackApiGeneration({
  methods,
  stored,
  priorManifest,
  sdkVersion,
  at,
}: {
  methods: readonly SdkMethod[];
  stored: SlackAtlasKindFile | null;
  priorManifest: SlackAtlasManifest | null;
  sdkVersion: string;
  at: string;
}): Result<SlackAtlasApiGeneration> {
  const priorEntities: readonly SlackAtlasEntity[] = stored === null ? [] : stored.entities;
  const priorGaps: readonly SlackAtlasGap[] = stored === null ? [] : stored.gaps;
  const merged = mergeKind({
    at,
    foldEntity: foldSlackEntity,
    observed: matchMethodSurfaces({ api: projectApiMethods({ at, methods }), browser: [] }),
    staleEntity: staleSlackApiChannel,
    stored: priorEntities,
  });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const comparisons = compareSurfaces({ entities: merged.value });
  const gaps = reconcileMethodGaps({ at, comparisons, stored: priorGaps });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  return ok({
    comparisons,
    files: {
      method: apiMethodKindFile({
        at,
        entities: merged.value,
        gaps: gaps.value,
        methodCount: methods.length,
        sdkVersion,
        stored,
      }),
    },
    manifest: {
      kinds: { method: syncedStatus({ at }), page: carriedPageStatus({ priorManifest }) },
      platform: SLACK_ATLAS_PLATFORM,
      schemaVersion: SLACK_ATLAS_SCHEMA_VERSION,
      sdkVersion,
      updatedAt: at,
    },
    summary: summariseDisagreements({ comparisons }),
  });
}

/**
 * The method kind file an API-only run writes: this read's api cell, the last walk's browser cell, the merged
 * entities and the reconciled gaps.
 *
 * @param entities the merged method entities
 * @param gaps the reconciled method gaps
 * @param methodCount how many methods the installed SDK declared, which the api cell reports
 * @param stored the method kind file already on disk, whose browser cell is carried forward
 * @param sdkVersion the installed `@slack/web-api` version
 * @param at this run's ISO timestamp
 * @returns the kind file, ready to publish
 */
function apiMethodKindFile({
  entities,
  gaps,
  methodCount,
  stored,
  sdkVersion,
  at,
}: {
  entities: readonly SlackAtlasEntity[];
  gaps: readonly SlackAtlasGap[];
  methodCount: number;
  stored: SlackAtlasKindFile | null;
  sdkVersion: string;
  at: string;
}): SlackAtlasKindFile {
  return {
    ...emptySlackAtlasKindFile({ kind: "method", updatedAt: at }),
    coverage: [
      coverageCell({
        at,
        channel: "api",
        failed: false,
        reason: `${String(methodCount)} method(s) declared by @slack/web-api ${sdkVersion}`,
        scope: "installed-sdk",
        state: "synced",
      }),
      carriedBrowserCoverage({ stored }),
    ],
    entities: [...entities],
    gaps: [...gaps],
  };
}

/**
 * The page kind's manifest status, carried from the prior manifest because this run did not touch the kind.
 *
 * @param priorManifest the manifest on disk, `null` on an install that has never published
 * @returns the prior status, or the never-attempted status when there is none
 */
function carriedPageStatus({ priorManifest }: { priorManifest: SlackAtlasManifest | null }): SlackAtlasKindStatus {
  if (priorManifest === null) {
    return { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  }
  return priorManifest.kinds.page;
}
