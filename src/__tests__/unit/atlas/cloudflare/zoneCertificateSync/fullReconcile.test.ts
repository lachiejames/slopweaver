/*
 * How a clean `syncZoneCertificateKind` run behaves: it reads every declared subtype's endpoint, replaces the
 * zone's entities, prunes one the provider no longer returns, records the kind scope synced and closes a seeded
 * subtype gap. It was split out when the zone certificate sync suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { CLOUDFLARE_VISIBILITY_SCOPE } from "../../../../../atlas/cloudflare/model.js";
import { projectCloudflareCustomCertificate } from "../../../../../atlas/cloudflare/projection/zoneCertificateCustom.js";
import { syncZoneCertificateKind } from "../../../../../atlas/cloudflare/zoneCertificateSync.js";
import { unwrap } from "../../../../../lib/result.js";
import { gapLifecycle } from "../sync/zoneSubtypeKind.js";
import { ACCOUNT_ID, ALL_CASES, AT, KIND_SCOPE, STORED_AT, ZONE_ID } from "./harness.js";
import { servedClient } from "./servedClient.js";
import { storedFile, storedGap, zoneView } from "./zoneView.js";

describe("syncZoneCertificateKind", () => {
  it("reads every declared subtype's endpoint, replaces the zone's entities, prunes a vanished one and closes a seeded subtype gap", async () => {
    const { client, requests } = servedClient({});
    const stored = storedFile({
      entities: [
        // Gone from the provider now: a successful custom-certificate read must prune it.
        projectCloudflareCustomCertificate({
          accountId: ACCOUNT_ID,
          at: STORED_AT,
          raw: { id: "cert-gone", status: "active" },
          zoneId: ZONE_ID,
        }),
      ],
      gaps: [storedGap({ condition: "permission-refused", subtype: "keyless-certificate" })],
    });

    const folded = unwrap(
      await syncZoneCertificateKind({ accountId: ACCOUNT_ID, at: AT, client, stored, zoneId: ZONE_ID }),
    );

    expect([...new Set(requests)].toSorted()).toEqual(ALL_CASES.map((served) => served.path).toSorted());
    expect(ALL_CASES.length).toBe(11);
    expect(zoneView({ entities: folded.file.entities, zoneId: ZONE_ID })).toEqual([
      {
        firstSeenAt: AT,
        lastSeenAt: AT,
        marker: "active",
        observedAt: AT,
        providerId: "aop-hostname-certificate:aophc-1",
        subtype: "aop-hostname-certificate",
      },
      {
        firstSeenAt: AT,
        lastSeenAt: AT,
        marker: true,
        observedAt: AT,
        providerId: "aop-setting",
        subtype: "aop-setting",
      },
      {
        firstSeenAt: AT,
        lastSeenAt: AT,
        marker: "active",
        observedAt: AT,
        providerId: "aop-zone-certificate:aop-1",
        subtype: "aop-zone-certificate",
      },
      {
        firstSeenAt: AT,
        lastSeenAt: AT,
        marker: "active",
        observedAt: AT,
        providerId: "certificate-pack:pack-1",
        subtype: "certificate-pack",
      },
      {
        firstSeenAt: AT,
        lastSeenAt: AT,
        marker: "active",
        observedAt: AT,
        providerId: "client-certificate:cc-1",
        subtype: "client-certificate",
      },
      {
        firstSeenAt: AT,
        lastSeenAt: AT,
        marker: "active",
        observedAt: AT,
        providerId: "custom-certificate:cert-1",
        subtype: "custom-certificate",
      },
      {
        firstSeenAt: AT,
        lastSeenAt: AT,
        marker: "shop.customer.test",
        observedAt: AT,
        providerId: "custom-hostname:ch-1",
        subtype: "custom-hostname",
      },
      {
        firstSeenAt: AT,
        lastSeenAt: AT,
        marker: "keyless-new",
        observedAt: AT,
        providerId: "keyless-certificate:kl-1",
        subtype: "keyless-certificate",
      },
      {
        firstSeenAt: AT,
        lastSeenAt: AT,
        marker: "origin-ecc",
        observedAt: AT,
        providerId: "origin-ca-certificate:ca-1",
        subtype: "origin-ca-certificate",
      },
      {
        firstSeenAt: AT,
        lastSeenAt: AT,
        marker: true,
        observedAt: AT,
        providerId: "universal-ssl-setting",
        subtype: "universal-ssl-setting",
      },
      {
        firstSeenAt: AT,
        lastSeenAt: AT,
        marker: "active",
        observedAt: AT,
        providerId: "universal-ssl-verification:uuid-1",
        subtype: "universal-ssl-verification",
      },
    ]);
    expect(folded.outcome).toEqual({ complete: true, entityCount: 11, kind: "zone-certificate", reasons: [] });
    expect(folded.file.coverage).toEqual([
      {
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason: "reconciled 11 certificate/SSL entities across all 11 subtypes",
        scope: KIND_SCOPE,
        state: "synced",
        unblockedBy: null,
        visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
      },
    ]);
    expect(gapLifecycle({ file: folded.file })).toEqual([
      {
        condition: "permission-refused",
        lastCheckedAt: AT,
        scope: `${KIND_SCOPE}/keyless-certificate`,
        status: "closed",
      },
    ]);
  });
});
