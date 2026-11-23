/**
 * Read, fan out and fold the `zone-analytics` kind — its own module, registered by `nonFlatKinds.ts` as
 * `syncZoneAnalyticsKind` for the same file-size reason `apiGatewaySync.ts`/
 * `zoneCertificateSync.ts` were.
 *
 * Two independent GraphQL Analytics API datasets fold into this one kind, each read and folded
 * INDEPENDENTLY — the same "N independent same-level collections, per-subtype partial credit" shape
 * `zoneCertificateSync.ts` established, via the same `Record<subtype, read>` map. A failed subtype
 * preserves only its own previously-stored entity FOR THE ZONE BEING READ, every other zone's being carried
 * forward by `kindFold.ts`'s `withOtherZonesRetained`; kind-level `complete` requires both to have succeeded
 * this run. This matters concretely here: a lower Cloudflare plan can have DNS Analytics enabled without
 * HTTP Analytics or vice versa, so one dataset being unavailable must never blank out the other.
 */
import type Cloudflare from "cloudflare";

import type { Result } from "../../lib/result.js";
import type { CloudflareClientError } from "./errors.js";
import {
  CLOUDFLARE_GAP_CONDITIONS,
  type CloudflareGapRecheck,
  classifyCloudflareClientErrorGap,
  openCloudflareGap,
} from "./gaps.js";
import {
  buildFanoutCoverageCell,
  deepZoneKindScope,
  entitiesInZone,
  foldFanoutResult,
  type KindFoldResult,
  withOtherZonesRetained,
} from "./kindFold.js";
import type { CloudflareEntity, CloudflareGap, CloudflareKindFile } from "./model.js";
import {
  CLOUDFLARE_ZONE_ANALYTICS_SUBTYPES,
  type CloudflareZoneAnalyticsSubtype,
  isCloudflareZoneAnalyticsDetailOf,
} from "./projection/zoneAnalytics.js";
import { readCloudflareDnsQueriesAnalytics, readCloudflareHttpRequestsAnalytics } from "./readers/zoneAnalytics.js";

type ZoneAnalyticsSubtypeRead = () => Promise<Result<readonly CloudflareEntity[], CloudflareClientError>>;

/**
 * Every subtype's independent read, keyed by subtype name — the one place a new `zone-analytics` subtype
 * gets registered.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every subtype's own read thunk
 */
function zoneAnalyticsSubtypeReads({
  client,
  accountId,
  zoneId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  zoneId: string;
  at: string;
}): Record<CloudflareZoneAnalyticsSubtype, ZoneAnalyticsSubtypeRead> {
  return {
    "dns-queries": () => readCloudflareDnsQueriesAnalytics({ accountId, at, client, zoneId }),
    "http-requests": () => readCloudflareHttpRequestsAnalytics({ accountId, at, client, zoneId }),
  };
}

/**
 * Run every subtype's read sequentially, each tagged by its own subtype name — sequential rather than
 * concurrent, per the plan's explicit "no rate scheduler" constraint for this kind.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every subtype's own read attempt, tagged
 */
async function readZoneAnalyticsSubtypes({
  client,
  accountId,
  zoneId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  zoneId: string;
  at: string;
}): Promise<readonly [CloudflareZoneAnalyticsSubtype, Result<readonly CloudflareEntity[], CloudflareClientError>][]> {
  const reads = zoneAnalyticsSubtypeReads({ accountId, at, client, zoneId });
  const attempts: [CloudflareZoneAnalyticsSubtype, Result<readonly CloudflareEntity[], CloudflareClientError>][] = [];
  for (const subtype of CLOUDFLARE_ZONE_ANALYTICS_SUBTYPES) {
    attempts.push([subtype, await reads[subtype]()]);
  }
  return attempts;
}

/** One subtype's independent read attempt, folded against what was stored for that subtype alone. */
interface ZoneAnalyticsSubtypeFold {
  readonly entities: readonly CloudflareEntity[];
  readonly failed: boolean;
  readonly reason: string | null;
  readonly gapInputs: {
    readonly observed: readonly CloudflareGap[];
    readonly rechecks: readonly CloudflareGapRecheck[];
  };
}

