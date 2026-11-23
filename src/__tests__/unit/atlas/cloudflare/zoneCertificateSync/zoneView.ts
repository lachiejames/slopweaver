/*
 * The stored-state builders and the read-back views more than one `syncZoneCertificateKind` test file uses: a
 * stored kind file and gap a run folds into, the identity-and-freshness view of one zone's entities over this
 * kind's cases, and what that view must read as after a run. The view itself, and each gap's lifecycle, are the
 * ones zone-scoped subtype suites share, in `../sync/zoneSubtypeKind.ts`. A plain module, not a `*.test.ts`, so
 * no test registers twice. It was split out when the zone certificate sync suite became one file per behaviour.
 */
import { openCloudflareGap } from "../../../../../atlas/cloudflare/gaps.js";
import {
  type CloudflareEntity,
  type CloudflareGap,
  type CloudflareKindFile,
  emptyCloudflareKindFile,
} from "../../../../../atlas/cloudflare/model.js";
import type { CloudflareZoneCertificateSubtype } from "../../../../../atlas/cloudflare/projection/zoneCertificateDetail.js";
import { zoneView as sharedZoneView, type ZoneViewRow } from "../sync/zoneSubtypeKind.js";
import { ALL_CASES, AT, KIND_SCOPE, STORED_AT } from "./harness.js";

/**
 * A stored `zone-certificate` kind file holding the given entities and gaps.
 *
 * @returns the kind file, stamped `STORED_AT`
 */
export function storedFile({
  entities,
  gaps = [],
}: {
  entities: readonly CloudflareEntity[];
  gaps?: readonly CloudflareGap[];
}): CloudflareKindFile {
  return {
    ...emptyCloudflareKindFile({ kind: "zone-certificate", updatedAt: STORED_AT }),
    entities: [...entities],
    gaps: [...gaps],
  };
}

/**
 * An open gap an earlier run recorded at one subtype's scope.
 *
 * @returns the open gap, detected at `STORED_AT`
 */
export function storedGap({
  subtype,
  condition,
}: {
  subtype: CloudflareZoneCertificateSubtype;
  condition: "permission-refused" | "pagination-incomplete";
}): CloudflareGap {
  return openCloudflareGap({
    at: STORED_AT,
    condition,
    kind: "zone-certificate",
    reason: "stored",
    scope: `${KIND_SCOPE}/${subtype}`,
  });
}

/**
 * The identity-and-freshness view of one zone's entities, ordered by provider id, read over this kind's cases.
 *
 * @returns one row per entity in that zone, sorted by provider id
 */
export function zoneView({
  entities,
  zoneId,
}: {
  entities: readonly CloudflareEntity[];
  zoneId: string;
}): readonly ZoneViewRow[] {
  return sharedZoneView({ cases: ALL_CASES, entities, zoneId });
}

/**
 * What this zone's entities must read as after a run in which every subtype was refreshed except, optionally,
 * `refused`: a refreshed subtype keeps its stored first-seen instant and carries this run's timestamps and
 * marker, the refused one is exactly what was stored.
 *
 * @returns one row per declared subtype, sorted by provider id
 */
export function expectedZoneView({
  refused,
}: {
  refused: CloudflareZoneCertificateSubtype | null;
}): readonly ZoneViewRow[] {
  return ALL_CASES.map((served) => {
    if (served.subtype === refused) {
      return {
        firstSeenAt: STORED_AT,
        lastSeenAt: STORED_AT,
        marker: served.oldMarker,
        observedAt: STORED_AT,
        providerId: served.providerId,
        subtype: served.subtype,
      };
    }
    return {
      firstSeenAt: STORED_AT,
      lastSeenAt: AT,
      marker: served.newMarker,
      observedAt: AT,
      providerId: served.providerId,
      subtype: served.subtype,
    };
  }).toSorted((left, right) => left.providerId.localeCompare(right.providerId));
}
