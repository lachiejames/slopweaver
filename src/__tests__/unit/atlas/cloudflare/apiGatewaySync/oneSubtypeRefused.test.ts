/*
 * How `syncApiGatewayKind` behaves when exactly one subtype's read is refused, run once per declared subtype:
 * every endpoint is still read, the refused subtype alone keeps its stored entity, another zone is untouched,
 * the kind scope turns unreadable and one permission-refused gap opens at that subtype's scope. It was split out
 * when the API Gateway sync suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { syncApiGatewayKind } from "../../../../../atlas/cloudflare/apiGatewaySync.js";
import { cloudflareGapId } from "../../../../../atlas/cloudflare/identity.js";
import {
  CLOUDFLARE_API_GATEWAY_SUBTYPES,
  type CloudflareApiGatewaySubtype,
} from "../../../../../atlas/cloudflare/projection/apiGateway.js";
import { unwrap } from "../../../../../lib/result.js";
import type { ZoneViewRow } from "../sync/zoneSubtypeKind.js";
import { ACCOUNT_ID, ALL_CASES, AT, CASES, KIND_SCOPE, STORED_AT, ZONE_ID } from "./harness.js";
import { servedClient } from "./servedClient.js";
import { storedFile, zoneView } from "./zoneView.js";

const OTHER_ZONE_ID = "y".repeat(32);

/** The remedy text every permission-only boundary carries (`kindFold.ts`'s `CLOUDFLARE_TOKEN_REMEDY`). */
const TOKEN_REMEDY =
  "an API token scoped to read this surface — the account holds it and the configured token may not see it," +
  " so widening the token's permissions at Cloudflare is what would fill this kind";

/** What a 403 on one SDK operation reads as once the typed client error wraps it. */
function deniedMessage({ operation }: { operation: string }): string {
  return `cloudflare ${operation}: permission denied (403) — the configured token cannot see this surface: 403 {"errors":[{"message":"denied"}],"success":false}`;
}

/**
 * What this zone's entities must read as after a run in which every subtype was refreshed except, optionally,
 * `refused`: a refreshed subtype keeps its stored first-seen instant and carries this run's timestamps and
 * marker, the refused one is exactly what was stored.
 */
function expectedZoneView({ refused }: { refused: CloudflareApiGatewaySubtype | null }): readonly ZoneViewRow[] {
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

describe("syncApiGatewayKind", () => {
  it.each(CLOUDFLARE_API_GATEWAY_SUBTYPES)(
    "when only %s is refused, it alone keeps its stored entity, every other subtype is replaced and another zone is untouched",
    async (refused) => {
      const { client, requests } = servedClient({ denied: [refused] });
      const otherZoneEntity = CASES[refused].stored({ zoneId: OTHER_ZONE_ID });
      const stored = storedFile({
        entities: [...ALL_CASES.map((served) => served.stored({ zoneId: ZONE_ID })), otherZoneEntity],
      });
      const denied = deniedMessage({ operation: CASES[refused].operation });
      const refusedScope = `${KIND_SCOPE}/${refused}`;

      const folded = unwrap(
        await syncApiGatewayKind({ accountId: ACCOUNT_ID, at: AT, client, stored, zoneId: ZONE_ID }),
      );

      // Every endpoint was still asked for: one refusal does not short-circuit the others.
      expect([...new Set(requests)].toSorted()).toEqual(ALL_CASES.map((served) => served.path).toSorted());
      expect(zoneView({ entities: folded.file.entities, zoneId: ZONE_ID })).toEqual(expectedZoneView({ refused }));
      expect(folded.file.entities.filter((entity) => entity.scope.zoneId === OTHER_ZONE_ID)).toEqual([otherZoneEntity]);
      expect(folded.outcome).toEqual({
        complete: false,
        entityCount: 9,
        kind: "api-gateway",
        permissionBlocked: { detail: `${refusedScope}: ${denied}`, unblockedBy: TOKEN_REMEDY },
        reasons: [`${refused}: ${denied}`],
      });
      expect(
        folded.file.coverage.map((cell) => ({ reason: cell.reason, scope: cell.scope, state: cell.state })),
      ).toEqual([{ reason: `${refused}: ${denied}`, scope: KIND_SCOPE, state: "unreadable" }]);
      expect(folded.file.gaps).toEqual([
        {
          condition: "permission-refused",
          firstDetectedAt: AT,
          id: cloudflareGapId({ condition: "permission-refused", scope: refusedScope }),
          kind: "api-gateway",
          lastCheckedAt: AT,
          lastDetectedAt: AT,
          reason: denied,
          scope: refusedScope,
          status: "open",
        },
      ]);
    },
  );
});