/**
 * Fold one subtype's independent read attempt — on success, its entity replaces whatever was stored for
 * that subtype; on failure, its previously-stored entity FOR THIS ZONE is preserved untouched and a gap opens at its own
 * scope. The same shape `zoneCertificateSync.ts`'s `foldZoneCertificateSubtype` established.
 *
 * @param stored the `zone-analytics` kind file as it stood before this run
 * @param subtype the subtype this attempt is for
 * @param result this subtype's own read attempt
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns this subtype's entities and gap inputs, isolated from every other subtype's outcome
 */
function foldZoneAnalyticsSubtype({
  stored,
  subtype,
  result,
  zoneId,
  at,
}: {
  stored: CloudflareKindFile;
  subtype: CloudflareZoneAnalyticsSubtype;
  result: Result<readonly CloudflareEntity[], CloudflareClientError>;
  zoneId: string;
  at: string;
}): ZoneAnalyticsSubtypeFold {
  const scope = `zone/${zoneId}/zone-analytics/${subtype}`;
  if (result.isErr()) {
    const preserved = entitiesInZone({ stored, zoneId }).filter((entity) =>
      isCloudflareZoneAnalyticsDetailOf({ subtype, value: entity.detail }),
    );
    return {
      entities: preserved,
      failed: true,
      gapInputs: {
        observed: [
          openCloudflareGap({
            at,
            condition: classifyCloudflareClientErrorGap({ error: result.error }),
            kind: "zone-analytics",
            reason: result.error.message,
            scope,
          }),
        ],
        rechecks: [],
      },
      reason: `${subtype}: ${result.error.message}`,
    };
  }
  return {
    entities: result.value,
    failed: false,
    gapInputs: {
      observed: [],
      rechecks: CLOUDFLARE_GAP_CONDITIONS.map((condition) => ({ condition, resolved: true, scope })),
    },
    reason: null,
  };
}

/**
 * Read, fan out and fold this run's `zone-analytics` attempt into its stored kind file — see this module's
 * header for why each of the two analytics datasets is read and folded independently.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param zoneId the configured deep zone id
 * @param stored the `zone-analytics` kind file as it stood before this run
 * @param at this run's ISO timestamp
 * @returns the file to publish and this run's outcome, or why the reconciliation itself failed
 */
export async function syncZoneAnalyticsKind({
  client,
  accountId,
  zoneId,
  stored,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  zoneId: string;
  stored: CloudflareKindFile;
  at: string;
}): Promise<Result<KindFoldResult>> {
  const attempts = await readZoneAnalyticsSubtypes({ accountId, at, client, zoneId });

  const folds = attempts.map(([subtype, result]) => foldZoneAnalyticsSubtype({ at, result, stored, subtype, zoneId }));
  const zoneEntities = folds.flatMap((fold) => fold.entities);
  const reasons = folds.map((fold) => fold.reason).filter((reason): reason is string => reason !== null);
  const complete = reasons.length === 0;
  const scope = deepZoneKindScope({ kind: "zone-analytics", zoneId });
  const cell = buildFanoutCoverageCell({
    at,
    complete,
    reasons,
    scope,
    stored,
    successReason: `reconciled ${String(zoneEntities.length)} zone-analytics entit${zoneEntities.length === 1 ? "y" : "ies"} across both datasets`,
  });

  const gapInputs = {
    observed: folds.flatMap((fold) => fold.gapInputs.observed),
    rechecks: folds.flatMap((fold) => fold.gapInputs.rechecks),
  };
  return foldFanoutResult({
    at,
    cell,
    complete,
    entities: withOtherZonesRetained({ entities: zoneEntities, stored, zoneId }),
    gapInputs,
    kind: "zone-analytics",
    kindScopeRead: "not-made",
    reasons,
    scope,
    stored,
  });
}
