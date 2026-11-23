/**
 * Read, fan out and fold the `zone-certificate` kind — its own module, registered by `nonFlatKinds.ts` as
 * `syncZoneCertificateKind` for the same file-size reason `pagesSync.ts`/
 * `firewallServiceSync.ts` were.
 *
 * Every SSL/certificate surface in `CLOUDFLARE_ZONE_CERTIFICATE_SUBTYPES` folds into this one kind, each read
 * and folded INDEPENDENTLY — the same "N independent same-level collections, per-subtype partial credit"
 * shape `firewallServiceSync.ts` established, generalized here to a `Record<subtype, read>` map instead of a
 * hand-written `Promise.all` list, since that many entries made the six-entry version's repetition worth
 * collapsing. A failed subtype preserves only its own previously-stored entities FOR THE ZONE BEING READ;
 * kind-level `complete` requires every subtype to have succeeded this run. Every other zone's entities are carried forward untouched by
 * `kindFold.ts`'s `withOtherZonesRetained`, since a read of one zone says nothing about another.
 *
 * Two real surfaces are deliberately NOT read here — see `projection/zoneCertificate.ts`'s header for why
 * Authenticated Origin Pull's per-hostname association and certificate packs' quota counter are excluded
 * rather than built.
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
  CLOUDFLARE_ZONE_CERTIFICATE_SUBTYPES,
  type CloudflareZoneCertificateSubtype,
  isCloudflareZoneCertificateDetailOf,
} from "./projection/zoneCertificateDetail.js";
import {
  readCloudflareAopHostnameCertificates,
  readCloudflareAopSetting,
  readCloudflareAopZoneCertificates,
  readCloudflareCertificatePacks,
  readCloudflareClientCertificates,
  readCloudflareCustomCertificates,
  readCloudflareCustomHostnames,
  readCloudflareKeylessCertificates,
  readCloudflareOriginCaCertificates,
} from "./readers/zoneCertificate.js";
import {
  readCloudflareUniversalSslSetting,
  readCloudflareUniversalSslVerification,
} from "./readers/zoneCertificateUniversal.js";

type ZoneCertificateSubtypeRead = () => Promise<Result<readonly CloudflareEntity[], CloudflareClientError>>;

/**
 * Every subtype's independent read, keyed by subtype name — the one place a new `zone-certificate` subtype
 * gets registered.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every subtype's own read thunk
 */
function zoneCertificateSubtypeReads({
  client,
  accountId,
  zoneId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  zoneId: string;
  at: string;
}): Record<CloudflareZoneCertificateSubtype, ZoneCertificateSubtypeRead> {
  return {
    "aop-hostname-certificate": () => readCloudflareAopHostnameCertificates({ accountId, at, client, zoneId }),
    "aop-setting": () => readCloudflareAopSetting({ accountId, at, client, zoneId }),
    "aop-zone-certificate": () => readCloudflareAopZoneCertificates({ accountId, at, client, zoneId }),
    "certificate-pack": () => readCloudflareCertificatePacks({ accountId, at, client, zoneId }),
    "client-certificate": () => readCloudflareClientCertificates({ accountId, at, client, zoneId }),
    "custom-certificate": () => readCloudflareCustomCertificates({ accountId, at, client, zoneId }),
    "custom-hostname": () => readCloudflareCustomHostnames({ accountId, at, client, zoneId }),
    "keyless-certificate": () => readCloudflareKeylessCertificates({ accountId, at, client, zoneId }),
    "origin-ca-certificate": () => readCloudflareOriginCaCertificates({ accountId, at, client, zoneId }),
    "universal-ssl-setting": () => readCloudflareUniversalSslSetting({ accountId, at, client, zoneId }),
    "universal-ssl-verification": () => readCloudflareUniversalSslVerification({ accountId, at, client, zoneId }),
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
async function readZoneCertificateSubtypes({
  client,
  accountId,
  zoneId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  zoneId: string;
  at: string;
}): Promise<readonly [CloudflareZoneCertificateSubtype, Result<readonly CloudflareEntity[], CloudflareClientError>][]> {
  const reads = zoneCertificateSubtypeReads({ accountId, at, client, zoneId });
  return Promise.all(
    CLOUDFLARE_ZONE_CERTIFICATE_SUBTYPES.map(async (subtype) => [subtype, await reads[subtype]()] as const),
  );
}

/** One subtype's independent read attempt, folded against what was stored for that subtype alone. */
interface ZoneCertificateSubtypeFold {
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
 * own scope. The same shape `firewallServiceSync.ts`'s `foldFirewallServiceSubtype` established.
 *
 * @param stored the `zone-certificate` kind file as it stood before this run
 * @param subtype the subtype this attempt is for
 * @param result this subtype's own read attempt
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns this subtype's entities and gap inputs, isolated from every other subtype's outcome
 */
function foldZoneCertificateSubtype({
  stored,
  subtype,
  result,
  zoneId,
  at,
}: {
  stored: CloudflareKindFile;
  subtype: CloudflareZoneCertificateSubtype;
  result: Result<readonly CloudflareEntity[], CloudflareClientError>;
  zoneId: string;
  at: string;
}): ZoneCertificateSubtypeFold {
  const scope = `zone/${zoneId}/zone-certificate/${subtype}`;
  if (result.isErr()) {
    const preserved = entitiesInZone({ stored, zoneId }).filter((entity) =>
      isCloudflareZoneCertificateDetailOf({ subtype, value: entity.detail }),
    );
    return {
      entities: preserved,
      failed: true,
      gapInputs: {
        observed: [
          openCloudflareGap({
            at,
            condition: classifyCloudflareClientErrorGap({ error: result.error }),
            kind: "zone-certificate",
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
 * Read, fan out and fold this run's `zone-certificate` attempt into its stored kind file — see this module's
 * header for why each SSL/certificate surface is read and folded independently.
 *
 * @param client the constructed, guarded Cloudflare client
 * @param accountId the selected, live-verified account id
 * @param zoneId the configured deep zone id
 * @param stored the `zone-certificate` kind file as it stood before this run
 * @param at this run's ISO timestamp
 * @returns the file to publish and this run's outcome, or why the reconciliation itself failed
 */
export async function syncZoneCertificateKind({
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
  const attempts = await readZoneCertificateSubtypes({ accountId, at, client, zoneId });

  const folds = attempts.map(([subtype, result]) =>
    foldZoneCertificateSubtype({ at, result, stored, subtype, zoneId }),
  );
  const zoneEntities = folds.flatMap((fold) => fold.entities);
  const reasons = folds.map((fold) => fold.reason).filter((reason): reason is string => reason !== null);
  const complete = reasons.length === 0;
  const scope = deepZoneKindScope({ kind: "zone-certificate", zoneId });
  const cell = buildFanoutCoverageCell({
    at,
    complete,
    reasons,
    scope,
    stored,
    successReason: `reconciled ${String(zoneEntities.length)} certificate/SSL entit${zoneEntities.length === 1 ? "y" : "ies"} across all ${String(CLOUDFLARE_ZONE_CERTIFICATE_SUBTYPES.length)} subtypes`,
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
    kind: "zone-certificate",
    kindScopeRead: "not-made",
    reasons,
    scope,
    stored,
  });
}
