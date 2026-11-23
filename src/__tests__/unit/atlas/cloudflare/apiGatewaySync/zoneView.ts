/*
 * The stored-state builders and the read-back view more than one `syncApiGatewayKind` test file uses: a stored
 * kind file and gap a run folds into, and the identity-and-freshness view of one zone's entities over this
 * kind's cases. The view itself, and each gap's lifecycle, are the ones zone-scoped subtype suites share, in
 * `../sync/zoneSubtypeKind.ts`. A plain module, not a `*.test.ts`, so no test registers twice. It was split out
 * when the API Gateway sync suite became one file per behaviour.
 */
import { openCloudflareGap } from "../../../../../atlas/cloudflare/gaps.js";
import {
  type CloudflareEntity,
  type CloudflareGap,
  type CloudflareKindFile,
  emptyCloudflareKindFile,
} from "../../../../../atlas/cloudflare/model.js";
import type { CloudflareApiGatewaySubtype } from "../../../../../atlas/cloudflare/projection/apiGateway.js";
import { zoneView as sharedZoneView, type ZoneViewRow } from "../sync/zoneSubtypeKind.js";
import { ALL_CASES, KIND_SCOPE, STORED_AT } from "./harness.js";

/**
 * A stored `api-gateway` kind file holding the given entities and gaps.
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
    ...emptyCloudflareKindFile({ kind: "api-gateway", updatedAt: STORED_AT }),
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
  subtype: CloudflareApiGatewaySubtype;
  condition: "permission-refused" | "pagination-incomplete";
}): CloudflareGap {
  return openCloudflareGap({
    at: STORED_AT,
    condition,
    kind: "api-gateway",
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
