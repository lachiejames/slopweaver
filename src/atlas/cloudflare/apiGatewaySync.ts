/**
 * Read, fan out and fold the `api-gateway` kind — its own module, registered by `nonFlatKinds.ts` as
 * `syncApiGatewayKind` for the same file-size reason `pagesSync.ts`/
 * `firewallServiceSync.ts`/`zoneCertificateSync.ts` were.
 *
 * Eight independent API Gateway surfaces fold into this one kind, each read and folded INDEPENDENTLY — the
 * same "N independent same-level collections, per-subtype partial credit" shape `zoneCertificateSync.ts`
 * established, via the same `Record<subtype, read>` map. A failed subtype preserves only its own
 * previously-stored entities; kind-level `complete` requires all eight to have succeeded this run.
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
  CLOUDFLARE_API_GATEWAY_SUBTYPES,
  type CloudflareApiGatewaySubtype,
  isCloudflareApiGatewayDetailOf,
} from "./projection/apiGateway.js";
import {
  readCloudflareApiGatewayConfiguration,
  readCloudflareApiGatewayLabels,
  readCloudflareApiGatewayOperations,
  readCloudflareApiGatewaySchemas,
  readCloudflareApiGatewaySettings,
  readCloudflareDiscoveryOperations,
  readCloudflareDiscoverySchemas,
  readCloudflareUserSchemas,
} from "./readers/apiGateway.js";

type ApiGatewaySubtypeRead = () => Promise<Result<readonly CloudflareEntity[], CloudflareClientError>>;

/**
 * Every subtype's independent read, keyed by subtype name — the one place a new `api-gateway` subtype gets
 * registered.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every subtype's own read thunk
 */
function apiGatewaySubtypeReads({
  client,
  accountId,
  zoneId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  zoneId: string;
  at: string;
}): Record<CloudflareApiGatewaySubtype, ApiGatewaySubtypeRead> {
  return {
    configuration: () => readCloudflareApiGatewayConfiguration({ accountId, at, client, zoneId }),
    "discovery-operation": () => readCloudflareDiscoveryOperations({ accountId, at, client, zoneId }),
    "discovery-schema": () => readCloudflareDiscoverySchemas({ accountId, at, client, zoneId }),
    label: () => readCloudflareApiGatewayLabels({ accountId, at, client, zoneId }),
    operation: () => readCloudflareApiGatewayOperations({ accountId, at, client, zoneId }),
    schema: () => readCloudflareApiGatewaySchemas({ accountId, at, client, zoneId }),
    settings: () => readCloudflareApiGatewaySettings({ accountId, at, client, zoneId }),
    "user-schema": () => readCloudflareUserSchemas({ accountId, at, client, zoneId }),
  };
}

/**
 * Run every subtype's read concurrently, each tagged by its own subtype name.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every subtype's own read attempt, tagged
 */
async function readApiGatewaySubtypes({
  client,
  accountId,
  zoneId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  zoneId: string;
  at: string;
}): Promise<readonly [CloudflareApiGatewaySubtype, Result<readonly CloudflareEntity[], CloudflareClientError>][]> {
  const reads = apiGatewaySubtypeReads({ accountId, at, client, zoneId });
  return Promise.all(
    CLOUDFLARE_API_GATEWAY_SUBTYPES.map(async (subtype) => [subtype, await reads[subtype]()] as const),
  );
}

/** One subtype's independent read attempt, folded against what was stored for that subtype alone. */
interface ApiGatewaySubtypeFold {
  readonly entities: readonly CloudflareEntity[];
  readonly failed: boolean;
  readonly reason: string | null;
  readonly gapInputs: {
    readonly observed: readonly CloudflareGap[];
    readonly rechecks: readonly CloudflareGapRecheck[];
  };
}

/**
 * Fold one subtype's independent read attempt — on success, its entities replace whatever was stored for
 * that subtype; on failure, its previously-stored entities FOR THIS ZONE are preserved untouched and a gap opens at its
 * own scope. The same shape `zoneCertificateSync.ts`'s `foldZoneCertificateSubtype` established.
 *
 * @param stored the `api-gateway` kind file as it stood before this run
 * @param subtype the subtype this attempt is for
 * @param result this subtype's own read attempt
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns this subtype's entities and gap inputs, isolated from every other subtype's outcome
 */
function foldApiGatewaySubtype({
  stored,
  subtype,
  result,
  zoneId,
  at,
}: {
  stored: CloudflareKindFile;
  subtype: CloudflareApiGatewaySubtype;
  result: Result<readonly CloudflareEntity[], CloudflareClientError>;
  zoneId: string;
  at: string;
}): ApiGatewaySubtypeFold {
  const scope = `zone/${zoneId}/api-gateway/${subtype}`;
  if (result.isErr()) {
    const preserved = entitiesInZone({ stored, zoneId }).filter((entity) =>
      isCloudflareApiGatewayDetailOf({ subtype, value: entity.detail }),
    );
    return {
      entities: preserved,
      failed: true,
      gapInputs: {
        observed: [
          openCloudflareGap({
            at,
            condition: classifyCloudflareClientErrorGap({ error: result.error }),
            kind: "api-gateway",
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
 * Read, fan out and fold this run's `api-gateway` attempt into its stored kind file — see this module's
 * header for why each of the eight API Gateway surfaces is read and folded independently.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param zoneId the configured deep zone id
 * @param stored the `api-gateway` kind file as it stood before this run
 * @param at this run's ISO timestamp
 * @returns the file to publish and this run's outcome, or why the reconciliation itself failed
 */
export async function syncApiGatewayKind({
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
  const attempts = await readApiGatewaySubtypes({ accountId, at, client, zoneId });

  const folds = attempts.map(([subtype, result]) => foldApiGatewaySubtype({ at, result, stored, subtype, zoneId }));
  const zoneEntities = folds.flatMap((fold) => fold.entities);
  const reasons = folds.map((fold) => fold.reason).filter((reason): reason is string => reason !== null);
  const complete = reasons.length === 0;
  const scope = deepZoneKindScope({ kind: "api-gateway", zoneId });
  const cell = buildFanoutCoverageCell({
    at,
    complete,
    reasons,
    scope,
    stored,
    successReason: `reconciled ${String(zoneEntities.length)} API Gateway entit${zoneEntities.length === 1 ? "y" : "ies"} across all ${String(CLOUDFLARE_API_GATEWAY_SUBTYPES.length)} subtypes`,
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
    kind: "api-gateway",
    kindScopeRead: "not-made",
    reasons,
    scope,
    stored,
  });
}
