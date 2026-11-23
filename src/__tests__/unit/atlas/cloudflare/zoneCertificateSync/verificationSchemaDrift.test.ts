/*
 * How `syncZoneCertificateKind` handles a Universal SSL verification entry with no `cert_pack_uuid`: that
 * subtype's read becomes a schema-drift gap and keeps its stored entity, while every other subtype is
 * replaced. It was split out when the zone certificate sync suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { cloudflareGapId } from "../../../../../atlas/cloudflare/identity.js";
import { syncZoneCertificateKind } from "../../../../../atlas/cloudflare/zoneCertificateSync.js";
import { unwrap } from "../../../../../lib/result.js";
import { ACCOUNT_ID, ALL_CASES, AT, KIND_SCOPE, ZONE_ID } from "./harness.js";
import { servedClient } from "./servedClient.js";
import { expectedZoneView, storedFile, zoneView } from "./zoneView.js";

describe("syncZoneCertificateKind", () => {
  it("routes a verification entry without cert_pack_uuid to a schema-drift gap, preserving only that subtype's stored entity", async () => {
    const { client } = servedClient({
      served: {
        "universal-ssl-verification": {
          result: [{ cert_pack_uuid: "uuid-1", certificate_status: "active" }, { certificate_status: "active" }],
          shape: "single",
        },
      },
    });
    const stored = storedFile({ entities: ALL_CASES.map((served) => served.stored({ zoneId: ZONE_ID })) });
    const refusal =
      "cloudflare zone-certificate-universal-ssl-verification-get: response failed local schema validation: a Universal SSL verification entry had no cert_pack_uuid in the response, and it is the entry's provider id";
    const refusedScope = `${KIND_SCOPE}/universal-ssl-verification`;

    const folded = unwrap(
      await syncZoneCertificateKind({ accountId: ACCOUNT_ID, at: AT, client, stored, zoneId: ZONE_ID }),
    );

    expect(zoneView({ entities: folded.file.entities, zoneId: ZONE_ID })).toEqual(
      expectedZoneView({ refused: "universal-ssl-verification" }),
    );
    expect(folded.outcome).toEqual({
      complete: false,
      entityCount: 11,
      kind: "zone-certificate",
      reasons: [`universal-ssl-verification: ${refusal}`],
    });
    expect(folded.file.gaps).toEqual([
      {
        condition: "schema-drift",
        firstDetectedAt: AT,
        id: cloudflareGapId({ condition: "schema-drift", scope: refusedScope }),
        kind: "zone-certificate",
        lastCheckedAt: AT,
        lastDetectedAt: AT,
        reason: refusal,
        scope: refusedScope,
        status: "open",
      },
    ]);
  });
});
